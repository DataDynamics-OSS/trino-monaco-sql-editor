"""
Start the gateway.

    python -m trino_monaco_gateway

Configuration (environment) — the same variables as the Node gateway:
  TRINO_CLUSTERS    JSON: {"dev":{"url":"https://trino:8443","label":"Dev","catalog":"tpch","schema":"sf1"}}  (required)
  GATEWAY_HOST      default 127.0.0.1
  GATEWAY_PORT      default 8787
  GATEWAY_PREFIX    default /api
  SECURE_COOKIE     "false" only for local http development (default true)
  ALLOW_DDL         "false" to reject DDL statements (default true)
  IDLE_TIMEOUT_MIN  default 30
  REQUEST_TIMEOUT_SEC default 300 (0 disables)
  MAX_SESSIONS_PER_USER default 3
  ALLOW_HEADER_AUTH "true" to accept X-Session-Id (non-browser clients)

The cluster HTTP client is an ``HttpxUpstream`` created by the app: certificates
are verified except for aliases with ``"insecureTls": true``.

Run behind HTTPS (reverse proxy) in production.
"""
import json
import os
import sys

import uvicorn

from .gateway import ClusterTarget, GatewayOptions, create_gateway


def main() -> None:
    env = os.environ
    clusters = json.loads(env.get("TRINO_CLUSTERS") or "null")
    if not isinstance(clusters, dict) or not clusters:
        print('TRINO_CLUSTERS is required, e.g. {"dev":{"url":"http://localhost:8080","authentication":"none"}}', file=sys.stderr)
        sys.exit(1)

    app = create_gateway(
        GatewayOptions(
            clusters={alias: ClusterTarget.from_json(t) for alias, t in clusters.items()},
            prefix=env.get("GATEWAY_PREFIX", "/api"),
            secure_cookie=env.get("SECURE_COOKIE") != "false",
            allow_ddl=env.get("ALLOW_DDL") != "false",
            allow_header_auth=env.get("ALLOW_HEADER_AUTH") == "true",
            idle_timeout_ms=int(float(env.get("IDLE_TIMEOUT_MIN", "30")) * 60_000),
            request_timeout_ms=int(float(env.get("REQUEST_TIMEOUT_SEC", "300")) * 1000),
            max_sessions_per_user=int(env.get("MAX_SESSIONS_PER_USER", "3")),
        )
    )
    uvicorn.run(app, host=env.get("GATEWAY_HOST", "127.0.0.1"), port=int(env.get("GATEWAY_PORT", "8787")))


if __name__ == "__main__":
    main()
