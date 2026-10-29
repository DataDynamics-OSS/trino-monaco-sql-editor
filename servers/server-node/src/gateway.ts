/**
 * trino-monaco gateway: per-user Trino sessions over HTTP.
 *
 * Browsers could call Trino's REST API directly, but then every page holds
 * the user's password and the cluster must allow cross-origin requests. Each
 * user instead logs in here once with their OWN Trino account; the gateway
 * keeps the credentials in memory for that browser session and forwards the
 * Trino client protocol (`POST /v1/statement`, then GET / DELETE `nextUri`)
 * to the configured cluster. Trino privileges and auditing apply per user.
 *
 * The gateway also keeps the client-protocol session state that Trino
 * returns in response headers — `USE` (catalog / schema), `SET SESSION`,
 * `PREPARE` and transactions — so they persist across statements the way
 * they do in the Trino CLI.
 *
 * Security model:
 *   - the password is sent once to POST /sessions, checked against the
 *     cluster and kept only in memory (never logged or stored); later calls
 *     are authorised by an httpOnly, SameSite=Strict session cookie that must
 *     match the session id in the URL
 *   - clients pick a server-configured cluster alias, never a URL; follow-up
 *     requests are limited to `/v1/statement/{queued|executing}/…` of the
 *     queries started by the same session
 *   - failed logins are rate-limited per client address + alias + user
 *   - request timeout and DDL policy are enforced here; everything else is
 *     the user's own Trino privileges
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { randomBytes } from "node:crypto";

export interface ClusterTarget {
  /** Trino coordinator URL, e.g. "https://trino.example.com:8443". */
  url: string;
  /** Shown in the login form. */
  label?: string;
  /** Default catalog / schema for new sessions. */
  catalog?: string;
  schema?: string;
  /**
   * `"password"` (default): Basic authentication with the user's password.
   * `"none"`: the cluster has no authentication (development only); the
   * password is ignored and only `X-Trino-User` is sent.
   */
  authentication?: "password" | "none";
  /** Accept self-signed TLS certificates (development only). */
  insecureTls?: boolean;
}

/** `fetch` plus the per-cluster TLS option (`main.ts` maps it to an undici Agent). */
export type UpstreamFetch = (url: string, init: RequestInit, target: ClusterTarget) => Promise<Response>;

export interface GatewayOptions {
  /** The only clusters clients may use, by alias. */
  clusters: Record<string, ClusterTarget>;
  /** HTTP client for the cluster (tests pass a fake). Default: global fetch. */
  fetch?: UpstreamFetch;
  /** Route prefix. Default "/api". */
  prefix?: string;
  /** Close sessions idle this long (cancelling running queries). Default 30 min. */
  idleTimeoutMs?: number;
  /** Concurrent sessions per alias + user. Default 3. */
  maxSessionsPerUser?: number;
  /** Timeout of each request to the cluster; 0 disables. Default 5 min. */
  requestTimeoutMs?: number;
  /** Allow DDL statements (CREATE / ALTER / DROP / …). Default true. */
  allowDdl?: boolean;
  /** Mark the session cookie Secure (HTTPS only). Default true; disable only for local http dev. */
  secureCookie?: boolean;
  /** Session cookie name. Default "tmsid". */
  cookieName?: string;
  /** Also accept `X-Session-Id` (non-browser clients). Default false. */
  allowHeaderAuth?: boolean;
  /** `X-Trino-Source` when the client sends none. Default "trino-monaco-gateway". */
  source?: string;
  /** Failed logins allowed per client + alias + user within the window. Default 5 per minute. */
  loginRateLimit?: { max: number; windowMs: number };
  /** Fastify logger. Default false. */
  logger?: boolean;
}

interface Session {
  id: string;
  user: string;
  connectAlias: string;
  target: ClusterTarget;
  /** `Basic …`, or undefined for clusters without authentication. */
  authorization?: string;
  version: string;
  catalog?: string;
  schema?: string;
  /** SET SESSION properties (values URL-encoded, as on the wire). */
  properties: Map<string, string>;
  /** PREPARE statements (name and SQL URL-encoded, as on the wire). */
  prepared: Map<string, string>;
  transactionId?: string;
  lastUsed: number;
  /** Running queries: query id → latest upstream nextUri (for cancel on logout). */
  queries: Map<string, string>;
}

interface ApiError {
  code: string;
  message: string;
}

interface StatementPage {
  id?: string;
  nextUri?: string;
  partialCancelUri?: string;
  [key: string]: unknown;
}

const DDL = /^(CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE|DENY|SET\s+AUTHORIZATION)\b/i;

/** Leading comments, whitespace and `(` removed, and `EXPLAIN ANALYZE` (which executes) unwrapped. */
function statementHead(sql: string): string {
  const s = sql.replace(/^(?:\s+|\(|--[^\n]*\n?|\/\*[\s\S]*?\*\/)*/, "");
  const m = /^EXPLAIN\s+ANALYZE\s+(?:VERBOSE\s+)?/i.exec(s);
  return m ? statementHead(s.slice(m[0].length)) : s;
}

/** Client headers passed through to Trino on POST /v1/statement. */
const FORWARDED = [
  "x-trino-source",
  "x-trino-catalog",
  "x-trino-schema",
  "x-trino-time-zone",
  "x-trino-language",
  "x-trino-client-info",
  "x-trino-client-tags",
  "x-trino-client-capabilities",
];

/** Trino response headers that change the session state (also returned to the client). */
const STATE_HEADERS = [
  "x-trino-set-catalog",
  "x-trino-set-schema",
  "x-trino-set-session",
  "x-trino-clear-session",
  "x-trino-added-prepare",
  "x-trino-deallocated-prepare",
  "x-trino-started-transaction-id",
  "x-trino-clear-transaction-id",
];

/** `/v1/statement/{queued|executing}/{queryId}/{slug}/{token}` */
const FOLLOW_PATH = /^(queued|executing)\/([A-Za-z0-9_]+)\/[A-Za-z0-9_.-]+\/\d+$/;

/** Basic auth rejects `:`; control characters and whitespace never belong in a user name. */
const USER = /^[^\s:\x00-\x1f\x7f]{1,256}$/;

const splitList = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

const defaultFetch: UpstreamFetch = (url, init) => fetch(url, init);

export function createGateway(options: GatewayOptions): FastifyInstance {
  const {
    clusters,
    fetch: upstreamFetch = defaultFetch,
    prefix = "/api",
    idleTimeoutMs = 30 * 60_000,
    maxSessionsPerUser = 3,
    requestTimeoutMs = 5 * 60_000,
    allowDdl = true,
    secureCookie = true,
    cookieName = "tmsid",
    allowHeaderAuth = false,
    source = "trino-monaco-gateway",
    loginRateLimit = { max: 5, windowMs: 60_000 },
  } = options;

  const sessions = new Map<string, Session>();
  const failures = new Map<string, { count: number; resetAt: number }>();

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  void app.register(cookie);
  // SQL arrives as the raw request body (text/plain, or no content type at all).
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  const fail = (reply: FastifyReply, status: number, error: ApiError) => reply.code(status).send({ error });

  /** One request to the cluster with the session's identity. */
  function upstream(
    s: Pick<Session, "user" | "authorization" | "target">,
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<Response> {
    const h: Record<string, string> = { ...headers, "X-Trino-User": s.user };
    if (s.authorization) h["Authorization"] = s.authorization;
    return upstreamFetch(
      url,
      {
        method,
        headers: h,
        body,
        redirect: "error",
        ...(requestTimeoutMs > 0 ? { signal: AbortSignal.timeout(requestTimeoutMs) } : {}),
      },
      s.target,
    );
  }

  /** Absolute URL on the session's cluster for a statement path. */
  const clusterUrl = (target: ClusterTarget, path: string) => `${target.url.replace(/\/+$/, "")}/v1/statement${path}`;

  /** Gateway path that replaces an upstream `nextUri`. */
  function gatewayUri(s: Session, upstreamUri: string): string | undefined {
    const m = /\/v1\/statement\/(.*)$/.exec(new URL(upstreamUri).pathname);
    return m && FOLLOW_PATH.test(m[1]) ? `${prefix}/sessions/${s.id}/v1/statement/${m[1]}` : undefined;
  }

  /** Apply Trino's session-state response headers to the gateway session. */
  function applyState(s: Session, res: Response): void {
    const h = res.headers;
    const cat = h.get("x-trino-set-catalog");
    const sch = h.get("x-trino-set-schema");
    if (cat !== null) s.catalog = cat;
    if (sch !== null) s.schema = sch;
    for (const kv of splitList(h.get("x-trino-set-session"))) {
      const i = kv.indexOf("=");
      if (i > 0) s.properties.set(kv.slice(0, i), kv.slice(i + 1));
    }
    for (const k of splitList(h.get("x-trino-clear-session"))) s.properties.delete(k);
    for (const kv of splitList(h.get("x-trino-added-prepare"))) {
      const i = kv.indexOf("=");
      if (i > 0) s.prepared.set(kv.slice(0, i), kv.slice(i + 1));
    }
    for (const k of splitList(h.get("x-trino-deallocated-prepare"))) s.prepared.delete(k);
    const started = h.get("x-trino-started-transaction-id");
    if (started) s.transactionId = started;
    if (h.get("x-trino-clear-transaction-id") !== null) s.transactionId = undefined;
  }

  /**
   * Relay one statement page: update the session state, swap `nextUri` for
   * the gateway path and track the query for cancellation.
   */
  async function relay(s: Session, res: Response, reply: FastifyReply): Promise<unknown> {
    if (res.status === 401) {
      // Password changed or account disabled since login.
      await closeSession(s);
      return fail(reply, 401, { code: "SESSION_LOST", message: "The cluster rejected the session's credentials" });
    }
    const text = await res.text();
    let page: StatementPage;
    try {
      page = JSON.parse(text) as StatementPage;
    } catch {
      const status = res.status === 503 ? 503 : 502; // Trino clients retry 503
      return fail(reply, status, { code: `TRINO_HTTP_${res.status}`, message: text.slice(0, 500) || res.statusText });
    }
    applyState(s, res);
    for (const name of STATE_HEADERS) {
      const v = res.headers.get(name);
      if (v !== null) reply.header(name, v);
    }
    delete page.partialCancelUri;
    if (page.nextUri) {
      const local = gatewayUri(s, page.nextUri);
      if (page.id && local) s.queries.set(page.id, page.nextUri);
      if (local) page.nextUri = local;
      else delete page.nextUri;
    } else if (page.id) {
      s.queries.delete(page.id);
    }
    return reply.code(res.ok ? 200 : res.status).send(page);
  }

  async function cancelQueries(s: Session): Promise<void> {
    await Promise.all(
      [...s.queries.values()].map((uri) => upstream(s, "DELETE", uri).then((r) => r.body?.cancel(), () => {})),
    );
    s.queries.clear();
  }

  async function closeSession(s: Session): Promise<void> {
    sessions.delete(s.id);
    await cancelQueries(s);
    if (s.transactionId) {
      // Best effort: roll back work left open in a transaction.
      await upstream(s, "POST", clusterUrl(s.target, ""), { "X-Trino-Transaction-Id": s.transactionId }, "ROLLBACK")
        .then((r) => r.body?.cancel(), () => {});
    }
  }

  // Idle sweeper.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (now - s.lastUsed > idleTimeoutMs) void closeSession(s);
    }
  }, Math.min(60_000, Math.max(1_000, idleTimeoutMs / 2)));
  sweep.unref();

  app.addHook("onClose", async () => {
    clearInterval(sweep);
    await Promise.all([...sessions.values()].map(closeSession));
  });

  /** Resolve and authorise the session named in the URL. */
  function sessionFor(req: FastifyRequest, reply: FastifyReply): Session | undefined {
    const { id } = req.params as { id: string };
    const fromCookie = req.cookies?.[cookieName];
    const fromHeader = allowHeaderAuth ? req.headers["x-session-id"] : undefined;
    const s = sessions.get(id);
    const expired = !!s && Date.now() - s.lastUsed > idleTimeoutMs;
    if (!s || expired || (fromCookie !== id && fromHeader !== id)) {
      if (s && expired) void closeSession(s);
      fail(reply, 401, { code: "SESSION_EXPIRED", message: "Not connected or session expired" });
      return undefined;
    }
    s.lastUsed = Date.now();
    return s;
  }

  const upstreamError = (reply: FastifyReply, e: unknown) =>
    fail(reply, 502, {
      code: (e as Error)?.name === "TimeoutError" ? "TRINO_TIMEOUT" : "TRINO_UNAVAILABLE",
      message: String((e as Error)?.message ?? e),
    });

  /** Run a statement to completion with the given identity (login check). */
  async function probe(s: Pick<Session, "user" | "authorization" | "target">): Promise<Response | undefined> {
    let res = await upstream(s, "POST", clusterUrl(s.target, ""), { "X-Trino-Source": source }, "SELECT 1");
    for (let i = 0; i < 1000; i++) {
      if (!res.ok) return res;
      const page = (await res.json()) as StatementPage & { error?: { message?: string } };
      if (page.error) throw new Error(page.error.message ?? "Login check failed");
      if (!page.nextUri) return undefined;
      res = await upstream(s, "GET", page.nextUri);
    }
    return undefined;
  }

  /** Session description returned by the API. */
  const info = (s: Session) => ({
    user: s.user,
    version: s.version,
    connectAlias: s.connectAlias,
    ...(s.catalog ? { catalog: s.catalog } : {}),
    ...(s.schema ? { schema: s.schema } : {}),
    inTransaction: !!s.transactionId,
  });

  // ---------------------------------------------------------------- routes

  app.register(async (api) => {
    api.get("/aliases", async () =>
      Object.entries(clusters).map(([alias, t]) => ({ alias, label: t.label ?? alias })),
    );

    api.post("/sessions", async (req, reply) => {
      const { connectAlias, user, password } = (typeof req.body === "object" && req.body ? req.body : {}) as Record<string, unknown>;
      if (typeof connectAlias !== "string" || typeof user !== "string") {
        return fail(reply, 400, { code: "BAD_REQUEST", message: "connectAlias and user are required" });
      }
      const target = clusters[connectAlias];
      if (!target) return fail(reply, 400, { code: "UNKNOWN_ALIAS", message: `Unknown cluster alias '${connectAlias}'` });
      const needsPassword = (target.authentication ?? "password") === "password";
      if (!USER.test(user) || (needsPassword && (typeof password !== "string" || !password || password.length > 1024))) {
        return fail(reply, 400, { code: "BAD_REQUEST", message: "Invalid user name or password" });
      }

      const key = `${req.ip}|${connectAlias}|${user}`;
      const f = failures.get(key);
      if (f && f.resetAt > Date.now() && f.count >= loginRateLimit.max) {
        return fail(reply, 429, { code: "TOO_MANY_ATTEMPTS", message: "Too many failed logins; try again later" });
      }
      const open = [...sessions.values()].filter((s) => s.connectAlias === connectAlias && s.user === user).length;
      if (open >= maxSessionsPerUser) {
        return fail(reply, 429, { code: "TOO_MANY_SESSIONS", message: `At most ${maxSessionsPerUser} sessions per user` });
      }

      const identity = {
        user,
        target,
        authorization: needsPassword ? "Basic " + Buffer.from(`${user}:${password as string}`).toString("base64") : undefined,
      };
      let version = "";
      try {
        const info = await upstream(identity, "GET", `${target.url.replace(/\/+$/, "")}/v1/info`);
        if (info.ok) version = String(((await info.json()) as { nodeVersion?: { version?: string } }).nodeVersion?.version ?? "");
        const rejected = await probe(identity);
        if (rejected) {
          await rejected.body?.cancel();
          if (rejected.status === 401 || rejected.status === 403) {
            const entry = f && f.resetAt > Date.now() ? f : { count: 0, resetAt: Date.now() + loginRateLimit.windowMs };
            entry.count++;
            failures.set(key, entry);
            return fail(reply, 401, { code: "INVALID_CREDENTIALS", message: "Invalid user name or password" });
          }
          return fail(reply, 502, { code: `TRINO_HTTP_${rejected.status}`, message: rejected.statusText });
        }
      } catch (e) {
        return upstreamError(reply, e);
      }
      failures.delete(key);

      const s: Session = {
        id: randomBytes(24).toString("base64url"),
        ...identity,
        connectAlias,
        version,
        catalog: target.catalog,
        schema: target.schema,
        properties: new Map(),
        prepared: new Map(),
        lastUsed: Date.now(),
        queries: new Map(),
      };
      sessions.set(s.id, s);
      reply.setCookie(cookieName, s.id, { httpOnly: true, sameSite: "strict", secure: secureCookie, path: prefix });
      return { sessionId: s.id, ...info(s) };
    });

    api.get("/sessions/:id", async (req, reply) => {
      const s = sessionFor(req, reply);
      if (!s) return;
      return info(s);
    });

    api.delete("/sessions/:id", async (req, reply) => {
      const s = sessionFor(req, reply);
      if (!s) return;
      await closeSession(s);
      reply.clearCookie(cookieName, { path: prefix });
      return reply.code(204).send();
    });

    // Trino client protocol: start a statement.
    api.post("/sessions/:id/v1/statement", async (req, reply) => {
      const s = sessionFor(req, reply);
      if (!s) return;
      const sql = typeof req.body === "string" ? req.body : "";
      if (!sql.trim()) return fail(reply, 400, { code: "BAD_REQUEST", message: "The request body must be the SQL text" });
      if (!allowDdl && DDL.test(statementHead(sql))) {
        return fail(reply, 403, { code: "DDL_NOT_ALLOWED", message: "DDL is disabled on this gateway" });
      }

      const headers: Record<string, string> = {};
      for (const name of FORWARDED) {
        const v = req.headers[name];
        if (typeof v === "string") headers[name] = v;
      }
      headers["x-trino-source"] ??= source;
      if (!headers["x-trino-catalog"] && s.catalog) headers["x-trino-catalog"] = s.catalog;
      if (!headers["x-trino-schema"] && s.schema) headers["x-trino-schema"] = s.schema;
      const props = [...s.properties].map(([k, v]) => `${k}=${v}`);
      const clientProps = req.headers["x-trino-session"];
      if (typeof clientProps === "string") props.push(clientProps);
      if (props.length) headers["x-trino-session"] = props.join(",");
      if (s.prepared.size) {
        headers["x-trino-prepared-statement"] = [...s.prepared].map(([k, v]) => `${k}=${v}`).join(",");
      }
      if (s.transactionId) headers["x-trino-transaction-id"] = s.transactionId;
      headers["content-type"] = "text/plain; charset=utf-8";

      try {
        return await relay(s, await upstream(s, "POST", clusterUrl(s.target, ""), headers, sql), reply);
      } catch (e) {
        return upstreamError(reply, e);
      }
    });

    // Trino client protocol: follow `nextUri` (GET) or cancel (DELETE).
    const follow = (method: "GET" | "DELETE") => async (req: FastifyRequest, reply: FastifyReply) => {
      const s = sessionFor(req, reply);
      if (!s) return;
      const path = (req.params as Record<string, string>)["*"] ?? "";
      const m = FOLLOW_PATH.exec(path);
      if (!m || !s.queries.has(m[2])) return fail(reply, 404, { code: "QUERY_NOT_FOUND", message: "Unknown or finished query" });
      try {
        const res = await upstream(s, method, clusterUrl(s.target, `/${path}`));
        if (method === "DELETE") {
          s.queries.delete(m[2]);
          await res.body?.cancel();
          return reply.code(204).send();
        }
        return await relay(s, res, reply);
      } catch (e) {
        return upstreamError(reply, e);
      }
    };
    api.get("/sessions/:id/v1/statement/*", follow("GET"));
    api.delete("/sessions/:id/v1/statement/*", follow("DELETE"));
  }, { prefix });

  return app;
}
