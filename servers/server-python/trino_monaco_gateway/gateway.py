"""
trino-monaco gateway (Python / FastAPI): per-user Trino sessions over HTTP.

Same API and security model as the Node reference gateway in ``servers/server-node/``
(see servers/server-node/README.md).

Browsers could call Trino's REST API directly, but then every page holds the
user's password and the cluster must allow cross-origin requests. Each user
instead logs in here once with their OWN Trino account; the gateway keeps the
credentials in memory for that browser session and forwards the Trino client
protocol (``POST /v1/statement``, then GET / DELETE ``nextUri``) to the
configured cluster. Trino privileges and auditing apply per user.

The gateway also keeps the client-protocol session state that Trino returns in
response headers — ``USE`` (catalog / schema), ``SET SESSION``, ``PREPARE`` and
transactions — so they persist across statements the way they do in the Trino CLI.

Security model:
  - the password is sent once to POST /sessions, checked against the cluster
    and kept only in memory (never logged or stored); later calls are
    authorised by an httpOnly, SameSite=Strict session cookie that must match
    the session id in the URL
  - clients pick a server-configured cluster alias, never a URL; follow-up
    requests are limited to ``/v1/statement/{queued|executing}/…`` of the
    queries started by the same session
  - failed logins are rate-limited per client address + alias + user
  - request timeout and DDL policy are enforced here; everything else is the
    user's own Trino privileges
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, FastAPI, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

#: JavaScript's ``\s`` (Python's differs: it adds \x1c-\x1f / \x85 and lacks \ufeff).
_WS = r"\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
#: The same characters as a plain string, for ``str.strip`` (JavaScript's ``trim()``).
_WS_CHARS = "\t\n\v\f\r \u00a0\u1680" + "".join(map(chr, range(0x2000, 0x200B))) + "\u2028\u2029\u202f\u205f\u3000\ufeff"

DDL = re.compile(rf"(CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE|DENY|SET[{_WS}]+AUTHORIZATION)\b", re.I | re.A)
LEADING = re.compile(rf"(?:[{_WS}]+|\(|--[^\n]*\n?|/\*.*?\*/)*", re.S)
EXPLAIN_ANALYZE = re.compile(rf"EXPLAIN[{_WS}]+ANALYZE[{_WS}]+(?:VERBOSE[{_WS}]+)?", re.I | re.A)

#: Client headers passed through to Trino on POST /v1/statement.
FORWARDED = [
    "x-trino-source",
    "x-trino-catalog",
    "x-trino-schema",
    "x-trino-time-zone",
    "x-trino-language",
    "x-trino-client-info",
    "x-trino-client-tags",
    "x-trino-client-capabilities",
]

#: Trino response headers that change the session state (also returned to the client).
STATE_HEADERS = [
    "x-trino-set-catalog",
    "x-trino-set-schema",
    "x-trino-set-session",
    "x-trino-clear-session",
    "x-trino-added-prepare",
    "x-trino-deallocated-prepare",
    "x-trino-started-transaction-id",
    "x-trino-clear-transaction-id",
]

#: ``/v1/statement/{queued|executing}/{queryId}/{slug}/{token}``
FOLLOW_PATH = re.compile(r"(queued|executing)/([A-Za-z0-9_]+)/[A-Za-z0-9_.-]+/[0-9]+")
STATEMENT_PATH = re.compile(r"/v1/statement/(.*)$")

#: Basic auth rejects ``:``; control characters and whitespace never belong in a user name.
USER = re.compile(rf"[^{_WS}:\x00-\x1f\x7f]+")

BODY_LIMIT = 2 * 1024 * 1024


def statement_head(sql: str) -> str:
    """Leading comments, whitespace and ``(`` removed, and ``EXPLAIN ANALYZE`` (which executes) unwrapped."""
    while True:
        s = LEADING.sub("", sql, count=1)
        m = EXPLAIN_ANALYZE.match(s)
        if not m:
            return s
        sql = s[m.end() :]


def is_ddl(sql: str) -> bool:
    return DDL.match(statement_head(sql)) is not None


def split_list(v: str | None) -> list[str]:
    return [x.strip() for x in v.split(",") if x.strip()] if v else []


def _js_len(s: str) -> int:
    """Length in UTF-16 code units, like JavaScript's ``String.length``."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _js_str(v: Any) -> str:
    """``String(v)`` for JSON values."""
    if isinstance(v, str):
        return v
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list)) else str(v)


def _reject_constant(name: str) -> Any:
    raise ValueError(f"Invalid JSON constant {name}")  # NaN / Infinity, which JSON.parse rejects


def _parse_json(text: str | bytes) -> Any:
    return json.loads(text, parse_constant=_reject_constant)


@dataclass
class ClusterTarget:
    #: Trino coordinator URL, e.g. "https://trino.example.com:8443".
    url: str
    #: Shown in the login form.
    label: str | None = None
    #: Default catalog / schema for new sessions.
    catalog: str | None = None
    schema: str | None = None
    #: "password" (default): Basic authentication with the user's password.
    #: "none": the cluster has no authentication (development only); the
    #: password is ignored and only X-Trino-User is sent.
    authentication: str = "password"
    #: Accept self-signed TLS certificates (development only).
    insecure_tls: bool = False

    @classmethod
    def from_json(cls, v: dict[str, Any]) -> ClusterTarget:
        """From one entry of the ``TRINO_CLUSTERS`` JSON (``insecureTls`` etc.)."""
        return cls(
            url=v["url"],
            label=v.get("label"),
            catalog=v.get("catalog"),
            schema=v.get("schema"),
            authentication=v["authentication"] if v.get("authentication") is not None else "password",
            insecure_tls=v.get("insecureTls") is True,
        )


#: The HTTP client to use for a cluster (tests pass one with an ``httpx.MockTransport``).
Upstream = Callable[[ClusterTarget], httpx.AsyncClient]


class HttpxUpstream:
    """Production clients: certificates are checked except for ``insecure_tls`` clusters."""

    def __init__(self, timeout_ms: int = 5 * 60_000):
        self._timeout = httpx.Timeout(timeout_ms / 1000 if timeout_ms > 0 else None)
        self._clients: dict[bool, httpx.AsyncClient] = {}

    def __call__(self, target: ClusterTarget) -> httpx.AsyncClient:
        insecure = bool(target.insecure_tls)
        if insecure not in self._clients:
            self._clients[insecure] = httpx.AsyncClient(
                verify=not insecure, timeout=self._timeout, follow_redirects=False
            )
        return self._clients[insecure]

    async def aclose(self) -> None:
        for c in self._clients.values():
            with contextlib.suppress(Exception):
                await c.aclose()
        self._clients.clear()


@dataclass
class GatewayOptions:
    #: The only clusters clients may use, by alias.
    clusters: dict[str, ClusterTarget]
    #: HTTP client per cluster. Default: an ``HttpxUpstream`` owned (and closed) by the app.
    upstream: Upstream | None = None
    #: Route prefix (also the cookie path).
    prefix: str = "/api"
    #: Close sessions idle this long (cancelling running queries).
    idle_timeout_ms: int = 30 * 60_000
    #: Concurrent sessions per alias + user.
    max_sessions_per_user: int = 3
    #: Timeout of each request to the cluster; 0 disables.
    request_timeout_ms: int = 5 * 60_000
    #: Allow DDL statements (CREATE / ALTER / DROP / …).
    allow_ddl: bool = True
    #: Mark the session cookie Secure (HTTPS only); disable only for local http development.
    secure_cookie: bool = True
    cookie_name: str = "tmsid"
    #: Also accept X-Session-Id (non-browser clients).
    allow_header_auth: bool = False
    #: X-Trino-Source when the client sends none.
    source: str = "trino-monaco-gateway"
    #: Failed logins allowed per client + alias + user within the window (count, ms).
    login_rate_limit: tuple[int, int] = (5, 60_000)


# ------------------------------------------------------------ sessions


@dataclass
class _Identity:
    user: str
    target: ClusterTarget
    #: "Basic …", or None for clusters without authentication.
    authorization: str | None


@dataclass
class _Session(_Identity):
    id: str = ""
    connect_alias: str = ""
    version: str = ""
    catalog: str | None = None
    schema: str | None = None
    #: SET SESSION properties (values URL-encoded, as on the wire).
    properties: dict[str, str] = field(default_factory=dict)
    #: PREPARE statements (name and SQL URL-encoded, as on the wire).
    prepared: dict[str, str] = field(default_factory=dict)
    transaction_id: str | None = None
    last_used: float = 0.0
    #: Running queries: query id -> latest upstream nextUri (for cancel on logout).
    queries: dict[str, str] = field(default_factory=dict)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class _UpstreamTimeout(Exception):
    pass


def _now_ms() -> float:
    return time.monotonic() * 1000


def _json(body: Any, status: int = 200) -> Response:
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    return Response(text, status_code=status, media_type="application/json; charset=utf-8")


def _error(status: int, code: str, message: str) -> Response:
    return _json({"error": {"code": code, "message": message}}, status)


async def _read_body(request: Request) -> bytes:
    """The raw request body, at most ``BODY_LIMIT`` bytes."""
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > BODY_LIMIT:
            raise ApiError(413, "BODY_TOO_LARGE", "Request body too large")
        chunks.append(chunk)
    return b"".join(chunks)


def create_gateway(options: GatewayOptions) -> FastAPI:
    o = options
    sessions: dict[str, _Session] = {}
    failures: dict[str, list[float]] = {}  # key -> [count, reset_at_ms]
    max_failures, window_ms = o.login_rate_limit
    owned = o.upstream is None
    client_for: Upstream = o.upstream or HttpxUpstream(o.request_timeout_ms)
    prefix = o.prefix

    async def upstream(
        s: _Identity, method: str, url: str, headers: dict[str, str] | None = None, body: str | None = None
    ) -> httpx.Response:
        """One request to the cluster with the session's identity."""
        h = {**(headers or {}), "X-Trino-User": s.user}
        if s.authorization:
            h["Authorization"] = s.authorization
        # Header values are byte strings (as in fetch): anything outside Latin-1 is an error.
        raw = [(k, v.encode("latin-1")) for k, v in h.items()]
        request = client_for(s.target).request(
            method,
            url,
            headers=raw,
            content=body.encode("utf-8") if body is not None else None,
            follow_redirects=False,
        )
        if o.request_timeout_ms > 0:
            try:
                res = await asyncio.wait_for(request, o.request_timeout_ms / 1000)
            except asyncio.TimeoutError:
                raise _UpstreamTimeout("The operation was aborted due to timeout") from None
        else:
            res = await request
        if res.is_redirect:  # fetch(…, { redirect: "error" })
            raise RuntimeError(f"Unexpected redirect from the cluster ({res.status_code})")
        return res

    def cluster_url(target: ClusterTarget, path: str) -> str:
        """Absolute URL on the session's cluster for a statement path."""
        return f"{target.url.rstrip('/')}/v1/statement{path}"

    def gateway_uri(s: _Session, upstream_uri: str) -> str | None:
        """Gateway path that replaces an upstream ``nextUri``."""
        parts = urlsplit(upstream_uri)
        if not parts.scheme or not parts.netloc:
            raise ValueError(f"Invalid URL: {upstream_uri}")
        m = STATEMENT_PATH.search(parts.path or "/")
        return f"{prefix}/sessions/{s.id}/v1/statement/{m.group(1)}" if m and FOLLOW_PATH.fullmatch(m.group(1)) else None

    def apply_state(s: _Session, res: httpx.Response) -> None:
        """Apply Trino's session-state response headers to the gateway session."""
        h = res.headers
        cat = h.get("x-trino-set-catalog")
        sch = h.get("x-trino-set-schema")
        if cat is not None:
            s.catalog = cat
        if sch is not None:
            s.schema = sch
        for kv in split_list(h.get("x-trino-set-session")):
            i = kv.find("=")
            if i > 0:
                s.properties[kv[:i]] = kv[i + 1 :]
        for k in split_list(h.get("x-trino-clear-session")):
            s.properties.pop(k, None)
        for kv in split_list(h.get("x-trino-added-prepare")):
            i = kv.find("=")
            if i > 0:
                s.prepared[kv[:i]] = kv[i + 1 :]
        for k in split_list(h.get("x-trino-deallocated-prepare")):
            s.prepared.pop(k, None)
        started = h.get("x-trino-started-transaction-id")
        if started:
            s.transaction_id = started
        if h.get("x-trino-clear-transaction-id") is not None:
            s.transaction_id = None

    async def relay(s: _Session, res: httpx.Response) -> Response:
        """
        Relay one statement page: update the session state, swap ``nextUri`` for
        the gateway path and track the query for cancellation.
        """
        if res.status_code == 401:
            # Password changed or account disabled since login.
            await close_session(s)
            return _error(401, "SESSION_LOST", "The cluster rejected the session's credentials")
        text = res.content.decode("utf-8", "replace")
        try:
            page = _parse_json(text)
            if not isinstance(page, dict):
                raise ValueError("not a statement page")
        except ValueError:
            status = 503 if res.status_code == 503 else 502  # Trino clients retry 503
            return _error(status, f"TRINO_HTTP_{res.status_code}", text[:500] or res.reason_phrase)
        apply_state(s, res)
        page.pop("partialCancelUri", None)
        next_uri = page.get("nextUri")
        if next_uri:
            local = gateway_uri(s, _js_str(next_uri))
            if page.get("id") and local:
                s.queries[_js_str(page["id"])] = _js_str(next_uri)
            if local:
                page["nextUri"] = local
            else:
                page.pop("nextUri", None)
        elif page.get("id"):
            s.queries.pop(_js_str(page["id"]), None)
        out = _json(page, 200 if res.is_success else res.status_code)
        for name in STATE_HEADERS:
            v = res.headers.get(name)
            if v is not None:
                out.headers[name] = v
        return out

    async def quietly(coro: Any) -> None:
        with contextlib.suppress(Exception):
            await coro

    async def cancel_queries(s: _Session) -> None:
        await asyncio.gather(*(quietly(upstream(s, "DELETE", uri)) for uri in list(s.queries.values())))
        s.queries.clear()

    async def close_session(s: _Session) -> None:
        sessions.pop(s.id, None)
        await cancel_queries(s)
        if s.transaction_id:
            # Best effort: roll back work left open in a transaction.
            await quietly(
                upstream(s, "POST", cluster_url(s.target, ""), {"X-Trino-Transaction-Id": s.transaction_id}, "ROLLBACK")
            )

    async def sweeper() -> None:
        interval = min(60.0, max(1.0, o.idle_timeout_ms / 2000))
        while True:
            await asyncio.sleep(interval)
            now = _now_ms()
            for s in list(sessions.values()):
                if now - s.last_used > o.idle_timeout_ms:
                    await quietly(close_session(s))

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        task = asyncio.create_task(sweeper())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await asyncio.gather(*(quietly(close_session(s)) for s in list(sessions.values())))
            if owned and isinstance(client_for, HttpxUpstream):
                await client_for.aclose()

    async def session_for(id: str, request: Request) -> _Session:
        """Resolve and authorise the session named in the URL."""
        from_cookie = request.cookies.get(o.cookie_name)
        from_header = request.headers.get("x-session-id") if o.allow_header_auth else None
        s = sessions.get(id)
        expired = s is not None and _now_ms() - s.last_used > o.idle_timeout_ms
        if s is None or expired or (from_cookie != id and from_header != id):
            if s is not None and expired:
                await close_session(s)
            raise ApiError(401, "SESSION_EXPIRED", "Not connected or session expired")
        s.last_used = _now_ms()
        return s

    def upstream_error(e: BaseException) -> Response:
        timeout = isinstance(e, (_UpstreamTimeout, httpx.TimeoutException))
        return _error(502, "TRINO_TIMEOUT" if timeout else "TRINO_UNAVAILABLE", str(e) or type(e).__name__)

    async def probe(s: _Identity) -> httpx.Response | None:
        """Run a statement to completion with the given identity (login check)."""
        res = await upstream(s, "POST", cluster_url(s.target, ""), {"X-Trino-Source": o.source}, "SELECT 1")
        for _ in range(1000):
            if not res.is_success:
                return res
            page = _parse_json(res.content)
            if not isinstance(page, dict):
                raise ValueError("Unexpected response to the login check")
            error = page.get("error")
            if error:
                message = error.get("message") if isinstance(error, dict) else None
                raise RuntimeError(_js_str(message) if message is not None else "Login check failed")
            if not page.get("nextUri"):
                return None
            res = await upstream(s, "GET", _js_str(page["nextUri"]))
        return None

    def info(s: _Session) -> dict[str, Any]:
        """Session description returned by the API."""
        out: dict[str, Any] = {"user": s.user, "version": s.version, "connectAlias": s.connect_alias}
        if s.catalog:
            out["catalog"] = s.catalog
        if s.schema:
            out["schema"] = s.schema
        out["inTransaction"] = bool(s.transaction_id)
        return out

    # ---------------------------------------------------------------- routes

    api = APIRouter(prefix=prefix)

    @api.get("/aliases")
    async def aliases() -> Response:
        return _json([{"alias": a, "label": t.label if t.label is not None else a} for a, t in o.clusters.items()])

    @api.post("/sessions")
    async def login(request: Request) -> Response:
        raw = await _read_body(request)
        body: Any = None
        if request.headers.get("content-type", "").split(";")[0].strip().lower() == "application/json":
            try:
                body = _parse_json(raw)
            except ValueError:
                raise ApiError(400, "BAD_REQUEST", "Invalid JSON body") from None
        if not isinstance(body, dict):
            body = {}
        alias, user, password = body.get("connectAlias"), body.get("user"), body.get("password")
        if not isinstance(alias, str) or not isinstance(user, str):
            raise ApiError(400, "BAD_REQUEST", "connectAlias and user are required")
        target = o.clusters.get(alias)
        if not target:
            raise ApiError(400, "UNKNOWN_ALIAS", f"Unknown cluster alias '{alias}'")
        needs_password = target.authentication == "password"
        if (
            not USER.fullmatch(user)
            or _js_len(user) > 256
            or (needs_password and (not isinstance(password, str) or not password or _js_len(password) > 1024))
        ):
            raise ApiError(400, "BAD_REQUEST", "Invalid user name or password")

        key = f"{request.client.host if request.client else ''}|{alias}|{user}"
        f = failures.get(key)
        if f and f[1] > _now_ms() and f[0] >= max_failures:
            raise ApiError(429, "TOO_MANY_ATTEMPTS", "Too many failed logins; try again later")
        open_count = sum(1 for s in sessions.values() if s.connect_alias == alias and s.user == user)
        if open_count >= o.max_sessions_per_user:
            raise ApiError(429, "TOO_MANY_SESSIONS", f"At most {o.max_sessions_per_user} sessions per user")

        authorization = None
        if needs_password:
            authorization = "Basic " + base64.b64encode(f"{user}:{password}".encode("utf-8", "replace")).decode()
        identity = _Identity(user=user, target=target, authorization=authorization)
        version = ""
        try:
            res = await upstream(identity, "GET", f"{target.url.rstrip('/')}/v1/info")
            if res.is_success:
                data = _parse_json(res.content)
                node = data.get("nodeVersion") if isinstance(data, dict) else None
                v = node.get("version") if isinstance(node, dict) else None
                version = _js_str(v) if v is not None else ""
            rejected = await probe(identity)
            if rejected is not None:
                if rejected.status_code in (401, 403):
                    entry = f if f and f[1] > _now_ms() else [0, _now_ms() + window_ms]
                    entry[0] += 1
                    failures[key] = entry
                    raise ApiError(401, "INVALID_CREDENTIALS", "Invalid user name or password")
                raise ApiError(502, f"TRINO_HTTP_{rejected.status_code}", rejected.reason_phrase)
        except ApiError:
            raise
        except Exception as e:  # noqa: BLE001 — unreachable cluster, timeout, bad response
            return upstream_error(e)
        failures.pop(key, None)

        s = _Session(
            user=user,
            target=target,
            authorization=authorization,
            id=secrets.token_urlsafe(24),
            connect_alias=alias,
            version=version,
            catalog=target.catalog,
            schema=target.schema,
            last_used=_now_ms(),
        )
        sessions[s.id] = s
        out = _json({"sessionId": s.id, **info(s)})
        out.set_cookie(
            o.cookie_name,
            s.id,
            httponly=True,
            samesite="Strict",  # type: ignore[arg-type]  # Starlette keeps the case: "SameSite=Strict"
            secure=o.secure_cookie,
            path=prefix,
        )
        return out

    @api.get("/sessions/{id}")
    async def get_session(id: str, request: Request) -> Response:
        return _json(info(await session_for(id, request)))

    @api.delete("/sessions/{id}")
    async def delete_session(id: str, request: Request) -> Response:
        s = await session_for(id, request)
        await close_session(s)
        out = Response(status_code=204)
        out.delete_cookie(o.cookie_name, path=prefix)
        return out

    # Trino client protocol: start a statement.
    @api.post("/sessions/{id}/v1/statement")
    async def statement(id: str, request: Request) -> Response:
        s = await session_for(id, request)
        # SQL arrives as the raw request body (text/plain, or any / no content type).
        sql = (await _read_body(request)).decode("utf-8", "replace")
        if not sql.strip(_WS_CHARS):
            raise ApiError(400, "BAD_REQUEST", "The request body must be the SQL text")
        if not o.allow_ddl and is_ddl(sql):
            raise ApiError(403, "DDL_NOT_ALLOWED", "DDL is disabled on this gateway")

        headers: dict[str, str] = {}
        for name in FORWARDED:
            values = request.headers.getlist(name)
            if values:
                headers[name] = ", ".join(values)
        headers.setdefault("x-trino-source", o.source)
        if not headers.get("x-trino-catalog") and s.catalog:
            headers["x-trino-catalog"] = s.catalog
        if not headers.get("x-trino-schema") and s.schema:
            headers["x-trino-schema"] = s.schema
        props = [f"{k}={v}" for k, v in s.properties.items()]
        client_props = request.headers.getlist("x-trino-session")
        if client_props:
            props.append(", ".join(client_props))
        if props:
            headers["x-trino-session"] = ",".join(props)
        if s.prepared:
            headers["x-trino-prepared-statement"] = ",".join(f"{k}={v}" for k, v in s.prepared.items())
        if s.transaction_id:
            headers["x-trino-transaction-id"] = s.transaction_id
        headers["content-type"] = "text/plain; charset=utf-8"

        try:
            return await relay(s, await upstream(s, "POST", cluster_url(s.target, ""), headers, sql))
        except Exception as e:  # noqa: BLE001
            return upstream_error(e)

    # Trino client protocol: follow ``nextUri`` (GET) or cancel (DELETE).
    async def follow(method: str, id: str, path: str, request: Request) -> Response:
        s = await session_for(id, request)
        m = FOLLOW_PATH.fullmatch(path)
        if not m or m.group(2) not in s.queries:
            raise ApiError(404, "QUERY_NOT_FOUND", "Unknown or finished query")
        try:
            res = await upstream(s, method, cluster_url(s.target, f"/{path}"))
            if method == "DELETE":
                s.queries.pop(m.group(2), None)
                return Response(status_code=204)
            return await relay(s, res)
        except Exception as e:  # noqa: BLE001
            return upstream_error(e)

    @api.get("/sessions/{id}/v1/statement/{path:path}")
    async def follow_get(id: str, path: str, request: Request) -> Response:
        return await follow("GET", id, path, request)

    @api.delete("/sessions/{id}/v1/statement/{path:path}")
    async def follow_delete(id: str, path: str, request: Request) -> Response:
        return await follow("DELETE", id, path, request)

    # ---------------------------------------------------------------- app

    app = FastAPI(
        title="trino-monaco gateway",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        redirect_slashes=False,
    )
    app.include_router(api)

    @app.middleware("http")
    async def body_limit(request: Request, call_next: Any) -> Response:
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > BODY_LIMIT:
            return _error(413, "BODY_TOO_LARGE", "Request body too large")
        return await call_next(request)

    # Every failure as { error: { code, message } }.
    @app.exception_handler(ApiError)
    async def api_error(_request: Request, e: ApiError) -> Response:
        return _error(e.status, e.code, e.message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, e: StarletteHTTPException) -> Response:
        if e.status_code in (404, 405):  # Fastify answers an unknown method with 404 as well
            return _error(404, "NOT_FOUND", f"Route {request.method}:{request.url.path} not found")
        return _error(e.status_code, f"HTTP_{e.status_code}", str(e.detail))

    return app
