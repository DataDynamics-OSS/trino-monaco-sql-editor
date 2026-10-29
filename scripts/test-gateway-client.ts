/*
 * End-to-end test: library client → Node gateway (servers/server-node) → fake
 * Trino over real HTTP. Needs `npm install` in servers/server-node.
 * Run: npm run test:gateway
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createGateway } from "../servers/server-node/src/gateway.js";
import { createTrinoGatewayClient, TrinoGatewayError } from "../src/trino/gateway.js";
import { createTrinoQueryRunner } from "../src/trino/runner.js";
import { createTrinoMetadataProvider } from "../src/trino/metadata.js";

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n     got: ${JSON.stringify(actual)}\n     expected: ${JSON.stringify(expected)}`}`);
}

// Fake Trino: user alice/secret; a few canned statements, two pages each.
const seen: { sql: string; catalog?: string; schema?: string; user?: string }[] = [];
const cancelled: string[] = [];
const results: Record<string, { columns: { name: string; type: string }[]; rows: unknown[][] }> = {
  "SELECT 42": { columns: [{ name: "answer", type: "integer" }], rows: [[42]] },
  "SHOW CATALOGS": { columns: [{ name: "Catalog", type: "varchar" }], rows: [["hive"], ["tpch"]] },
  'SHOW SCHEMAS FROM "tpch"': { columns: [{ name: "Schema", type: "varchar" }], rows: [["sf1"], ["tiny"]] },
  'SHOW TABLES FROM "tpch"."tiny"': { columns: [{ name: "Table", type: "varchar" }], rows: [["nation"], ["orders"]] },
};
const body = (req: IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
let seq = 0;
const pending = new Map<string, unknown[][]>();
const trino = createServer(async (req, res) => {
  const base = `http://127.0.0.1:${(trino.address() as AddressInfo).port}`;
  const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(json));
  };
  if (req.url === "/v1/info") return send(200, { nodeVersion: { version: "470" } });
  if (req.headers.authorization !== "Basic " + Buffer.from("alice:secret").toString("base64")) {
    res.writeHead(401);
    return res.end();
  }
  if (req.method === "POST" && req.url === "/v1/statement") {
    const sql = await body(req);
    seen.push({ sql, catalog: req.headers["x-trino-catalog"] as string, schema: req.headers["x-trino-schema"] as string, user: req.headers["x-trino-user"] as string });
    const id = `q${++seq}`;
    if (sql.startsWith("USE ")) {
      const [c, s] = sql.slice(4).split(".");
      return send(200, { id }, { "x-trino-set-catalog": c, "x-trino-set-schema": s });
    }
    if (sql === "SELECT slow") {
      pending.set(id, []);
      return send(200, { id, nextUri: `${base}/v1/statement/executing/${id}/y/1` });
    }
    const r = results[sql] ?? { columns: [{ name: "_col0", type: "integer" }], rows: [[1]] };
    pending.set(id, r.rows);
    return send(200, { id, columns: r.columns, nextUri: `${base}/v1/statement/executing/${id}/y/1` });
  }
  const m = /^\/v1\/statement\/executing\/(q\d+)\/y\/1$/.exec(req.url ?? "");
  if (m && req.method === "DELETE") {
    cancelled.push(m[1]);
    res.writeHead(204);
    return res.end();
  }
  if (m) {
    const rows = pending.get(m[1]) ?? [];
    if (rows.length === 0 && seen.at(-1)?.sql === "SELECT slow") {
      // never finishes: keep polling
      await new Promise((r) => setTimeout(r, 50));
      return send(200, { id: m[1], nextUri: `${base}/v1/statement/executing/${m[1]}/y/1` });
    }
    pending.delete(m[1]);
    return send(200, { id: m[1], data: rows });
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((r) => trino.listen(0, "127.0.0.1", r));
const trinoUrl = `http://127.0.0.1:${(trino.address() as AddressInfo).port}`;

const gateway = createGateway({ clusters: { dev: { url: trinoUrl, label: "Dev", catalog: "tpch", schema: "sf1" } }, secureCookie: false, allowHeaderAuth: true });
await gateway.listen({ host: "127.0.0.1", port: 0 });
const gatewayUrl = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}/api`;

const gw = createTrinoGatewayClient({ baseUrl: gatewayUrl, headerAuth: true });

console.log("=== gateway client ===");
eq("aliases", await gw.aliases(), [{ alias: "dev", label: "Dev" }]);
const bad = await gw.login({ connectAlias: "dev", user: "alice", password: "nope" }).catch((e: TrinoGatewayError) => [e.name, e.code, e.status]);
eq("wrong password → TrinoGatewayError", bad, ["TrinoGatewayError", "INVALID_CREDENTIALS", 401]);
const session = await gw.login({ connectAlias: "dev", user: "alice", password: "secret" });
eq("login", [session.user, session.version, session.catalog, session.schema], ["alice", "470", "tpch", "sf1"]);

const conn = gw.connection(session);
const run = createTrinoQueryRunner(conn);
const r = await run("SELECT 42");
eq("query runner through the gateway", [r.columns, r.rows], [[{ name: "answer", type: "integer" }], [[42]]]);
eq("Trino saw the session user and default schema", seen.at(-1), { sql: "SELECT 42", catalog: "tpch", schema: "sf1", user: "alice" });

await run("USE tpch.tiny");
eq("USE updates the client session", [session.catalog, session.schema], ["tpch", "tiny"]);
const meta = createTrinoMetadataProvider(conn);
const items = await meta({ text: "SELECT * FROM ", position: { line: 1, column: 15 }, word: "", expectTable: true, qualifier: [] });
eq("metadata provider uses the new schema", items.filter((i) => i.kind === "table").map((i) => i.label), ["nation", "orders"]);
eq("catalogs too", items.filter((i) => i.kind === "catalog").map((i) => i.label), ["hive", "tpch"]);

const ctrl = new AbortController();
const slow = run("SELECT slow", { signal: ctrl.signal }).catch((e: Error) => e.name);
await new Promise((r) => setTimeout(r, 200));
ctrl.abort();
eq("abort rejects", await slow, "AbortError");
await new Promise((r) => setTimeout(r, 100));
eq("abort cancels the query on the cluster", cancelled.length, 1);

eq("refresh", (await gw.refresh(session)).schema, "tiny");
await gw.logout(session);
const after = await run("SELECT 42").catch((e: Error) => e.message);
eq("after logout the session is gone", after, "Not connected or session expired");

await gateway.close();
trino.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
