# trino-monaco gateway (Python / FastAPI)

Python port of the [Node reference gateway](../server-node/README.md): **one gateway session per logged-in user**, forwarding the Trino client protocol to a configured cluster. Same JSON API, same security model, same environment variables.
[FastAPI](https://fastapi.tiangolo.com/) + uvicorn + [httpx](https://www.python-httpx.org/).

## Run

```bash
cd servers/server-python
python3 -m venv .venv && .venv/bin/pip install -e '.[test]'     # or: uv venv && uv pip install -e '.[test]'
TRINO_CLUSTERS='{"dev":{"url":"https://trino.example.com:8443","label":"Development","catalog":"tpch","schema":"sf1"}}' .venv/bin/python -m trino_monaco_gateway
```

Configuration (`TRINO_CLUSTERS`, `GATEWAY_HOST` / `GATEWAY_PORT`, `GATEWAY_PREFIX`, `SECURE_COOKIE`, `ALLOW_DDL`, `IDLE_TIMEOUT_MIN`, `REQUEST_TIMEOUT_SEC`, `MAX_SESSIONS_PER_USER`, `ALLOW_HEADER_AUTH`), the API, the error format and the security model are documented in [`../server-node/README.md`](../server-node/README.md).

Embedding in your own app:

```python
from trino_monaco_gateway import ClusterTarget, GatewayOptions, create_gateway

app = create_gateway(GatewayOptions(
    clusters={"dev": ClusterTarget("https://trino.example.com:8443", label="Development")},
))  # a FastAPI app — serve it with any ASGI server, or app.mount() it into yours
```

`GatewayOptions.upstream` takes a `ClusterTarget -> httpx.AsyncClient` callable; the default (`HttpxUpstream`) verifies certificates except for aliases with `"insecureTls": true` and is closed with the app.

## Layout

| File | |
|---|---|
| `trino_monaco_gateway/gateway.py` | FastAPI routes, session auth (cookie), session state, `nextUri` rewrite, rate limit, idle sweep, DDL check, JSON errors |
| `trino_monaco_gateway/__main__.py` | Env configuration, uvicorn |
| `tests/test_gateway.py` | The Node test suite ported to pytest, against a fake Trino cluster (`httpx.MockTransport`) |

## Differences from the Node gateway

- `POST /sessions/:id/v1/statement` takes the raw body as SQL for every content type (Fastify parses `application/json` bodies as JSON first).
- Fastify's own errors are returned in the gateway's shape: unknown routes are `404 NOT_FOUND`, oversized bodies (> 2 MiB) `413 BODY_TOO_LARGE`, malformed login JSON `400 BAD_REQUEST`.
- An expired session found on access is closed before the `401` is returned (Node closes it in the background).

## Test

```bash
.venv/bin/python -m pytest      # HTTP / session / auth tests against a fake Trino cluster (no cluster needed)
```
