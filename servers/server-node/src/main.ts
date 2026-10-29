/**
 * Start the gateway.
 *
 * Configuration (environment):
 *   TRINO_CLUSTERS    JSON: {"dev":{"url":"https://trino:8443","label":"Dev","catalog":"tpch","schema":"sf1"}}  (required)
 *   GATEWAY_HOST      default 127.0.0.1
 *   GATEWAY_PORT      default 8787
 *   GATEWAY_PREFIX    default /api
 *   SECURE_COOKIE     "false" only for local http development (default true)
 *   ALLOW_DDL         "false" to reject DDL statements (default true)
 *   IDLE_TIMEOUT_MIN  default 30
 *   REQUEST_TIMEOUT_SEC default 300 (0 disables)
 *   MAX_SESSIONS_PER_USER default 3
 *   ALLOW_HEADER_AUTH "true" to accept X-Session-Id (non-browser clients)
 *
 * Run behind HTTPS (reverse proxy) in production.
 */
import { Agent, fetch as undiciFetch } from "undici";
import { createGateway, type ClusterTarget, type UpstreamFetch } from "./gateway.js";

const env = process.env;
const clusters = JSON.parse(env.TRINO_CLUSTERS ?? "null") as Record<string, ClusterTarget> | null;
if (!clusters || !Object.keys(clusters).length) {
  console.error('TRINO_CLUSTERS is required, e.g. {"dev":{"url":"http://localhost:8080","authentication":"none"}}');
  process.exit(1);
}

// Self-signed certificates only for clusters marked `insecureTls`.
const insecure = new Agent({ connect: { rejectUnauthorized: false } });
const upstream: UpstreamFetch = (url, init, target) =>
  undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    ...(target.insecureTls ? { dispatcher: insecure } : {}),
  }) as unknown as Promise<Response>;

const app = createGateway({
  clusters,
  fetch: upstream,
  prefix: env.GATEWAY_PREFIX ?? "/api",
  secureCookie: env.SECURE_COOKIE !== "false",
  allowDdl: env.ALLOW_DDL !== "false",
  allowHeaderAuth: env.ALLOW_HEADER_AUTH === "true",
  idleTimeoutMs: Number(env.IDLE_TIMEOUT_MIN ?? 30) * 60_000,
  requestTimeoutMs: Number(env.REQUEST_TIMEOUT_SEC ?? 300) * 1000,
  maxSessionsPerUser: Number(env.MAX_SESSIONS_PER_USER ?? 3),
  logger: true,
});

const host = env.GATEWAY_HOST ?? "127.0.0.1";
const port = Number(env.GATEWAY_PORT ?? 8787);
await app.listen({ host, port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
