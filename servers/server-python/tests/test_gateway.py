"""Gateway HTTP / session / auth tests against a fake Trino cluster (no cluster needed). Run: pytest (in servers/server-python/)"""
from __future__ import annotations

import base64
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import quote

import httpx
import pytest
from fastapi.testclient import TestClient

from trino_monaco_gateway import ClusterTarget, GatewayOptions, HttpxUpstream, create_gateway
from trino_monaco_gateway.gateway import statement_head

# ---------------------------------------------------------------- fake Trino

CLUSTER = "https://trino.internal:8443"


def encode_uri_component(v: str) -> str:
    return quote(v, safe="!~*'()")


def basic(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


@dataclass
class Call:
    method: str
    path: str
    headers: dict[str, str]
    body: str | None


@dataclass
class FakeTrino:
    """A tiny Trino coordinator: users alice/secret and bob/secret, a few canned statements."""

    calls: list[Call] = field(default_factory=list)
    seq: int = 0
    pending: dict[str, dict[str, Any]] = field(default_factory=dict)

    def handle(self, request: httpx.Request) -> httpx.Response:
        u = request.url
        headers = {k.lower(): v for k, v in request.headers.items()}
        body = request.content.decode() if request.content else None
        self.calls.append(Call(request.method, u.path, headers, body))
        if f"{u.scheme}://{u.host}:{u.port}" != CLUSTER:
            raise RuntimeError(f"unexpected host {u.host}")

        def json(payload: Any, extra: dict[str, str] | None = None, status: int = 200) -> httpx.Response:
            return httpx.Response(status, json=payload, headers=extra or {})

        if u.path == "/v1/info":
            return json({"nodeVersion": {"version": "470"}})
        ok = headers.get("authorization") in (basic("alice", "secret"), basic("bob", "secret"))
        if not ok and headers.get("x-trino-user") != "anon":
            return httpx.Response(401, text="Unauthorized")

        if request.method == "POST" and u.path == "/v1/statement":
            sql = body or ""
            self.seq += 1
            id = f"q{self.seq}"

            def next_uri(n: int) -> str:
                return f"{CLUSTER}/v1/statement/executing/{id}/y{n}/{n}"

            if sql == "BOOM":
                return httpx.Response(500, text="<html>oops</html>")
            if sql.startswith("USE "):
                cat, sch = sql[4:].split(".")
                return json({"id": id, "columns": []}, {"x-trino-set-catalog": cat, "x-trino-set-schema": sch})
            if sql.startswith("SET SESSION "):
                k, v = sql[12:].split(" = ")
                return json({"id": id}, {"x-trino-set-session": f"{k}={encode_uri_component(v)}"})
            if sql.startswith("RESET SESSION "):
                return json({"id": id}, {"x-trino-clear-session": sql[14:]})
            if sql == "START TRANSACTION":
                return json({"id": id}, {"x-trino-started-transaction-id": "tx-1"})
            if sql in ("COMMIT", "ROLLBACK"):
                return json({"id": id}, {"x-trino-clear-transaction-id": "true"})
            if sql.startswith("PREPARE "):
                return json({"id": id}, {"x-trino-added-prepare": f"p1={encode_uri_component('SELECT ?')}"})
            if sql.startswith("DEALLOCATE "):
                return json({"id": id}, {"x-trino-deallocated-prepare": "p1"})
            if sql == "SELECT bad":
                return json(
                    {"id": id, "error": {"message": "line 1:8: Column 'bad' cannot be resolved", "errorName": "COLUMN_NOT_FOUND"}}
                )
            if sql == "SELECT big":
                self.pending[id] = {"columns": [{"name": "n", "type": "integer"}], "pages": [[[1], [2]], [[3]]]}
            else:
                self.pending[id] = {"columns": [{"name": "_col0", "type": "integer"}], "pages": [[[1]]]}
            return json(
                {
                    "id": id,
                    "nextUri": next_uri(1),
                    "partialCancelUri": f"{CLUSTER}/v1/statement/executing/partialCancel/{id}/0/y/1",
                    "stats": {"state": "QUEUED"},
                }
            )
        m = re.fullmatch(r"/v1/statement/executing/(q\d+)/y(\d+)/(\d+)", u.path)
        if m:
            q = self.pending.get(m.group(1))
            if request.method == "DELETE":
                self.pending.pop(m.group(1), None)
                return httpx.Response(204)
            if not q:
                return json({"id": m.group(1), "error": {"message": "Query not found"}})
            page = q["pages"].pop(0)
            n = int(m.group(2)) + 1
            done = not q["pages"]
            if done:
                self.pending.pop(m.group(1), None)
            out = {"id": m.group(1), "columns": q["columns"], "data": page}
            if not done:
                out["nextUri"] = f"{CLUSTER}/v1/statement/executing/{m.group(1)}/y{n}/{n}"
            return json(out)
        return httpx.Response(404, text="Not found")


# ---------------------------------------------------------------- helpers


def upstream_for(handler: Callable[[httpx.Request], httpx.Response]) -> Callable[[ClusterTarget], httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return lambda _target: client


def setup(**extra: Any) -> tuple[TestClient, FakeTrino]:
    trino = FakeTrino()
    opts: dict[str, Any] = dict(
        clusters={
            "dev": ClusterTarget(CLUSTER, label="Development", catalog="tpch", schema="sf1"),
            "open": ClusterTarget(CLUSTER, authentication="none"),
        },
        upstream=upstream_for(trino.handle),
        secure_cookie=False,
    )
    opts.update(extra)
    return TestClient(create_gateway(GatewayOptions(**opts))), trino


class Login:
    def __init__(self, client: TestClient, user: str = "alice", password: str = "secret", connect_alias: str = "dev"):
        self.res = client.post("/api/sessions", json={"connectAlias": connect_alias, "user": user, "password": password})
        client.cookies.clear()  # every test sends credentials explicitly
        self.body = self.res.json()
        self.id: str = self.body.get("sessionId", "")
        self.cookie = f"tmsid={self.id}"
        self.headers = {"cookie": self.cookie}

    @property
    def code(self) -> str | None:
        return (self.body.get("error") or {}).get("code")


def statement(client: TestClient, id: str, cookie: str, sql: str, headers: dict[str, str] | None = None) -> httpx.Response:
    return client.post(
        f"/api/sessions/{id}/v1/statement",
        headers={"cookie": cookie, "content-type": "text/plain", **(headers or {})},
        content=sql.encode(),
    )


def run_all(client: TestClient, id: str, cookie: str, sql: str) -> list[dict[str, Any]]:
    """POST, then follow nextUri to the end; returns pages."""
    pages: list[dict[str, Any]] = []
    res = statement(client, id, cookie, sql)
    for _ in range(20):
        page = res.json()
        pages.append(page)
        if not page.get("nextUri"):
            break
        res = client.get(str(page["nextUri"]), headers={"cookie": cookie})
    return pages


def last_post(calls: list[Call]) -> Call:
    return [c for c in calls if c.method == "POST"][-1]


def error_code(res: httpx.Response) -> str | None:
    return (res.json().get("error") or {}).get("code")


def parse_set_cookie(header: str) -> dict[str, Any]:
    first, *attrs = [p.strip() for p in header.split(";")]
    name, _, value = first.partition("=")
    out: dict[str, Any] = {"name": name, "value": value, "httpOnly": False, "secure": False}
    for a in attrs:
        k, _, v = a.partition("=")
        if k.lower() == "httponly":
            out["httpOnly"] = True
        elif k.lower() == "secure":
            out["secure"] = True
        elif k.lower() == "samesite":
            out["sameSite"] = v
        elif k.lower() == "path":
            out["path"] = v
    return out


# ---------------------------------------------------------------- tests


def test_aliases_and_login() -> None:
    client, trino = setup()
    with client:
        assert client.get("/api/aliases").json() == [
            {"alias": "dev", "label": "Development"},
            {"alias": "open", "label": "open"},
        ], "aliases"

        bad = Login(client, "alice", "wrong")
        assert [bad.res.status_code, bad.code] == [401, "INVALID_CREDENTIALS"], "wrong password → 401"
        assert Login(client, "alice", "secret", "prod").code == "UNKNOWN_ALIAS", "unknown alias"
        assert Login(client, "alice", "").code == "BAD_REQUEST", "missing password"
        assert Login(client, "a:b", "secret").code == "BAD_REQUEST", "user with ':' rejected"

        ok = Login(client)
        assert [ok.res.status_code, ok.body] == [
            200,
            {"sessionId": ok.id, "user": "alice", "version": "470", "connectAlias": "dev", "catalog": "tpch", "schema": "sf1", "inTransaction": False},
        ], "login"
        c = parse_set_cookie(ok.res.headers["set-cookie"])
        assert [c["name"], c["value"] == ok.id, c["httpOnly"], c.get("sameSite"), c.get("path")] == [
            "tmsid",
            True,
            True,
            "Strict",
            "/api",
        ], "cookie: httpOnly, SameSite=Strict, path"
        post = last_post(trino.calls)
        assert [post.body, post.headers["x-trino-user"]] == ["SELECT 1", "alice"], "login probe ran SELECT 1 as the user"
        assert client.get(f"/api/sessions/{ok.id}", headers=ok.headers).json()["catalog"] == "tpch", "session info"

        anon = Login(client, "anon", "", "open")
        assert anon.res.status_code == 200, "authentication none: no password needed"
        assert "authorization" not in last_post(trino.calls).headers, "authentication none: no Authorization sent"


def test_rate_limit_and_session_limit() -> None:
    client, _ = setup(login_rate_limit=(2, 60_000), max_sessions_per_user=2)
    with client:
        Login(client, "alice", "x")
        Login(client, "alice", "y")
        assert Login(client).code == "TOO_MANY_ATTEMPTS", "too many failed logins"
        Login(client, "bob")
        Login(client, "bob")
        assert Login(client, "bob").code == "TOO_MANY_SESSIONS", "too many sessions"


def test_session_authorisation() -> None:
    client, _ = setup()
    with client:
        a = Login(client)
        b = Login(client, "bob")
        assert client.get(f"/api/sessions/{a.id}").status_code == 401, "no cookie"
        assert error_code(client.get(f"/api/sessions/{a.id}", headers=b.headers)) == "SESSION_EXPIRED", "another session's cookie"
        assert client.get(f"/api/sessions/{a.id}", headers={"x-session-id": a.id}).status_code == 401, "X-Session-Id ignored by default"

    client, _ = setup(allow_header_auth=True)
    with client:
        s = Login(client)
        assert client.get(f"/api/sessions/{s.id}", headers={"x-session-id": s.id}).status_code == 200, "X-Session-Id when allowed"


def test_statements() -> None:
    client, trino = setup()
    with client:
        s = Login(client)
        pages = run_all(client, s.id, s.cookie, "SELECT big")
        assert str(pages[0]["nextUri"]) == f"/api/sessions/{s.id}/v1/statement/executing/q2/y1/1", "nextUri points back to the gateway"
        assert "partialCancelUri" not in pages[0], "partialCancelUri removed"
        assert [row for p in pages for row in p.get("data") or []] == [[1], [2], [3]], "rows from every page"
        post = last_post(trino.calls)
        assert [
            post.headers["x-trino-user"],
            post.headers.get("authorization", "").startswith("Basic "),
            post.headers["x-trino-catalog"],
            post.headers["x-trino-schema"],
            post.headers["x-trino-source"],
        ] == ["alice", True, "tpch", "sf1", "trino-monaco-gateway"], "upstream identity and defaults"

        statement(
            client,
            s.id,
            s.cookie,
            "SELECT 1",
            {"x-trino-user": "mallory", "authorization": "Basic xxx", "x-trino-catalog": "hive", "x-trino-source": "editor"},
        )
        spoof = last_post(trino.calls)
        assert [spoof.headers["x-trino-user"], spoof.headers["authorization"] == post.headers["authorization"]] == [
            "alice",
            True,
        ], "client cannot change the user or credentials"
        assert [spoof.headers["x-trino-catalog"], spoof.headers["x-trino-source"]] == ["hive", "editor"], "client catalog / source forwarded"

        err = statement(client, s.id, s.cookie, "SELECT bad").json()
        assert err["error"]["errorName"] == "COLUMN_NOT_FOUND", "query errors pass through"
        boom = statement(client, s.id, s.cookie, "BOOM")
        assert [boom.status_code, error_code(boom)] == [502, "TRINO_HTTP_500"], "non-JSON upstream error → 502"
        assert statement(client, s.id, s.cookie, "  ").status_code == 400, "empty body"


def test_follow_up_requests_are_confined_to_the_sessions_queries() -> None:
    client, trino = setup()
    with client:
        a = Login(client)
        b = Login(client, "bob")
        first = statement(client, a.id, a.cookie, "SELECT 1").json()
        other = client.get(str(first["nextUri"]).replace(a.id, b.id), headers=b.headers)
        assert [other.status_code, error_code(other)] == [404, "QUERY_NOT_FOUND"], "another session cannot follow the query"
        assert client.get(f"/api/sessions/{a.id}/v1/statement/../../v1/node", headers=a.headers).status_code == 404, "only statement paths"
        assert client.get(f"/api/sessions/{a.id}/v1/statement/executing/q99/y1/1", headers=a.headers).status_code == 404, "unknown query"

        delete = client.delete(str(first["nextUri"]), headers=a.headers)
        assert [delete.status_code, trino.calls[-1].method, trino.calls[-1].path] == [
            204,
            "DELETE",
            f"/v1/statement/executing/{first['id']}/y1/1",
        ], "cancel → 204 and upstream DELETE"
        assert client.get(str(first["nextUri"]), headers=a.headers).status_code == 404, "cancelled query is gone"


def test_session_state() -> None:
    """USE, SET SESSION, PREPARE, transactions."""
    client, trino = setup()
    with client:
        s = Login(client)
        use = statement(client, s.id, s.cookie, "USE hive.web")
        assert [use.headers.get("x-trino-set-catalog"), use.headers.get("x-trino-set-schema")] == ["hive", "web"], "state headers returned to the client"
        statement(client, s.id, s.cookie, "SET SESSION query_max_run_time = 10m")
        statement(client, s.id, s.cookie, "PREPARE p1 FROM SELECT ?")
        statement(client, s.id, s.cookie, "START TRANSACTION")
        statement(client, s.id, s.cookie, "SELECT 1", {"x-trino-session": "join_distribution_type=BROADCAST"})
        h = last_post(trino.calls).headers
        assert [h["x-trino-catalog"], h["x-trino-schema"]] == ["hive", "web"], "USE persists"
        assert h["x-trino-session"] == "query_max_run_time=10m,join_distribution_type=BROADCAST", "SET SESSION persists (plus the client's)"
        assert h["x-trino-prepared-statement"] == f"p1={encode_uri_component('SELECT ?')}", "PREPARE persists"
        assert h["x-trino-transaction-id"] == "tx-1", "transaction id sent"
        assert client.get(f"/api/sessions/{s.id}", headers=s.headers).json()["inTransaction"] is True, "session info shows the transaction"

        statement(client, s.id, s.cookie, "RESET SESSION query_max_run_time")
        statement(client, s.id, s.cookie, "DEALLOCATE PREPARE p1")
        statement(client, s.id, s.cookie, "COMMIT")
        statement(client, s.id, s.cookie, "SELECT 1")
        after = last_post(trino.calls).headers
        assert [after.get("x-trino-session"), after.get("x-trino-prepared-statement"), after.get("x-trino-transaction-id")] == [
            None,
            None,
            None,
        ], "RESET / DEALLOCATE / COMMIT clear the state"


def test_logout() -> None:
    client, trino = setup()
    with client:
        s = Login(client)
        statement(client, s.id, s.cookie, "START TRANSACTION")
        statement(client, s.id, s.cookie, "SELECT big")
        out = client.delete(f"/api/sessions/{s.id}", headers=s.headers)
        assert out.status_code == 204, "logout → 204"
        assert any(c.method == "DELETE" and c.path.startswith("/v1/statement/executing/q3/") for c in trino.calls), "logout cancels running queries"
        post = last_post(trino.calls)
        assert [post.body, post.headers.get("x-trino-transaction-id")] == ["ROLLBACK", "tx-1"], "logout rolls back the open transaction"
        assert client.get(f"/api/sessions/{s.id}", headers=s.headers).status_code == 401, "session closed"
        assert re.match(r'tmsid=(""|);', out.headers["set-cookie"]), "cookie cleared"


def test_lost_session() -> None:
    # The cluster stops accepting the credentials (password changed).
    trino = FakeTrino()
    reject = False

    def handler(request: httpx.Request) -> httpx.Response:
        if reject and not request.url.path.endswith("/v1/info"):
            return httpx.Response(401, text="")
        return trino.handle(request)

    client = TestClient(
        create_gateway(
            GatewayOptions(clusters={"dev": ClusterTarget(CLUSTER)}, upstream=upstream_for(handler), secure_cookie=False)
        )
    )
    with client:
        s = Login(client)
        reject = True
        res = statement(client, s.id, s.cookie, "SELECT 1")
        assert [res.status_code, error_code(res)] == [401, "SESSION_LOST"], "credentials rejected → SESSION_LOST"
        assert client.get(f"/api/sessions/{s.id}", headers=s.headers).status_code == 401, "session dropped"


def test_ddl_policy() -> None:
    client, _ = setup(allow_ddl=False)
    with client:
        s = Login(client)

        def code(sql: str) -> str | None:
            return error_code(statement(client, s.id, s.cookie, sql))

        assert code("CREATE TABLE t (a int)") == "DDL_NOT_ALLOWED", "CREATE rejected"
        assert code("-- note\n/* x */ drop table t") == "DDL_NOT_ALLOWED", "after a comment"
        assert code("EXPLAIN ANALYZE VERBOSE ALTER TABLE t ADD COLUMN b int") == "DDL_NOT_ALLOWED", "EXPLAIN ANALYZE executes, so it is checked"
        assert code("EXPLAIN CREATE TABLE t (a int)") is None, "plain EXPLAIN allowed"
        assert code("SELECT 1") is None, "SELECT allowed"


def test_idle_timeout() -> None:
    client, _ = setup(idle_timeout_ms=1_000)
    with client:
        s = Login(client)
        time.sleep(1.2)
        assert client.get(f"/api/sessions/{s.id}", headers=s.headers).status_code == 401, "idle session closed"


# ---------------------------------------------------------------- Python-specific


def test_idle_session_is_rolled_back_by_the_sweeper() -> None:
    client, trino = setup(idle_timeout_ms=1_000)
    with client:
        s = Login(client)
        statement(client, s.id, s.cookie, "START TRANSACTION")
        time.sleep(2.2)
        post = last_post(trino.calls)
        assert [post.body, post.headers.get("x-trino-transaction-id")] == ["ROLLBACK", "tx-1"]


def test_errors_are_json() -> None:
    client, _ = setup()
    with client:
        nope = client.get("/api/nope")
        assert [nope.status_code, error_code(nope)] == [404, "NOT_FOUND"]
        bad = client.post("/api/sessions", content=b"{oops", headers={"content-type": "application/json"})
        assert [bad.status_code, error_code(bad)] == [400, "BAD_REQUEST"]
        missing = client.post("/api/sessions", json={"connectAlias": "dev"})
        assert [missing.status_code, error_code(missing)] == [400, "BAD_REQUEST"]
        s = Login(client)
        big = statement(client, s.id, s.cookie, "x" * (2 * 1024 * 1024 + 1))
        assert [big.status_code, error_code(big)] == [413, "BODY_TOO_LARGE"]


def test_secure_cookie_by_default() -> None:
    client, _ = setup(secure_cookie=True)
    with client:
        res = client.post("/api/sessions", json={"connectAlias": "dev", "user": "alice", "password": "secret"})
        assert parse_set_cookie(res.headers["set-cookie"])["secure"] is True


def test_unreachable_cluster_and_503() -> None:
    trino = FakeTrino()
    mode = "down"

    def handler(request: httpx.Request) -> httpx.Response:
        if mode == "down":
            raise httpx.ConnectError("connection refused", request=request)
        if mode == "busy" and request.url.path == "/v1/statement":
            return httpx.Response(503, text="")
        return trino.handle(request)

    client = TestClient(
        create_gateway(GatewayOptions(clusters={"dev": ClusterTarget(CLUSTER)}, upstream=upstream_for(handler), secure_cookie=False))
    )
    with client:
        down = Login(client)
        assert [down.res.status_code, down.code] == [502, "TRINO_UNAVAILABLE"]
        mode = "up"
        s = Login(client)
        mode = "busy"
        busy = statement(client, s.id, s.cookie, "SELECT 1")
        assert [busy.status_code, error_code(busy)] == [503, "TRINO_HTTP_503"]  # Trino clients retry 503


def test_upstream_timeout() -> None:
    import asyncio

    trino = FakeTrino()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/statement" and request.content == b"SELECT sleep":
            await asyncio.sleep(1)
        return trino.handle(request)

    client = TestClient(
        create_gateway(
            GatewayOptions(
                clusters={"dev": ClusterTarget(CLUSTER)},
                upstream=upstream_for(handler),
                secure_cookie=False,
                request_timeout_ms=200,
            )
        )
    )
    with client:
        s = Login(client)
        res = statement(client, s.id, s.cookie, "SELECT sleep")
        assert [res.status_code, error_code(res)] == [502, "TRINO_TIMEOUT"]


@pytest.mark.parametrize(
    ("sql", "head"),
    [
        ("  -- c\n/* x */ (SELECT 1)", "SELECT 1)"),
        ("EXPLAIN ANALYZE /* c */ EXPLAIN ANALYZE VERBOSE drop table t", "drop table t"),
        ("EXPLAIN (TYPE IO) SELECT 1", "EXPLAIN (TYPE IO) SELECT 1"),
    ],
)
def test_statement_head(sql: str, head: str) -> None:
    assert statement_head(sql) == head


def test_insecure_tls_only_for_marked_clusters() -> None:
    up = HttpxUpstream(1000)
    secure, insecure = ClusterTarget("https://a"), ClusterTarget("https://b", insecure_tls=True)
    assert up(secure) is up(ClusterTarget("https://c"))
    assert up(secure) is not up(insecure)
    assert ClusterTarget.from_json({"url": "https://b", "insecureTls": True}).insecure_tls is True
    assert ClusterTarget.from_json({"url": "https://b"}).authentication == "password"
