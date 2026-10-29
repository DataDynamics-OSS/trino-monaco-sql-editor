/* Gateway HTTP / session / auth tests against a fake Trino cluster (no cluster needed). Run: npm test (in servers/server-node/) */
import { createGateway, type GatewayOptions, type UpstreamFetch } from "../src/gateway.js";

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n     got: ${JSON.stringify(actual)}\n     expected: ${JSON.stringify(expected)}`}`);
}
const section = (n: string) => console.log(`\n■ ${n}`);

// ---------------------------------------------------------------- fake Trino

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

const CLUSTER = "https://trino.internal:8443";

/** A tiny Trino coordinator: users alice/secret and bob/secret, a few canned statements. */
function fakeTrino() {
  const calls: Call[] = [];
  let seq = 0;
  const pending = new Map<string, { columns: unknown[]; pages: unknown[][][] }>();
  const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  const fetch: UpstreamFetch = async (url, init) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method: init.method ?? "GET", path: u.pathname, headers, body: init.body as string | undefined });
    if (u.origin !== CLUSTER) throw new Error(`unexpected host ${u.origin}`);

    if (u.pathname === "/v1/info") return json({ nodeVersion: { version: "470" } });
    const ok = ["alice", "bob"].some((n) => headers.authorization === "Basic " + Buffer.from(`${n}:secret`).toString("base64"));
    if (!ok && headers["x-trino-user"] !== "anon") return new Response("Unauthorized", { status: 401 });

    if (init.method === "POST" && u.pathname === "/v1/statement") {
      const sql = String(init.body);
      const id = `q${++seq}`;
      const next = (n: number) => `${CLUSTER}/v1/statement/executing/${id}/y${n}/${n}`;
      if (sql === "BOOM") return new Response("<html>oops</html>", { status: 500 });
      if (sql.startsWith("USE ")) {
        const [cat, sch] = sql.slice(4).split(".");
        return json({ id, columns: [] }, { "x-trino-set-catalog": cat, "x-trino-set-schema": sch });
      }
      if (sql.startsWith("SET SESSION ")) {
        const [k, v] = sql.slice(12).split(" = ");
        return json({ id }, { "x-trino-set-session": `${k}=${encodeURIComponent(v)}` });
      }
      if (sql.startsWith("RESET SESSION ")) return json({ id }, { "x-trino-clear-session": sql.slice(14) });
      if (sql === "START TRANSACTION") return json({ id }, { "x-trino-started-transaction-id": "tx-1" });
      if (sql === "COMMIT" || sql === "ROLLBACK") return json({ id }, { "x-trino-clear-transaction-id": "true" });
      if (sql.startsWith("PREPARE ")) return json({ id }, { "x-trino-added-prepare": `p1=${encodeURIComponent("SELECT ?")}` });
      if (sql.startsWith("DEALLOCATE ")) return json({ id }, { "x-trino-deallocated-prepare": "p1" });
      if (sql === "SELECT bad") return json({ id, error: { message: "line 1:8: Column 'bad' cannot be resolved", errorName: "COLUMN_NOT_FOUND" } });
      if (sql === "SELECT big") {
        pending.set(id, { columns: [{ name: "n", type: "integer" }], pages: [[[1], [2]], [[3]]] });
      } else {
        pending.set(id, { columns: [{ name: "_col0", type: "integer" }], pages: [[[1]]] });
      }
      return json({ id, nextUri: next(1), partialCancelUri: `${CLUSTER}/v1/statement/executing/partialCancel/${id}/0/y/1`, stats: { state: "QUEUED" } });
    }
    const m = /^\/v1\/statement\/executing\/(q\d+)\/y(\d+)\/(\d+)$/.exec(u.pathname);
    if (m) {
      const q = pending.get(m[1]);
      if (init.method === "DELETE") {
        pending.delete(m[1]);
        return new Response(null, { status: 204 });
      }
      if (!q) return json({ id: m[1], error: { message: "Query not found" } });
      const page = q.pages.shift()!;
      const n = Number(m[2]) + 1;
      const done = q.pages.length === 0;
      if (done) pending.delete(m[1]);
      return json({ id: m[1], columns: q.columns, data: page, ...(done ? {} : { nextUri: `${CLUSTER}/v1/statement/executing/${m[1]}/y${n}/${n}` }) });
    }
    return new Response("Not found", { status: 404 });
  };
  return { fetch, calls };
}

// ---------------------------------------------------------------- helpers

function setup(extra: Partial<GatewayOptions> = {}) {
  const trino = fakeTrino();
  const app = createGateway({
    clusters: {
      dev: { url: CLUSTER, label: "Development", catalog: "tpch", schema: "sf1" },
      open: { url: CLUSTER, authentication: "none" },
    },
    fetch: trino.fetch,
    secureCookie: false,
    ...extra,
  });
  return { app, trino };
}

type App = ReturnType<typeof setup>["app"];

async function login(app: App, user = "alice", password = "secret", connectAlias = "dev") {
  const res = await app.inject({ method: "POST", url: "/api/sessions", payload: { connectAlias, user, password } });
  const body = res.json() as { sessionId?: string; error?: { code: string } };
  return { res, body, id: body.sessionId ?? "", cookie: `tmsid=${body.sessionId}` };
}

async function statement(app: App, id: string, cookie: string, sql: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: `/api/sessions/${id}/v1/statement`, headers: { cookie, "content-type": "text/plain", ...headers }, payload: sql });
}

/** POST, then follow nextUri to the end; returns pages. */
async function runAll(app: App, id: string, cookie: string, sql: string) {
  const pages: Record<string, unknown>[] = [];
  let res = await statement(app, id, cookie, sql);
  for (let i = 0; i < 20; i++) {
    const page = res.json() as Record<string, unknown>;
    pages.push(page);
    if (!page.nextUri) break;
    res = await app.inject({ method: "GET", url: String(page.nextUri), headers: { cookie } });
  }
  return pages;
}

const lastPost = (calls: Call[]) => calls.filter((c) => c.method === "POST").at(-1)!;

// ---------------------------------------------------------------- tests

section("aliases and login");
{
  const { app, trino } = setup();
  eq("aliases", (await app.inject("/api/aliases")).json(), [{ alias: "dev", label: "Development" }, { alias: "open", label: "open" }]);

  const bad = await login(app, "alice", "wrong");
  eq("wrong password → 401", [bad.res.statusCode, bad.body.error?.code], [401, "INVALID_CREDENTIALS"]);
  eq("unknown alias", (await login(app, "alice", "secret", "prod")).body.error?.code, "UNKNOWN_ALIAS");
  eq("missing password", (await login(app, "alice", "")).body.error?.code, "BAD_REQUEST");
  eq("user with ':' rejected", (await login(app, "a:b", "secret")).body.error?.code, "BAD_REQUEST");

  const ok = await login(app);
  eq("login", [ok.res.statusCode, ok.body], [200, { sessionId: ok.id, user: "alice", version: "470", connectAlias: "dev", catalog: "tpch", schema: "sf1", inTransaction: false }]);
  const c = ok.res.cookies.find((x) => x.name === "tmsid");
  eq("cookie: httpOnly, SameSite=Strict, path", [c?.value === ok.id, c?.httpOnly, c?.sameSite, c?.path], [true, true, "Strict", "/api"]);
  eq("login probe ran SELECT 1 as the user", [lastPost(trino.calls).body, lastPost(trino.calls).headers["x-trino-user"]], ["SELECT 1", "alice"]);
  eq("session info", (await app.inject({ url: `/api/sessions/${ok.id}`, headers: { cookie: ok.cookie } })).json().catalog, "tpch");

  const anon = await login(app, "anon", "", "open");
  eq("authentication none: no password needed", anon.res.statusCode, 200);
  eq("authentication none: no Authorization sent", lastPost(trino.calls).headers.authorization, undefined);
  await app.close();
}

section("rate limit and session limit");
{
  const { app } = setup({ loginRateLimit: { max: 2, windowMs: 60_000 }, maxSessionsPerUser: 2 });
  await login(app, "alice", "x");
  await login(app, "alice", "y");
  eq("too many failed logins", (await login(app)).body.error?.code, "TOO_MANY_ATTEMPTS");
  await login(app, "bob");
  await login(app, "bob");
  eq("too many sessions", (await login(app, "bob")).body.error?.code, "TOO_MANY_SESSIONS");
  await app.close();
}

section("session authorisation");
{
  const { app } = setup();
  const a = await login(app);
  const b = await login(app, "bob");
  eq("no cookie", (await app.inject({ url: `/api/sessions/${a.id}` })).statusCode, 401);
  eq("another session's cookie", (await app.inject({ url: `/api/sessions/${a.id}`, headers: { cookie: b.cookie } })).json().error.code, "SESSION_EXPIRED");
  eq("X-Session-Id ignored by default", (await app.inject({ url: `/api/sessions/${a.id}`, headers: { "x-session-id": a.id } })).statusCode, 401);
  await app.close();

  const h = setup({ allowHeaderAuth: true });
  const s = await login(h.app);
  eq("X-Session-Id when allowed", (await h.app.inject({ url: `/api/sessions/${s.id}`, headers: { "x-session-id": s.id } })).statusCode, 200);
  await h.app.close();
}

section("statements");
{
  const { app, trino } = setup();
  const { id, cookie } = await login(app);
  const pages = await runAll(app, id, cookie, "SELECT big");
  eq("nextUri points back to the gateway", String(pages[0].nextUri), `/api/sessions/${id}/v1/statement/executing/q2/y1/1`);
  eq("partialCancelUri removed", "partialCancelUri" in pages[0], false);
  eq("rows from every page", pages.flatMap((p) => (p.data as unknown[][]) ?? []), [[1], [2], [3]]);
  const post = lastPost(trino.calls);
  eq("upstream identity and defaults", [post.headers["x-trino-user"], post.headers.authorization?.startsWith("Basic "), post.headers["x-trino-catalog"], post.headers["x-trino-schema"], post.headers["x-trino-source"]], ["alice", true, "tpch", "sf1", "trino-monaco-gateway"]);

  await statement(app, id, cookie, "SELECT 1", { "x-trino-user": "mallory", authorization: "Basic xxx", "x-trino-catalog": "hive", "x-trino-source": "editor" });
  const spoof = lastPost(trino.calls);
  eq("client cannot change the user or credentials", [spoof.headers["x-trino-user"], spoof.headers.authorization === post.headers.authorization], ["alice", true]);
  eq("client catalog / source forwarded", [spoof.headers["x-trino-catalog"], spoof.headers["x-trino-source"]], ["hive", "editor"]);

  const err = (await statement(app, id, cookie, "SELECT bad")).json();
  eq("query errors pass through", err.error.errorName, "COLUMN_NOT_FOUND");
  const boom = await statement(app, id, cookie, "BOOM");
  eq("non-JSON upstream error → 502", [boom.statusCode, boom.json().error.code], [502, "TRINO_HTTP_500"]);
  eq("empty body", (await statement(app, id, cookie, "  ")).statusCode, 400);
  await app.close();
}

section("follow-up requests are confined to the session's queries");
{
  const { app, trino } = setup();
  const a = await login(app);
  const b = await login(app, "bob");
  const first = (await statement(app, a.id, a.cookie, "SELECT 1")).json();
  const other = await app.inject({ url: String(first.nextUri).replace(a.id, b.id), headers: { cookie: b.cookie } });
  eq("another session cannot follow the query", [other.statusCode, other.json().error.code], [404, "QUERY_NOT_FOUND"]);
  eq("only statement paths", (await app.inject({ url: `/api/sessions/${a.id}/v1/statement/../../v1/node`, headers: { cookie: a.cookie } })).statusCode, 404);
  eq("unknown query", (await app.inject({ url: `/api/sessions/${a.id}/v1/statement/executing/q99/y1/1`, headers: { cookie: a.cookie } })).statusCode, 404);

  const del = await app.inject({ method: "DELETE", url: String(first.nextUri), headers: { cookie: a.cookie } });
  eq("cancel → 204 and upstream DELETE", [del.statusCode, trino.calls.at(-1)?.method, trino.calls.at(-1)?.path], [204, "DELETE", `/v1/statement/executing/${first.id}/y1/1`]);
  eq("cancelled query is gone", (await app.inject({ url: String(first.nextUri), headers: { cookie: a.cookie } })).statusCode, 404);
  await app.close();
}

section("session state (USE, SET SESSION, PREPARE, transactions)");
{
  const { app, trino } = setup();
  const { id, cookie } = await login(app);
  const use = await statement(app, id, cookie, "USE hive.web");
  eq("state headers returned to the client", [use.headers["x-trino-set-catalog"], use.headers["x-trino-set-schema"]], ["hive", "web"]);
  await statement(app, id, cookie, "SET SESSION query_max_run_time = 10m");
  await statement(app, id, cookie, "PREPARE p1 FROM SELECT ?");
  await statement(app, id, cookie, "START TRANSACTION");
  await statement(app, id, cookie, "SELECT 1", { "x-trino-session": "join_distribution_type=BROADCAST" });
  const h = lastPost(trino.calls).headers;
  eq("USE persists", [h["x-trino-catalog"], h["x-trino-schema"]], ["hive", "web"]);
  eq("SET SESSION persists (plus the client's)", h["x-trino-session"], "query_max_run_time=10m,join_distribution_type=BROADCAST");
  eq("PREPARE persists", h["x-trino-prepared-statement"], `p1=${encodeURIComponent("SELECT ?")}`);
  eq("transaction id sent", h["x-trino-transaction-id"], "tx-1");
  eq("session info shows the transaction", (await app.inject({ url: `/api/sessions/${id}`, headers: { cookie } })).json().inTransaction, true);

  await statement(app, id, cookie, "RESET SESSION query_max_run_time");
  await statement(app, id, cookie, "DEALLOCATE PREPARE p1");
  await statement(app, id, cookie, "COMMIT");
  await statement(app, id, cookie, "SELECT 1");
  const after = lastPost(trino.calls).headers;
  eq("RESET / DEALLOCATE / COMMIT clear the state", [after["x-trino-session"], after["x-trino-prepared-statement"], after["x-trino-transaction-id"]], [undefined, undefined, undefined]);
  await app.close();
}

section("logout and lost sessions");
{
  const { app, trino } = setup();
  const { id, cookie } = await login(app);
  await statement(app, id, cookie, "START TRANSACTION");
  await statement(app, id, cookie, "SELECT big");
  const out = await app.inject({ method: "DELETE", url: `/api/sessions/${id}`, headers: { cookie } });
  eq("logout → 204", out.statusCode, 204);
  eq("logout cancels running queries", trino.calls.some((c) => c.method === "DELETE" && c.path.startsWith("/v1/statement/executing/q3/")), true);
  eq("logout rolls back the open transaction", [lastPost(trino.calls).body, lastPost(trino.calls).headers["x-trino-transaction-id"]], ["ROLLBACK", "tx-1"]);
  eq("session closed", (await app.inject({ url: `/api/sessions/${id}`, headers: { cookie } })).statusCode, 401);
  await app.close();
}
{
  // The cluster stops accepting the credentials (password changed).
  const trino = fakeTrino();
  let reject = false;
  const app = createGateway({
    clusters: { dev: { url: CLUSTER } },
    fetch: (url, init, t) => (reject && !url.endsWith("/v1/info") ? Promise.resolve(new Response("", { status: 401 })) : trino.fetch(url, init, t)),
    secureCookie: false,
  });
  const { id, cookie } = await login(app);
  reject = true;
  const res = await statement(app, id, cookie, "SELECT 1");
  eq("credentials rejected → SESSION_LOST", [res.statusCode, res.json().error.code], [401, "SESSION_LOST"]);
  eq("session dropped", (await app.inject({ url: `/api/sessions/${id}`, headers: { cookie } })).statusCode, 401);
  await app.close();
}

section("DDL policy");
{
  const { app } = setup({ allowDdl: false });
  const { id, cookie } = await login(app);
  const code = async (sql: string) => (await statement(app, id, cookie, sql)).json().error?.code;
  eq("CREATE rejected", await code("CREATE TABLE t (a int)"), "DDL_NOT_ALLOWED");
  eq("after a comment", await code("-- note\n/* x */ drop table t"), "DDL_NOT_ALLOWED");
  eq("EXPLAIN ANALYZE executes, so it is checked", await code("EXPLAIN ANALYZE VERBOSE ALTER TABLE t ADD COLUMN b int"), "DDL_NOT_ALLOWED");
  eq("plain EXPLAIN allowed", await code("EXPLAIN CREATE TABLE t (a int)"), undefined);
  eq("SELECT allowed", await code("SELECT 1"), undefined);
  await app.close();
}

section("idle timeout");
{
  const { app } = setup({ idleTimeoutMs: 1_000 });
  const { id, cookie } = await login(app);
  await new Promise((r) => setTimeout(r, 1_200));
  eq("idle session closed", (await app.inject({ url: `/api/sessions/${id}`, headers: { cookie } })).statusCode, 401);
  await app.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
