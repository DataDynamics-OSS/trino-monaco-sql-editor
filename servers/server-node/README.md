# trino-monaco gateway

Reference HTTP gateway for `trino-monaco`: **one gateway session per logged-in user**, forwarding the Trino client protocol to a configured cluster.
Fastify + the built-in `fetch` (undici).

A browser could call Trino's REST API directly, but every page would then hold the user's password and the cluster would have to allow cross-origin requests. With the gateway, the user logs in once with **their own Trino account**; the browser keeps only an httpOnly session cookie, and the editor's existing `createTrinoQueryRunner` / `createTrinoMetadataProvider` talk to the gateway through `createTrinoGatewayClient()` (see the root README).

The same API is also implemented in Python ([`../server-python`](../server-python/README.md), FastAPI + httpx) and Java ([`../server-java`](../server-java/README.md), Spring Boot + `java.net.http`); this README is the API and security reference for all three.

## Run

```bash
cd servers/server-node
npm install
TRINO_CLUSTERS='{"dev":{"url":"https://trino.example.com:8443","label":"Development","catalog":"tpch","schema":"sf1"}}' npm start
```

| Variable | Default | |
|---|---|---|
| `TRINO_CLUSTERS` | — (required) | JSON `{ alias: { url, label?, catalog?, schema?, authentication?, insecureTls? } }`. Clients pick an alias; they never send a URL. `authentication`: `"password"` (default, Basic auth) or `"none"` (cluster without authentication — development only). `insecureTls: true` accepts self-signed certificates (development only). |
| `GATEWAY_HOST` / `GATEWAY_PORT` | `127.0.0.1` / `8787` | |
| `GATEWAY_PREFIX` | `/api` | Route prefix (also the cookie path). |
| `SECURE_COOKIE` | `true` | Set `false` **only** for local http development. |
| `ALLOW_DDL` | `true` | `false` rejects CREATE / ALTER / DROP / TRUNCATE / COMMENT / GRANT / REVOKE / DENY / SET AUTHORIZATION (statement text check, also under `EXPLAIN ANALYZE`; rely on Trino access control for real enforcement). |
| `IDLE_TIMEOUT_MIN` | `30` | Idle sessions are closed: running queries are cancelled and an open transaction is rolled back. |
| `REQUEST_TIMEOUT_SEC` | `300` | Timeout of each request to the cluster; `0` disables. |
| `MAX_SESSIONS_PER_USER` | `3` | Per alias + user (browser tabs). |
| `ALLOW_HEADER_AUTH` | `false` | Accept `X-Session-Id` instead of the cookie (CLIs, Node tests). |

Run it behind an HTTPS reverse proxy on the same origin as the web app (the session cookie is `SameSite=Strict`).

## Security model

- Users log in with **their own Trino account**; Trino access control, resource groups and auditing apply per user.
- The password is sent once to `POST /sessions` and checked against the cluster (`SELECT 1`). Trino authenticates every HTTP request, so the gateway keeps the credentials **in memory only** for the life of the session — never logged or written anywhere — and drops them on logout or idle timeout.
- Later calls are authorised by an `httpOnly`, `SameSite=Strict`, `Secure` cookie that must equal the session id in the URL.
- The user is always the session's: the client's `X-Trino-User` and `Authorization` headers are never forwarded.
- Follow-up requests are limited to `/v1/statement/{queued|executing}/{queryId}/{slug}/{token}` of queries started by the same session; anything else is `404 QUERY_NOT_FOUND`.
- Failed logins (401 / 403 from the cluster) are rate-limited per client address + alias + user (5 per minute).
- If the cluster later rejects the credentials (password changed, account disabled), the session is dropped (`SESSION_LOST`, 401).

## API (prefix `/api`)

| Method | Path | Body → Response |
|---|---|---|
| `GET` | `/aliases` | → `[{ alias, label }]` |
| `POST` | `/sessions` | `{ connectAlias, user, password }` → `{ sessionId, user, version, connectAlias, catalog?, schema?, inTransaction }` + cookie |
| `GET` | `/sessions/:id` | → `{ user, version, connectAlias, catalog?, schema?, inTransaction }` |
| `DELETE` | `/sessions/:id` | cancel running queries, roll back an open transaction → 204 |
| `POST` | `/sessions/:id/v1/statement` | SQL text (`text/plain`) → Trino statement page |
| `GET` | `/sessions/:id/v1/statement/{queued\|executing}/…` | → next Trino statement page |
| `DELETE` | `/sessions/:id/v1/statement/{queued\|executing}/…` | cancel the query → 204 |

The `/v1/statement` routes are the [Trino client protocol](https://trino.io/docs/current/develop/client-protocol.html), relayed as-is with these changes:

- `nextUri` is rewritten to the gateway path (`/api/sessions/:id/v1/statement/…`); `partialCancelUri` is removed.
- Allowed client headers on `POST`: `X-Trino-Source` (default `trino-monaco-gateway`), `X-Trino-Catalog`, `X-Trino-Schema`, `X-Trino-Session`, `X-Trino-Time-Zone`, `X-Trino-Language`, `X-Trino-Client-Info`, `X-Trino-Client-Tags`, `X-Trino-Client-Capabilities`. Everything else is dropped.
- **Session state** is kept by the gateway, like the Trino CLI does: the `X-Trino-Set-Catalog` / `-Set-Schema` (`USE`), `-Set-Session` / `-Clear-Session` (`SET` / `RESET SESSION`), `-Added-Prepare` / `-Deallocated-Prepare` (`PREPARE` / `DEALLOCATE`) and `-Started-Transaction-Id` / `-Clear-Transaction-Id` (`START TRANSACTION` / `COMMIT` / `ROLLBACK`) response headers update the session and are sent on later statements (`X-Trino-Catalog`, `-Schema`, `-Session`, `-Prepared-Statement`, `-Transaction-Id`). A client `X-Trino-Catalog` / `-Schema` overrides the session's for that statement; a client `X-Trino-Session` is appended. The state headers are also returned to the client.
- Query errors stay inside the Trino page (`200` with `error`), as Trino sends them.

Gateway errors: `{ error: { code, message } }` — `400 BAD_REQUEST` / `UNKNOWN_ALIAS`, `401 INVALID_CREDENTIALS` / `SESSION_EXPIRED` / `SESSION_LOST`, `403 DDL_NOT_ALLOWED`, `404 QUERY_NOT_FOUND`, `429 TOO_MANY_ATTEMPTS` / `TOO_MANY_SESSIONS`, `502 TRINO_UNAVAILABLE` / `TRINO_TIMEOUT` / `TRINO_HTTP_<status>` (`503` stays `503`, which Trino clients retry). The Trino client in this library reads `error.message` from both shapes.

## Test

```bash
npm test              # HTTP / session / auth tests against a fake Trino cluster (no cluster needed)
```
