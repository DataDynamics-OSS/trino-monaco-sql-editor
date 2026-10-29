package com.datadynamics.trinomonaco.gateway;

import com.datadynamics.trinomonaco.gateway.GatewayProperties.ClusterTarget;
import java.net.URI;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * trino-monaco gateway (Java): per-user Trino sessions over HTTP. {@link GatewayController} maps
 * these operations to HTTP.
 *
 * <p>Same API and security model as the Node reference gateway in {@code servers/server-node/}
 * (see servers/server-node/README.md):
 * <ul>
 *   <li>each user logs in once with their OWN Trino account; the password is checked against the
 *       cluster ({@code SELECT 1}) and kept only in memory for the life of the session
 *   <li>later calls are authorised by an httpOnly, SameSite=Strict session cookie that must match
 *       the session id in the URL
 *   <li>clients pick a server-configured cluster alias, never a URL; follow-up requests are limited
 *       to {@code /v1/statement/{queued|executing}/…} of the queries started by the same session
 *   <li>the client-protocol session state Trino returns in response headers ({@code USE},
 *       {@code SET SESSION}, {@code PREPARE}, transactions) is kept per session, like the Trino CLI
 *   <li>failed logins are rate-limited per client address + alias + user
 *   <li>request timeout and DDL policy are enforced here; everything else is the user's own
 *       Trino privileges
 * </ul>
 */
@Service
public class SessionManager implements DisposableBean {

  /** JavaScript's {@code \s} (the Node gateway's regular expressions). */
  private static final String JS_SPACE = "\\t\\n\\x0B\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

  private static final Pattern DDL = Pattern.compile(
      "^(CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE|DENY|SET[" + JS_SPACE + "]+AUTHORIZATION)\\b",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern EXPLAIN_ANALYZE = Pattern.compile(
      "^EXPLAIN[" + JS_SPACE + "]+ANALYZE[" + JS_SPACE + "]+(?:VERBOSE[" + JS_SPACE + "]+)?", Pattern.CASE_INSENSITIVE);

  /** Client headers passed through to Trino on POST /v1/statement. */
  private static final List<String> FORWARDED = List.of(
      "x-trino-source",
      "x-trino-catalog",
      "x-trino-schema",
      "x-trino-time-zone",
      "x-trino-language",
      "x-trino-client-info",
      "x-trino-client-tags",
      "x-trino-client-capabilities");

  /** Trino response headers that change the session state (also returned to the client). */
  static final List<String> STATE_HEADERS = List.of(
      "x-trino-set-catalog",
      "x-trino-set-schema",
      "x-trino-set-session",
      "x-trino-clear-session",
      "x-trino-added-prepare",
      "x-trino-deallocated-prepare",
      "x-trino-started-transaction-id",
      "x-trino-clear-transaction-id");

  /** {@code /v1/statement/{queued|executing}/{queryId}/{slug}/{token}} */
  static final Pattern FOLLOW_PATH = Pattern.compile("(queued|executing)/([A-Za-z0-9_]+)/[A-Za-z0-9_.-]+/\\d+");
  private static final Pattern STATEMENT_PATH = Pattern.compile("/v1/statement/(.*)$");

  /** Basic auth rejects {@code :}; control characters and whitespace never belong in a user name (1–256 UTF-16 units). */
  private static final Pattern USER = Pattern.compile("[^" + JS_SPACE + ":\\x00-\\x1f\\x7f]+");

  private static final SecureRandom RANDOM = new SecureRandom();

  private final Upstream upstream;
  private final GatewayProperties o;
  private final JsonMapper json;
  private final Map<String, ClusterTarget> clusters = new LinkedHashMap<>();
  private final ScheduledExecutorService sweeper;
  private final Map<String, Session> sessions = new ConcurrentHashMap<>();
  /** key → {count, resetAt} */
  private final Map<String, long[]> failures = new ConcurrentHashMap<>();

  /** Who a request to the cluster is made as. */
  private record Identity(String user, ClusterTarget target, String authorization) {}

  private static final class Session {
    final String id;
    final Identity identity;
    final String connectAlias;
    final String version;
    // Guarded by `this`:
    String catalog;
    String schema;
    /** SET SESSION properties (values URL-encoded, as on the wire). */
    final Map<String, String> properties = new LinkedHashMap<>();
    /** PREPARE statements (name and SQL URL-encoded, as on the wire). */
    final Map<String, String> prepared = new LinkedHashMap<>();
    String transactionId;
    volatile long lastUsed = System.currentTimeMillis();
    /** Running queries: query id → latest upstream nextUri (for cancel on logout). */
    final Map<String, String> queries = new ConcurrentHashMap<>();

    Session(String id, Identity identity, String connectAlias, String version) {
      this.id = id;
      this.identity = identity;
      this.connectAlias = connectAlias;
      this.version = version;
      this.catalog = identity.target().catalog();
      this.schema = identity.target().schema();
    }

    String user() {
      return identity.user();
    }
  }

  /** A successful login: the response body plus the id for the session cookie. */
  public record Login(String sessionId, Map<String, Object> body) {}

  /** A relayed response: status, extra headers and the JSON body (null for 204). */
  public record Reply(int status, Map<String, String> headers, String body) {}

  public SessionManager(Upstream upstream, GatewayProperties properties) {
    this.upstream = upstream;
    this.o = properties;
    this.json = JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .build();
    String raw = properties.clustersJson();
    if (raw != null && !raw.isBlank()) {
      Map<String, ClusterTarget> parsed = json.readValue(raw, new TypeReference<LinkedHashMap<String, ClusterTarget>>() {});
      if (parsed != null) clusters.putAll(parsed);
    }
    clusters.putAll(properties.clusters());
    if (clusters.isEmpty()) {
      throw new IllegalStateException(
          "TRINO_CLUSTERS is required, e.g. {\"dev\":{\"url\":\"http://localhost:8080\",\"authentication\":\"none\"}}");
    }
    clusters.forEach((alias, t) -> {
      if (t.url() == null || t.url().isBlank()) throw new IllegalStateException("Cluster '" + alias + "' has no url");
    });
    sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "trino-monaco-idle-sweeper");
      t.setDaemon(true);
      return t;
    });
    long interval = Math.min(60_000, Math.max(1_000, o.idleTimeout().toMillis() / 2));
    sweeper.scheduleAtFixedRate(this::sweep, interval, interval, TimeUnit.MILLISECONDS);
  }

  /** Close every session: cancel queries, roll back transactions (application shutdown). */
  @Override
  public void destroy() {
    sweeper.shutdownNow();
    for (Session s : List.copyOf(sessions.values())) closeSession(s);
  }

  // ------------------------------------------------------------ helpers

  private static String randomId(int bytes) {
    byte[] b = new byte[bytes];
    RANDOM.nextBytes(b);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  private static boolean truthy(String s) {
    return s != null && !s.isEmpty();
  }

  private static boolean isJsSpace(char c) {
    return c == '\t' || c == '\n' || c == 0x0B || c == '\f' || c == '\r' || c == ' ' || c == 0xA0 || c == 0x1680
        || (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000
        || c == 0xFEFF;
  }

  /** Leading comments, whitespace and {@code (} removed, and {@code EXPLAIN ANALYZE} (which executes) unwrapped. */
  static String statementHead(String sql) {
    String s = sql;
    while (true) {
      int i = 0;
      int n = s.length();
      while (i < n) {
        char c = s.charAt(i);
        if (isJsSpace(c) || c == '(') {
          i++;
        } else if (s.startsWith("--", i)) {
          int nl = s.indexOf('\n', i + 2);
          i = nl < 0 ? n : nl + 1;
        } else if (s.startsWith("/*", i)) {
          int end = s.indexOf("*/", i + 2);
          if (end < 0) break;
          i = end + 2;
        } else {
          break;
        }
      }
      s = s.substring(i);
      Matcher m = EXPLAIN_ANALYZE.matcher(s);
      if (!m.lookingAt()) return s;
      s = s.substring(m.end());
    }
  }

  static boolean isDdl(String sql) {
    return DDL.matcher(statementHead(sql)).lookingAt();
  }

  static boolean validUser(String user) {
    return user.length() >= 1 && user.length() <= 256 && USER.matcher(user).matches();
  }

  private static List<String> splitList(String v) {
    List<String> out = new ArrayList<>();
    if (v == null) return out;
    for (String x : v.split(",", -1)) {
      String t = x.strip();
      if (!t.isEmpty()) out.add(t);
    }
    return out;
  }

  private static String text(JsonNode n) {
    return n != null && n.isString() ? n.stringValue() : null;
  }

  /** Absolute URL on the session's cluster for a statement path. */
  private static String clusterUrl(ClusterTarget target, String path) {
    return target.url().replaceAll("/+$", "") + "/v1/statement" + path;
  }

  /** One request to the cluster with the session's identity. */
  private Upstream.Response upstream(Identity id, String method, String url, Map<String, String> headers, String body)
      throws Exception {
    Map<String, String> h = new LinkedHashMap<>(headers);
    h.put("X-Trino-User", id.user());
    if (id.authorization() != null) h.put("Authorization", id.authorization());
    return upstream.send(id.target(), method, url, h, body);
  }

  private Upstream.Response upstream(Identity id, String method, String url) throws Exception {
    return upstream(id, method, url, Map.of(), null);
  }

  private static ApiError upstreamError(Exception e) {
    if (e instanceof InterruptedException) Thread.currentThread().interrupt();
    String message = e.getMessage() != null ? e.getMessage() : e.toString();
    return new ApiError(502, e instanceof HttpTimeoutException ? "TRINO_TIMEOUT" : "TRINO_UNAVAILABLE", message);
  }

  /** Gateway path that replaces an upstream {@code nextUri}, or null. */
  private String gatewayUri(Session s, String upstreamUri) {
    String path;
    try {
      path = new URI(upstreamUri).getRawPath();
    } catch (Exception e) {
      return null;
    }
    if (path == null) return null;
    Matcher m = STATEMENT_PATH.matcher(path);
    return m.find() && FOLLOW_PATH.matcher(m.group(1)).matches()
        ? o.prefix() + "/sessions/" + s.id + "/v1/statement/" + m.group(1)
        : null;
  }

  /** Apply Trino's session-state response headers to the gateway session. */
  private static void applyState(Session s, Upstream.Response res) {
    synchronized (s) {
      String cat = res.header("x-trino-set-catalog");
      String sch = res.header("x-trino-set-schema");
      if (cat != null) s.catalog = cat;
      if (sch != null) s.schema = sch;
      for (String kv : splitList(res.header("x-trino-set-session"))) {
        int i = kv.indexOf('=');
        if (i > 0) s.properties.put(kv.substring(0, i), kv.substring(i + 1));
      }
      for (String k : splitList(res.header("x-trino-clear-session"))) s.properties.remove(k);
      for (String kv : splitList(res.header("x-trino-added-prepare"))) {
        int i = kv.indexOf('=');
        if (i > 0) s.prepared.put(kv.substring(0, i), kv.substring(i + 1));
      }
      for (String k : splitList(res.header("x-trino-deallocated-prepare"))) s.prepared.remove(k);
      String started = res.header("x-trino-started-transaction-id");
      if (truthy(started)) s.transactionId = started;
      if (res.header("x-trino-clear-transaction-id") != null) s.transactionId = null;
    }
  }

  /**
   * Relay one statement page: update the session state, swap {@code nextUri} for the gateway
   * path and track the query for cancellation.
   */
  private Reply relay(Session s, Upstream.Response res) {
    if (res.status() == 401) {
      // Password changed or account disabled since login.
      closeSession(s);
      throw new ApiError(401, "SESSION_LOST", "The cluster rejected the session's credentials");
    }
    String text = res.body();
    JsonNode parsed;
    try {
      parsed = json.readTree(text);
    } catch (Exception e) {
      parsed = null;
    }
    if (!(parsed instanceof ObjectNode page)) {
      int status = res.status() == 503 ? 503 : 502; // Trino clients retry 503
      String message = text.length() > 500 ? text.substring(0, 500) : text;
      throw new ApiError(status, "TRINO_HTTP_" + res.status(), message.isEmpty() ? "HTTP " + res.status() : message);
    }
    applyState(s, res);
    Map<String, String> headers = new LinkedHashMap<>();
    for (String name : STATE_HEADERS) {
      String v = res.header(name);
      if (v != null) headers.put(name, v);
    }
    page.remove("partialCancelUri");
    String nextUri = text(page.get("nextUri"));
    String id = text(page.get("id"));
    if (truthy(nextUri)) {
      String local = gatewayUri(s, nextUri);
      if (truthy(id) && local != null) s.queries.put(id, nextUri);
      if (local != null) page.put("nextUri", local);
      else page.remove("nextUri");
    } else if (truthy(id)) {
      s.queries.remove(id);
    }
    return new Reply(res.ok() ? 200 : res.status(), headers, json.writeValueAsString(page));
  }

  private void cancelQueries(Session s) {
    List<String> uris = List.copyOf(s.queries.values());
    if (!uris.isEmpty()) {
      try (ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor()) {
        for (String uri : uris) {
          ex.submit(() -> {
            try {
              upstream(s.identity, "DELETE", uri);
            } catch (Exception ignored) {
              // best effort
            }
          });
        }
      }
    }
    s.queries.clear();
  }

  private void closeSession(Session s) {
    if (!sessions.remove(s.id, s)) return; // already closed
    cancelQueries(s);
    String tx;
    synchronized (s) {
      tx = s.transactionId;
    }
    if (tx != null) {
      // Best effort: roll back work left open in a transaction.
      try {
        upstream(s.identity, "POST", clusterUrl(s.identity.target(), ""), Map.of("X-Trino-Transaction-Id", tx), "ROLLBACK");
      } catch (Exception ignored) {
        // closing anyway
      }
    }
  }

  private void sweep() {
    long now = System.currentTimeMillis();
    for (Session s : List.copyOf(sessions.values())) {
      if (now - s.lastUsed > o.idleTimeout().toMillis()) closeSession(s);
    }
    failures.values().removeIf(f -> f[1] <= now);
  }

  /** Resolve and authorise the session named in the URL by its cookie or header. */
  private Session sessionFor(String id, String fromCookie, String fromHeader) {
    Session s = sessions.get(id);
    String header = o.allowHeaderAuth() ? fromHeader : null;
    boolean expired = s != null && System.currentTimeMillis() - s.lastUsed > o.idleTimeout().toMillis();
    if (s == null || expired || (!id.equals(fromCookie) && !id.equals(header))) {
      if (s != null && expired) Thread.ofVirtual().start(() -> closeSession(s));
      throw new ApiError(401, "SESSION_EXPIRED", "Not connected or session expired");
    }
    s.lastUsed = System.currentTimeMillis();
    return s;
  }

  /**
   * Run {@code SELECT 1} to completion with the given identity (login check). Returns the
   * rejecting response, or null on success.
   */
  private Upstream.Response probe(Identity id) throws Exception {
    Upstream.Response res = upstream(id, "POST", clusterUrl(id.target(), ""), Map.of("X-Trino-Source", o.source()), "SELECT 1");
    for (int i = 0; i < 1000; i++) {
      if (!res.ok()) return res;
      JsonNode page = json.readTree(res.body());
      if (page == null || !page.isObject()) throw new IllegalStateException("Login check failed: unexpected response");
      JsonNode error = page.get("error");
      if (error != null && !error.isNull() && !(error.isBoolean() && !error.booleanValue())) {
        String message = text(error.get("message"));
        throw new IllegalStateException(message != null ? message : "Login check failed");
      }
      String next = text(page.get("nextUri"));
      if (!truthy(next)) return null;
      res = upstream(id, "GET", next);
    }
    return null;
  }

  /** Session description returned by the API. */
  private static Map<String, Object> info(Session s) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("user", s.user());
    out.put("version", s.version);
    out.put("connectAlias", s.connectAlias);
    synchronized (s) {
      if (truthy(s.catalog)) out.put("catalog", s.catalog);
      if (truthy(s.schema)) out.put("schema", s.schema);
      out.put("inTransaction", s.transactionId != null);
    }
    return out;
  }

  // ---------------------------------------------------------------- operations

  public List<Map<String, String>> aliases() {
    List<Map<String, String>> out = new ArrayList<>();
    clusters.forEach((alias, t) -> {
      Map<String, String> a = new LinkedHashMap<>();
      a.put("alias", alias);
      a.put("label", t.label() != null ? t.label() : alias);
      out.add(a);
    });
    return out;
  }

  /** Parse a login body: a JSON object (application/json), or empty for anything else. */
  public Map<String, Object> loginBody(byte[] body, boolean isJson) {
    if (!isJson || body == null || body.length == 0) return Map.of();
    try {
      JsonNode node = json.readTree(body);
      if (node != null && node.isObject()) {
        @SuppressWarnings("unchecked")
        Map<String, Object> m = json.convertValue(node, Map.class);
        return m;
      }
    } catch (Exception e) {
      throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
    }
    return Map.of();
  }

  public Login login(Map<String, Object> body, String clientAddress) {
    if (!(body.get("connectAlias") instanceof String connectAlias) || !(body.get("user") instanceof String user)) {
      throw new ApiError(400, "BAD_REQUEST", "connectAlias and user are required");
    }
    Object password = body.get("password");
    ClusterTarget target = clusters.get(connectAlias);
    if (target == null) throw new ApiError(400, "UNKNOWN_ALIAS", "Unknown cluster alias '" + connectAlias + "'");
    boolean needsPassword = target.needsPassword();
    if (!validUser(user)
        || (needsPassword && (!(password instanceof String p) || p.isEmpty() || p.length() > 1024))) {
      throw new ApiError(400, "BAD_REQUEST", "Invalid user name or password");
    }

    String key = clientAddress + "|" + connectAlias + "|" + user;
    long[] f = failures.get(key);
    if (f != null && f[1] > System.currentTimeMillis() && f[0] >= o.loginRateLimitMax()) {
      throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many failed logins; try again later");
    }
    long open = sessions.values().stream().filter(s -> s.connectAlias.equals(connectAlias) && s.user().equals(user)).count();
    if (open >= o.maxSessionsPerUser()) {
      throw new ApiError(429, "TOO_MANY_SESSIONS", "At most " + o.maxSessionsPerUser() + " sessions per user");
    }

    Identity identity = new Identity(
        user,
        target,
        needsPassword
            ? "Basic " + Base64.getEncoder().encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8))
            : null);
    String version = "";
    Upstream.Response rejected;
    try {
      Upstream.Response info = upstream(identity, "GET", target.url().replaceAll("/+$", "") + "/v1/info");
      if (info.ok()) {
        JsonNode v = json.readTree(info.body()).path("nodeVersion").path("version");
        version = v.isMissingNode() || v.isNull() ? "" : v.isString() ? v.stringValue() : v.toString();
      }
      rejected = probe(identity);
    } catch (Exception e) {
      throw upstreamError(e);
    }
    if (rejected != null) {
      if (rejected.status() == 401 || rejected.status() == 403) {
        long now = System.currentTimeMillis();
        long[] entry = f != null && f[1] > now ? f : new long[] {0, now + o.loginRateLimitWindow().toMillis()};
        entry[0]++;
        failures.put(key, entry);
        throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid user name or password");
      }
      throw new ApiError(502, "TRINO_HTTP_" + rejected.status(), "HTTP " + rejected.status());
    }
    failures.remove(key);

    Session s = new Session(randomId(24), identity, connectAlias, version);
    sessions.put(s.id, s);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("sessionId", s.id);
    out.putAll(info(s));
    return new Login(s.id, out);
  }

  public Map<String, Object> session(String id, String cookie, String header) {
    return info(sessionFor(id, cookie, header));
  }

  public void logout(String id, String cookie, String header) {
    closeSession(sessionFor(id, cookie, header));
  }

  /** Trino client protocol: start a statement. {@code clientHeaders} maps lower-case names to values. */
  public Reply statement(String id, String cookie, String header, String sql, Map<String, String> clientHeaders) {
    Session s = sessionFor(id, cookie, header);
    if (sql == null || sql.chars().allMatch(c -> isJsSpace((char) c))) {
      throw new ApiError(400, "BAD_REQUEST", "The request body must be the SQL text");
    }
    if (!o.allowDdl() && isDdl(sql)) {
      throw new ApiError(403, "DDL_NOT_ALLOWED", "DDL is disabled on this gateway");
    }

    Map<String, String> headers = new LinkedHashMap<>();
    for (String name : FORWARDED) {
      String v = clientHeaders.get(name);
      if (v != null) headers.put(name, v);
    }
    headers.putIfAbsent("x-trino-source", o.source());
    synchronized (s) {
      if (!truthy(headers.get("x-trino-catalog")) && truthy(s.catalog)) headers.put("x-trino-catalog", s.catalog);
      if (!truthy(headers.get("x-trino-schema")) && truthy(s.schema)) headers.put("x-trino-schema", s.schema);
      List<String> props = new ArrayList<>();
      s.properties.forEach((k, v) -> props.add(k + "=" + v));
      String clientProps = clientHeaders.get("x-trino-session");
      if (clientProps != null) props.add(clientProps);
      if (!props.isEmpty()) headers.put("x-trino-session", String.join(",", props));
      if (!s.prepared.isEmpty()) {
        List<String> prepared = new ArrayList<>();
        s.prepared.forEach((k, v) -> prepared.add(k + "=" + v));
        headers.put("x-trino-prepared-statement", String.join(",", prepared));
      }
      if (s.transactionId != null) headers.put("x-trino-transaction-id", s.transactionId);
    }
    headers.put("content-type", "text/plain; charset=utf-8");

    Upstream.Response res;
    try {
      res = upstream(s.identity, "POST", clusterUrl(s.identity.target(), ""), headers, sql);
    } catch (Exception e) {
      throw upstreamError(e);
    }
    return relay(s, res);
  }

  /**
   * Trino client protocol: follow {@code nextUri} (GET) or cancel (DELETE). {@code path} is the
   * raw request path after {@code /v1/statement/}.
   */
  public Reply follow(String id, String cookie, String header, String method, String path) {
    Session s = sessionFor(id, cookie, header);
    Matcher m = FOLLOW_PATH.matcher(path == null ? "" : path);
    if (!m.matches() || !s.queries.containsKey(m.group(2))) {
      throw new ApiError(404, "QUERY_NOT_FOUND", "Unknown or finished query");
    }
    Upstream.Response res;
    try {
      res = upstream(s.identity, method, clusterUrl(s.identity.target(), "/" + path));
    } catch (Exception e) {
      throw upstreamError(e);
    }
    if (method.equals("DELETE")) {
      s.queries.remove(m.group(2));
      return new Reply(204, Map.of(), null);
    }
    return relay(s, res);
  }
}
