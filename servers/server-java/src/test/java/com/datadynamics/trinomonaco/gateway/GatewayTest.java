package com.datadynamics.trinomonaco.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.datadynamics.trinomonaco.gateway.GatewayProperties.ClusterTarget;
import java.io.IOException;
import java.net.HttpCookie;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import tools.jackson.databind.json.JsonMapper;

/**
 * Gateway HTTP / session / auth tests against a fake Trino cluster (no cluster needed): the Node
 * test suite (servers/server-node/test/gateway.test.ts) ported to JUnit 5, one test per check.
 * Each {@link Env} boots the Spring Boot app on a random port with a fake {@link Upstream} bean;
 * the tests of a section share it and run in order. Run: mvn test (in servers/server-java/)
 */
class GatewayTest {

  static final JsonMapper JSON = JsonMapper.builder().build();
  static final HttpClient HTTP = HttpClient.newHttpClient();
  static final String CLUSTER = "https://trino.internal:8443";

  static String encodeURIComponent(String s) {
    return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
  }

  static String basic(String user, String password) {
    return "Basic " + Base64.getEncoder().encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8));
  }

  // ---------------------------------------------------------------- fake Trino

  record Call(String method, String path, Map<String, String> headers, String body) {}

  /** A tiny Trino coordinator: users alice/secret and bob/secret, a few canned statements. */
  static final class FakeTrino implements Upstream {
    final List<Call> calls = Collections.synchronizedList(new ArrayList<>());
    int seq;
    final Map<String, Pending> pending = new ConcurrentHashMap<>();

    record Pending(List<Object> columns, List<List<List<Object>>> pages) {}

    static Response json(Object body, Map<String, String> headers, int status) {
      Map<String, List<String>> h = new HashMap<>();
      h.put("content-type", List.of("application/json"));
      headers.forEach((k, v) -> h.put(k, List.of(v)));
      return new Response(status, h, JSON.writeValueAsString(body));
    }

    static Response json(Object body, Map<String, String> headers) {
      return json(body, headers, 200);
    }

    static Response json(Object body) {
      return json(body, Map.of(), 200);
    }

    static Map<String, Object> obj(Object... kv) {
      Map<String, Object> m = new LinkedHashMap<>();
      for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
      return m;
    }

    @Override
    public synchronized Response send(ClusterTarget target, String method, String url, Map<String, String> init, String body)
        throws IOException {
      URI u = URI.create(url);
      Map<String, String> headers = new HashMap<>();
      init.forEach((k, v) -> headers.put(k.toLowerCase(Locale.ROOT), v));
      calls.add(new Call(method, u.getPath(), headers, body));
      String origin = u.getScheme() + "://" + u.getHost() + (u.getPort() >= 0 ? ":" + u.getPort() : "");
      if (!origin.equals(CLUSTER)) throw new IOException("unexpected host " + origin);

      if (u.getPath().equals("/v1/info")) return json(obj("nodeVersion", obj("version", "470")));
      String auth = headers.get("authorization");
      boolean ok = Stream.of("alice", "bob").anyMatch(n -> basic(n, "secret").equals(auth));
      if (!ok && !"anon".equals(headers.get("x-trino-user"))) return new Response(401, Map.of(), "Unauthorized");

      if (method.equals("POST") && u.getPath().equals("/v1/statement")) {
        String sql = String.valueOf(body);
        String id = "q" + (++seq);
        if (sql.equals("BOOM")) return new Response(500, Map.of(), "<html>oops</html>");
        if (sql.startsWith("USE ")) {
          String[] cs = sql.substring(4).split("\\.");
          return json(obj("id", id, "columns", List.of()), Map.of("x-trino-set-catalog", cs[0], "x-trino-set-schema", cs[1]));
        }
        if (sql.startsWith("SET SESSION ")) {
          String[] kv = sql.substring(12).split(" = ");
          return json(obj("id", id), Map.of("x-trino-set-session", kv[0] + "=" + encodeURIComponent(kv[1])));
        }
        if (sql.startsWith("RESET SESSION ")) return json(obj("id", id), Map.of("x-trino-clear-session", sql.substring(14)));
        if (sql.equals("START TRANSACTION")) return json(obj("id", id), Map.of("x-trino-started-transaction-id", "tx-1"));
        if (sql.equals("COMMIT") || sql.equals("ROLLBACK")) return json(obj("id", id), Map.of("x-trino-clear-transaction-id", "true"));
        if (sql.startsWith("PREPARE ")) return json(obj("id", id), Map.of("x-trino-added-prepare", "p1=" + encodeURIComponent("SELECT ?")));
        if (sql.startsWith("DEALLOCATE ")) return json(obj("id", id), Map.of("x-trino-deallocated-prepare", "p1"));
        if (sql.equals("SELECT bad")) {
          return json(obj("id", id, "error", obj("message", "line 1:8: Column 'bad' cannot be resolved", "errorName", "COLUMN_NOT_FOUND")));
        }
        if (sql.equals("SELECT big")) {
          pending.put(id, new Pending(List.of(obj("name", "n", "type", "integer")),
              new ArrayList<>(List.of(List.of(List.of(1), List.of(2)), List.of(List.of(3))))));
        } else {
          pending.put(id, new Pending(List.of(obj("name", "_col0", "type", "integer")), new ArrayList<>(List.of(List.of(List.of(1))))));
        }
        return json(obj(
            "id", id,
            "nextUri", CLUSTER + "/v1/statement/executing/" + id + "/y1/1",
            "partialCancelUri", CLUSTER + "/v1/statement/executing/partialCancel/" + id + "/0/y/1",
            "stats", obj("state", "QUEUED")));
      }
      Matcher m = Pattern.compile("^/v1/statement/executing/(q\\d+)/y(\\d+)/(\\d+)$").matcher(u.getPath());
      if (m.matches()) {
        String qid = m.group(1);
        Pending q = pending.get(qid);
        if (method.equals("DELETE")) {
          pending.remove(qid);
          return new Response(204, Map.of(), "");
        }
        if (q == null) return json(obj("id", qid, "error", obj("message", "Query not found")));
        List<List<Object>> page = q.pages().remove(0);
        int n = Integer.parseInt(m.group(2)) + 1;
        boolean done = q.pages().isEmpty();
        if (done) pending.remove(qid);
        Map<String, Object> out = obj("id", qid, "columns", q.columns(), "data", page);
        if (!done) out.put("nextUri", CLUSTER + "/v1/statement/executing/" + qid + "/y" + n + "/" + n);
        return json(out);
      }
      return new Response(404, Map.of(), "Not found");
    }
  }

  // ---------------------------------------------------------------- helpers

  static final String CLUSTERS = "{\"dev\":{\"url\":\"" + CLUSTER + "\",\"label\":\"Development\",\"catalog\":\"tpch\",\"schema\":\"sf1\"},"
      + "\"open\":{\"url\":\"" + CLUSTER + "\",\"authentication\":\"none\"}}";

  record Res(int status, Object json, HttpResponse<String> raw) {
    @SuppressWarnings("unchecked")
    Map<String, Object> map() {
      return (Map<String, Object>) json;
    }

    @SuppressWarnings("unchecked")
    Object errorCode() {
      Object e = map() == null ? null : map().get("error");
      return e instanceof Map<?, ?> m ? ((Map<String, Object>) m).get("code") : null;
    }

    String header(String name) {
      return raw.headers().firstValue(name).orElse(null);
    }
  }

  record Login(Res res, String id, String cookie) {
    Map<String, Object> body() {
      return res.map();
    }
  }

  static final class Env implements AutoCloseable {
    final FakeTrino trino = new FakeTrino();
    final ConfigurableApplicationContext app;
    final int port;

    /** @param args extra Spring properties, e.g. {@code --gateway.allow-ddl=false} */
    Env(String... args) {
      this(null, args);
    }

    Env(Upstream upstream, String... args) {
      String[] base = {
        "--server.port=0",
        "--server.address=127.0.0.1",
        "--gateway.prefix=/api",
        "--gateway.clusters-json=" + CLUSTERS,
        "--gateway.secure-cookie=false",
      };
      Upstream bean = upstream != null ? upstream : trino;
      app = new SpringApplicationBuilder(GatewayApplication.class)
          .initializers(ctx -> ctx.getBeanFactory().registerSingleton("fakeUpstream", bean))
          .run(Stream.concat(Stream.of(base).filter(x -> Stream.of(args).noneMatch(a -> key(a).equals(key(x)))), Stream.of(args))
              .toArray(String[]::new));
      port = app.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
    }

    /** Extra arguments replace base ones (Spring would join repeated options with commas). */
    private static String key(String arg) {
      return arg.substring(0, arg.indexOf('=') + 1);
    }

    /** {@code path} is the full path, e.g. "/api/aliases" (or a gateway nextUri). */
    Res call(String method, String path, Map<String, String> headers, String body) throws Exception {
      HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
      headers.forEach(b::header);
      b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
      HttpResponse<String> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
      return new Res(r.statusCode(), r.body().isEmpty() ? null : JSON.readValue(r.body(), Object.class), r);
    }

    Res get(String path, Map<String, String> headers) throws Exception {
      return call("GET", path, headers, null);
    }

    Login login(String user, String password, String connectAlias) throws Exception {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("connectAlias", connectAlias);
      payload.put("user", user);
      payload.put("password", password);
      Res res = call("POST", "/api/sessions", Map.of("Content-Type", "application/json"), JSON.writeValueAsString(payload));
      Object sid = res.map() == null ? null : res.map().get("sessionId");
      return new Login(res, sid == null ? "" : (String) sid, "tmsid=" + sid);
    }

    Login login(String user, String password) throws Exception {
      return login(user, password, "dev");
    }

    Login login(String user) throws Exception {
      return login(user, "secret", "dev");
    }

    Login login() throws Exception {
      return login("alice");
    }

    Res statement(String id, String cookie, String sql, Map<String, String> headers) throws Exception {
      Map<String, String> h = new HashMap<>(headers);
      h.put("Cookie", cookie);
      h.put("Content-Type", "text/plain");
      return call("POST", "/api/sessions/" + id + "/v1/statement", h, sql);
    }

    Res statement(String id, String cookie, String sql) throws Exception {
      return statement(id, cookie, sql, Map.of());
    }

    /** POST, then follow nextUri to the end; returns pages. */
    List<Map<String, Object>> runAll(String id, String cookie, String sql) throws Exception {
      List<Map<String, Object>> pages = new ArrayList<>();
      Res res = statement(id, cookie, sql);
      for (int i = 0; i < 20; i++) {
        Map<String, Object> page = res.map();
        pages.add(page);
        if (page.get("nextUri") == null) break;
        res = get(String.valueOf(page.get("nextUri")), Map.of("Cookie", cookie));
      }
      return pages;
    }

    Call lastPost() {
      synchronized (trino.calls) {
        return trino.calls.stream().filter(c -> c.method().equals("POST")).reduce((a, b) -> b).orElseThrow();
      }
    }

    Call lastCall() {
      synchronized (trino.calls) {
        return trino.calls.get(trino.calls.size() - 1);
      }
    }

    @Override
    public void close() {
      app.close();
    }
  }

  static Map<String, String> cookie(String c) {
    return Map.of("Cookie", c);
  }

  static List<Object> list(Object... xs) {
    return Arrays.asList(xs);
  }

  /** Shared per-section lifecycle: one instance per nested class, tests in @Order. */
  @TestInstance(TestInstance.Lifecycle.PER_CLASS)
  @TestMethodOrder(MethodOrderer.OrderAnnotation.class)
  abstract static class Section {
    final List<Env> envs = new ArrayList<>();

    Env env(String... args) {
      Env e = new Env(args);
      envs.add(e);
      return e;
    }

    @AfterAll
    void closeAll() {
      envs.forEach(Env::close);
    }
  }

  // ---------------------------------------------------------------- tests

  @Nested
  @DisplayName("aliases and login")
  class AliasesAndLogin extends Section {
    Env env;
    Login ok;
    Login anon;

    @BeforeAll
    void setup() {
      env = env();
    }

    @Test @Order(1) @DisplayName("aliases")
    void aliases() throws Exception {
      assertEquals(
          List.of(Map.of("alias", "dev", "label", "Development"), Map.of("alias", "open", "label", "open")),
          env.get("/api/aliases", Map.of()).json());
    }

    @Test @Order(2) @DisplayName("wrong password → 401")
    void wrongPassword() throws Exception {
      Login bad = env.login("alice", "wrong");
      assertEquals(list(401, "INVALID_CREDENTIALS"), list(bad.res().status(), bad.res().errorCode()));
    }

    @Test @Order(3) @DisplayName("unknown alias")
    void unknownAlias() throws Exception {
      assertEquals("UNKNOWN_ALIAS", env.login("alice", "secret", "prod").res().errorCode());
    }

    @Test @Order(4) @DisplayName("missing password")
    void missingPassword() throws Exception {
      assertEquals("BAD_REQUEST", env.login("alice", "").res().errorCode());
    }

    @Test @Order(5) @DisplayName("user with ':' rejected")
    void userWithColon() throws Exception {
      assertEquals("BAD_REQUEST", env.login("a:b", "secret").res().errorCode());
    }

    @Test @Order(6) @DisplayName("login")
    void login() throws Exception {
      ok = env.login();
      Map<String, Object> expected = new LinkedHashMap<>();
      expected.put("sessionId", ok.id());
      expected.put("user", "alice");
      expected.put("version", "470");
      expected.put("connectAlias", "dev");
      expected.put("catalog", "tpch");
      expected.put("schema", "sf1");
      expected.put("inTransaction", false);
      assertEquals(list(200, expected), list(ok.res().status(), ok.body()));
    }

    @Test @Order(7) @DisplayName("cookie: httpOnly, SameSite=Strict, path")
    void cookieFlags() {
      String raw = ok.res().header("set-cookie");
      HttpCookie c = HttpCookie.parse(raw).get(0);
      String sameSite = Arrays.stream(raw.split(";")).map(String::strip)
          .filter(x -> x.toLowerCase(Locale.ROOT).startsWith("samesite=")).map(x -> x.substring(9)).findFirst().orElse(null);
      assertEquals(list("tmsid", true, true, "Strict", "/api"), list(c.getName(), ok.id().equals(c.getValue()), c.isHttpOnly(), sameSite, c.getPath()));
    }

    @Test @Order(8) @DisplayName("login probe ran SELECT 1 as the user")
    void probe() {
      Call p = env.lastPost();
      assertEquals(list("SELECT 1", "alice"), list(p.body(), p.headers().get("x-trino-user")));
    }

    @Test @Order(9) @DisplayName("session info")
    void sessionInfo() throws Exception {
      assertEquals("tpch", env.get("/api/sessions/" + ok.id(), cookie(ok.cookie())).map().get("catalog"));
    }

    @Test @Order(10) @DisplayName("authentication none: no password needed")
    void anonLogin() throws Exception {
      anon = env.login("anon", "", "open");
      assertEquals(200, anon.res().status());
    }

    @Test @Order(11) @DisplayName("authentication none: no Authorization sent")
    void anonNoAuthorization() {
      assertEquals(null, env.lastPost().headers().get("authorization"));
    }
  }

  @Nested
  @DisplayName("rate limit and session limit")
  class Limits extends Section {
    Env env;

    @BeforeAll
    void setup() {
      env = env("--gateway.login-rate-limit-max=2", "--gateway.login-rate-limit-window=60s", "--gateway.max-sessions-per-user=2");
    }

    @Test @Order(1) @DisplayName("too many failed logins")
    void tooManyAttempts() throws Exception {
      env.login("alice", "x");
      env.login("alice", "y");
      assertEquals("TOO_MANY_ATTEMPTS", env.login().res().errorCode());
    }

    @Test @Order(2) @DisplayName("too many sessions")
    void tooManySessions() throws Exception {
      env.login("bob");
      env.login("bob");
      assertEquals("TOO_MANY_SESSIONS", env.login("bob").res().errorCode());
    }
  }

  @Nested
  @DisplayName("session authorisation")
  class Authorisation extends Section {
    Env env;
    Login a;
    Login b;

    @BeforeAll
    void setup() throws Exception {
      env = env();
      a = env.login();
      b = env.login("bob");
    }

    @Test @Order(1) @DisplayName("no cookie")
    void noCookie() throws Exception {
      assertEquals(401, env.get("/api/sessions/" + a.id(), Map.of()).status());
    }

    @Test @Order(2) @DisplayName("another session's cookie")
    void otherCookie() throws Exception {
      assertEquals("SESSION_EXPIRED", env.get("/api/sessions/" + a.id(), cookie(b.cookie())).errorCode());
    }

    @Test @Order(3) @DisplayName("X-Session-Id ignored by default")
    void headerIgnored() throws Exception {
      assertEquals(401, env.get("/api/sessions/" + a.id(), Map.of("X-Session-Id", a.id())).status());
    }

    @Test @Order(4) @DisplayName("X-Session-Id when allowed")
    void headerAllowed() throws Exception {
      Env h = env("--gateway.allow-header-auth=true");
      Login s = h.login();
      assertEquals(200, h.get("/api/sessions/" + s.id(), Map.of("X-Session-Id", s.id())).status());
    }
  }

  @Nested
  @DisplayName("statements")
  class Statements extends Section {
    Env env;
    Login s;
    List<Map<String, Object>> pages;
    Call post;
    Call spoof;

    @BeforeAll
    void setup() throws Exception {
      env = env();
      s = env.login();
      pages = env.runAll(s.id(), s.cookie(), "SELECT big");
      post = env.lastPost();
    }

    @Test @Order(1) @DisplayName("nextUri points back to the gateway")
    void nextUri() {
      assertEquals("/api/sessions/" + s.id() + "/v1/statement/executing/q2/y1/1", String.valueOf(pages.get(0).get("nextUri")));
    }

    @Test @Order(2) @DisplayName("partialCancelUri removed")
    void partialCancelUri() {
      assertEquals(false, pages.get(0).containsKey("partialCancelUri"));
    }

    @Test @Order(3) @DisplayName("rows from every page")
    void rows() {
      List<Object> rows = new ArrayList<>();
      for (Map<String, Object> p : pages) if (p.get("data") instanceof List<?> d) rows.addAll(d);
      assertEquals(List.of(List.of(1), List.of(2), List.of(3)), rows);
    }

    @Test @Order(4) @DisplayName("upstream identity and defaults")
    void identity() {
      Map<String, String> h = post.headers();
      assertEquals(
          list("alice", true, "tpch", "sf1", "trino-monaco-gateway"),
          list(h.get("x-trino-user"), h.get("authorization") != null && h.get("authorization").startsWith("Basic "),
              h.get("x-trino-catalog"), h.get("x-trino-schema"), h.get("x-trino-source")));
    }

    @Test @Order(5) @DisplayName("client cannot change the user or credentials")
    void spoofing() throws Exception {
      env.statement(s.id(), s.cookie(), "SELECT 1",
          Map.of("X-Trino-User", "mallory", "Authorization", "Basic xxx", "X-Trino-Catalog", "hive", "X-Trino-Source", "editor"));
      spoof = env.lastPost();
      assertEquals(
          list("alice", true),
          list(spoof.headers().get("x-trino-user"), spoof.headers().get("authorization").equals(post.headers().get("authorization"))));
    }

    @Test @Order(6) @DisplayName("client catalog / source forwarded")
    void forwarded() {
      assertEquals(list("hive", "editor"), list(spoof.headers().get("x-trino-catalog"), spoof.headers().get("x-trino-source")));
    }

    @Test @Order(7) @DisplayName("query errors pass through")
    @SuppressWarnings("unchecked")
    void queryErrors() throws Exception {
      Map<String, Object> err = env.statement(s.id(), s.cookie(), "SELECT bad").map();
      assertEquals("COLUMN_NOT_FOUND", ((Map<String, Object>) err.get("error")).get("errorName"));
    }

    @Test @Order(8) @DisplayName("non-JSON upstream error → 502")
    void nonJson() throws Exception {
      Res boom = env.statement(s.id(), s.cookie(), "BOOM");
      assertEquals(list(502, "TRINO_HTTP_500"), list(boom.status(), boom.errorCode()));
    }

    @Test @Order(9) @DisplayName("empty body")
    void emptyBody() throws Exception {
      assertEquals(400, env.statement(s.id(), s.cookie(), "  ").status());
    }
  }

  @Nested
  @DisplayName("follow-up requests are confined to the session's queries")
  class FollowUps extends Section {
    Env env;
    Login a;
    Login b;
    Map<String, Object> first;

    @BeforeAll
    void setup() throws Exception {
      env = env();
      a = env.login();
      b = env.login("bob");
      first = env.statement(a.id(), a.cookie(), "SELECT 1").map();
    }

    @Test @Order(1) @DisplayName("another session cannot follow the query")
    void otherSession() throws Exception {
      Res other = env.get(String.valueOf(first.get("nextUri")).replace(a.id(), b.id()), cookie(b.cookie()));
      assertEquals(list(404, "QUERY_NOT_FOUND"), list(other.status(), other.errorCode()));
    }

    @Test @Order(2) @DisplayName("only statement paths")
    void onlyStatementPaths() throws Exception {
      // The raw path reaches the gateway's check (no `..` normalisation before it).
      Res r = env.get("/api/sessions/" + a.id() + "/v1/statement/../../v1/node", cookie(a.cookie()));
      assertEquals(list(404, "QUERY_NOT_FOUND"), list(r.status(), r.errorCode()));
    }

    @Test @Order(3) @DisplayName("unknown query")
    void unknownQuery() throws Exception {
      assertEquals(404, env.get("/api/sessions/" + a.id() + "/v1/statement/executing/q99/y1/1", cookie(a.cookie())).status());
    }

    @Test @Order(4) @DisplayName("cancel → 204 and upstream DELETE")
    void cancel() throws Exception {
      Res del = env.call("DELETE", String.valueOf(first.get("nextUri")), cookie(a.cookie()), null);
      Call last = env.lastCall();
      assertEquals(
          list(204, "DELETE", "/v1/statement/executing/" + first.get("id") + "/y1/1"),
          list(del.status(), last.method(), last.path()));
    }

    @Test @Order(5) @DisplayName("cancelled query is gone")
    void cancelledGone() throws Exception {
      assertEquals(404, env.get(String.valueOf(first.get("nextUri")), cookie(a.cookie())).status());
    }
  }

  @Nested
  @DisplayName("session state (USE, SET SESSION, PREPARE, transactions)")
  class SessionState extends Section {
    Env env;
    Login s;
    Res use;
    Map<String, String> h;

    @BeforeAll
    void setup() throws Exception {
      env = env();
      s = env.login();
      use = env.statement(s.id(), s.cookie(), "USE hive.web");
      env.statement(s.id(), s.cookie(), "SET SESSION query_max_run_time = 10m");
      env.statement(s.id(), s.cookie(), "PREPARE p1 FROM SELECT ?");
      env.statement(s.id(), s.cookie(), "START TRANSACTION");
      env.statement(s.id(), s.cookie(), "SELECT 1", Map.of("X-Trino-Session", "join_distribution_type=BROADCAST"));
      h = env.lastPost().headers();
    }

    @Test @Order(1) @DisplayName("state headers returned to the client")
    void stateHeaders() {
      assertEquals(list("hive", "web"), list(use.header("x-trino-set-catalog"), use.header("x-trino-set-schema")));
    }

    @Test @Order(2) @DisplayName("USE persists")
    void usePersists() {
      assertEquals(list("hive", "web"), list(h.get("x-trino-catalog"), h.get("x-trino-schema")));
    }

    @Test @Order(3) @DisplayName("SET SESSION persists (plus the client's)")
    void setSession() {
      assertEquals("query_max_run_time=10m,join_distribution_type=BROADCAST", h.get("x-trino-session"));
    }

    @Test @Order(4) @DisplayName("PREPARE persists")
    void prepare() {
      assertEquals("p1=" + encodeURIComponent("SELECT ?"), h.get("x-trino-prepared-statement"));
    }

    @Test @Order(5) @DisplayName("transaction id sent")
    void transactionId() {
      assertEquals("tx-1", h.get("x-trino-transaction-id"));
    }

    @Test @Order(6) @DisplayName("session info shows the transaction")
    void inTransaction() throws Exception {
      assertEquals(true, env.get("/api/sessions/" + s.id(), cookie(s.cookie())).map().get("inTransaction"));
    }

    @Test @Order(7) @DisplayName("RESET / DEALLOCATE / COMMIT clear the state")
    void cleared() throws Exception {
      env.statement(s.id(), s.cookie(), "RESET SESSION query_max_run_time");
      env.statement(s.id(), s.cookie(), "DEALLOCATE PREPARE p1");
      env.statement(s.id(), s.cookie(), "COMMIT");
      env.statement(s.id(), s.cookie(), "SELECT 1");
      Map<String, String> after = env.lastPost().headers();
      assertEquals(
          list(null, null, null),
          list(after.get("x-trino-session"), after.get("x-trino-prepared-statement"), after.get("x-trino-transaction-id")));
    }
  }

  @Nested
  @DisplayName("logout and lost sessions")
  class LogoutAndLostSessions extends Section {
    Env env;
    Login s;
    Res out;
    Env lost;
    volatile boolean reject;
    Login l;
    Res lostRes;

    @BeforeAll
    void setup() throws Exception {
      env = env();
      s = env.login();
      env.statement(s.id(), s.cookie(), "START TRANSACTION");
      env.statement(s.id(), s.cookie(), "SELECT big");
      out = env.call("DELETE", "/api/sessions/" + s.id(), cookie(s.cookie()), null);
    }

    @Test @Order(1) @DisplayName("logout → 204")
    void logout() {
      assertEquals(204, out.status());
    }

    @Test @Order(2) @DisplayName("logout cancels running queries")
    void cancelsQueries() {
      synchronized (env.trino.calls) {
        assertEquals(true, env.trino.calls.stream().anyMatch(c -> c.method().equals("DELETE") && c.path().startsWith("/v1/statement/executing/q3/")));
      }
    }

    @Test @Order(3) @DisplayName("logout rolls back the open transaction")
    void rollsBack() {
      Call p = env.lastPost();
      assertEquals(list("ROLLBACK", "tx-1"), list(p.body(), p.headers().get("x-trino-transaction-id")));
    }

    @Test @Order(4) @DisplayName("session closed")
    void closed() throws Exception {
      assertEquals(401, env.get("/api/sessions/" + s.id(), cookie(s.cookie())).status());
    }

    // The cluster stops accepting the credentials (password changed).

    @Test @Order(5) @DisplayName("credentials rejected → SESSION_LOST")
    void sessionLost() throws Exception {
      FakeTrino trino = new FakeTrino();
      Upstream rejecting = (target, method, url, headers, body) ->
          reject && !url.endsWith("/v1/info") ? new Upstream.Response(401, Map.of(), "") : trino.send(target, method, url, headers, body);
      lost = new Env(rejecting, "--gateway.clusters-json={\"dev\":{\"url\":\"" + CLUSTER + "\"}}");
      envs.add(lost);
      l = lost.login();
      reject = true;
      lostRes = lost.statement(l.id(), l.cookie(), "SELECT 1");
      assertEquals(list(401, "SESSION_LOST"), list(lostRes.status(), lostRes.errorCode()));
    }

    @Test @Order(6) @DisplayName("session dropped")
    void dropped() throws Exception {
      assertEquals(401, lost.get("/api/sessions/" + l.id(), cookie(l.cookie())).status());
    }
  }

  @Nested
  @DisplayName("DDL policy")
  class DdlPolicy extends Section {
    Env env;
    Login s;

    @BeforeAll
    void setup() throws Exception {
      env = env("--gateway.allow-ddl=false");
      s = env.login();
    }

    Object code(String sql) throws Exception {
      return env.statement(s.id(), s.cookie(), sql).errorCode();
    }

    @Test @Order(1) @DisplayName("CREATE rejected")
    void create() throws Exception {
      assertEquals("DDL_NOT_ALLOWED", code("CREATE TABLE t (a int)"));
    }

    @Test @Order(2) @DisplayName("after a comment")
    void afterComment() throws Exception {
      assertEquals("DDL_NOT_ALLOWED", code("-- note\n/* x */ drop table t"));
    }

    @Test @Order(3) @DisplayName("EXPLAIN ANALYZE executes, so it is checked")
    void explainAnalyze() throws Exception {
      assertEquals("DDL_NOT_ALLOWED", code("EXPLAIN ANALYZE VERBOSE ALTER TABLE t ADD COLUMN b int"));
    }

    @Test @Order(4) @DisplayName("plain EXPLAIN allowed")
    void plainExplain() throws Exception {
      assertEquals(null, code("EXPLAIN CREATE TABLE t (a int)"));
    }

    @Test @Order(5) @DisplayName("SELECT allowed")
    void select() throws Exception {
      assertEquals(null, code("SELECT 1"));
    }
  }

  @Nested
  @DisplayName("idle timeout")
  class IdleTimeout extends Section {
    @Test @Order(1) @DisplayName("idle session closed")
    void idle() throws Exception {
      Env env = env("--gateway.idle-timeout=1s");
      Login s = env.login();
      Thread.sleep(1_200);
      assertEquals(401, env.get("/api/sessions/" + s.id(), cookie(s.cookie())).status());
    }
  }
}
