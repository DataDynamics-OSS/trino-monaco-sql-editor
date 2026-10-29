# trino-monaco gateway (Java / Spring Boot)

Java port of the [Node reference gateway](../server-node/README.md): **one gateway session per logged-in user**, forwarding the Trino client protocol to a configured cluster. Same JSON API, same security model, same environment variables.
Spring Boot 4 (Spring MVC on Tomcat, virtual threads) + `java.net.http.HttpClient`.

## Run

```bash
cd servers/server-java
mvn package                          # target/trino-monaco-gateway.jar (Spring Boot executable jar)
TRINO_CLUSTERS='{"dev":{"url":"https://trino.example.com:8443","label":"Development","catalog":"tpch","schema":"sf1"}}' java -jar target/trino-monaco-gateway.jar
# or: mvn spring-boot:run
```

The Node gateway's environment variables work as-is (`TRINO_CLUSTERS`, `GATEWAY_HOST` / `GATEWAY_PORT`, `GATEWAY_PREFIX`, `SECURE_COOKIE`, `ALLOW_DDL`, `IDLE_TIMEOUT_MIN`, `REQUEST_TIMEOUT_SEC`, `MAX_SESSIONS_PER_USER`, `ALLOW_HEADER_AUTH`; mapped in `src/main/resources/application.properties`).
**The API and security model are documented in [`../server-node/README.md`](../server-node/README.md).**

Every setting is also a regular Spring property under `gateway.*` (`GatewayProperties`), e.g. in `application.yml`:

```yaml
gateway:
  prefix: /api
  secure-cookie: true
  idle-timeout: 30m
  request-timeout: 300s
  max-sessions-per-user: 3
  clusters:
    dev:
      url: https://trino.example.com:8443
      label: Development
      catalog: tpch
      schema: sf1
```

Other settings: `cookie-name` (`tmsid`), `source` (`trino-monaco-gateway`), `login-rate-limit-max` (5) / `login-rate-limit-window` (1m).
To use another HTTP client, define your own `Upstream` bean; `HttpUpstream` is only created when none exists.
Behind a reverse proxy, set `server.forward-headers-strategy=native` so the login rate limit sees the client address.

## Layout (`com.datadynamics.trinomonaco.gateway`)

| Class | |
|---|---|
| `GatewayApplication` | `@SpringBootApplication`, default `Upstream` bean |
| `GatewayProperties` | `gateway.*` settings with the Node defaults |
| `GatewayController` | HTTP routes, session cookie, raw SQL body |
| `SessionManager` | Sessions, login check, rate limit, idle sweep, session state, statement relay / follow / cancel |
| `ApiError` / `ApiErrorHandler` | `{ error: { code, message } }` responses (also 400 / 404 / 405) |
| `BodyLimitFilter` | 2 MiB request body limit |
| `Upstream` / `HttpUpstream` | One request to the cluster; `java.net.http` implementation (HTTP/1.1, no redirects, request timeout, trust-all TLS only for `insecureTls` clusters) |
| `GatewayTest` (test) | The Node test suite ported to JUnit 5: boots the app on a random port with a fake Trino `Upstream` |

## Differences from the Node gateway

- `IDLE_TIMEOUT_MIN` / `REQUEST_TIMEOUT_SEC` must be whole numbers (they become `30m` / `300s` durations); boolean variables accept `true` / `false` (Spring also accepts `on` / `off`, `yes` / `no`).
- `HttpClient` does not expose the HTTP reason phrase, so `TRINO_HTTP_<status>` errors without a body say `HTTP <status>`.
- A redirect from the cluster is reported as `502 TRINO_UNAVAILABLE` (Node: `fetch` with `redirect: "error"`).

## Test

```bash
mvn test        # HTTP / session / auth tests against a fake Trino cluster (no cluster needed)
```
