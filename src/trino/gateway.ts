/**
 * Client for the trino-monaco gateway (`servers/`): log in once with the
 * user's own Trino account, then run queries and metadata lookups through
 * the gateway session. The browser holds only an httpOnly session cookie;
 * the gateway keeps the credentials and the Trino session state (`USE`,
 * `SET SESSION`, `PREPARE`, transactions).
 *
 *   const gw = createTrinoGatewayClient();               // same-origin "/api"
 *   const session = await gw.login({ connectAlias: "dev", user, password });
 *   const conn = gw.connection(session);
 *   const runner = createTrinoQueryRunner(conn);
 *   const metadata = createTrinoMetadataProvider(conn);
 */
import type { TrinoConnectionOptions } from "./connection";

export interface TrinoGatewayClientOptions {
  /** Gateway prefix: "/api" (default, same origin) or an absolute URL such as "http://127.0.0.1:8787/api". */
  baseUrl?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /**
   * Send `X-Session-Id` instead of relying on the session cookie (non-browser
   * clients; the gateway must run with `ALLOW_HEADER_AUTH=true`).
   */
  headerAuth?: boolean;
}

export interface TrinoGatewayAlias {
  alias: string;
  label: string;
}

/** A logged-in gateway session. `catalog` / `schema` follow `USE` statements. */
export interface TrinoGatewaySession {
  sessionId: string;
  user: string;
  /** Trino version of the cluster. */
  version: string;
  connectAlias: string;
  catalog?: string;
  schema?: string;
  inTransaction: boolean;
}

export class TrinoGatewayError extends Error {
  /** Gateway error code, e.g. `INVALID_CREDENTIALS`, `SESSION_EXPIRED`. */
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "TrinoGatewayError";
    this.code = code;
    this.status = status;
  }
}

export interface TrinoGatewayClient {
  /** Clusters configured on the gateway. */
  aliases(): Promise<TrinoGatewayAlias[]>;
  /** Log in; the password is checked against the cluster. */
  login(input: { connectAlias: string; user: string; password?: string }): Promise<TrinoGatewaySession>;
  /** Refresh a session's description (catalog, schema, transaction). */
  refresh(session: TrinoGatewaySession): Promise<TrinoGatewaySession>;
  /** Log out: the gateway cancels running queries and rolls back an open transaction. */
  logout(session: TrinoGatewaySession): Promise<void>;
  /**
   * Connection options for `createTrinoQueryRunner` / `createTrinoMetadataProvider`.
   * The default catalog / schema are the session's (kept up to date from `USE`).
   */
  connection(session: TrinoGatewaySession, extra?: Partial<TrinoConnectionOptions>): TrinoConnectionOptions;
}

export function createTrinoGatewayClient(options: TrinoGatewayClientOptions = {}): TrinoGatewayClient {
  const base = (options.baseUrl ?? "/api").replace(/\/+$/, "");
  const baseFetch = options.fetch ?? globalThis.fetch;
  if (!baseFetch) throw new Error("No fetch available; pass options.fetch");
  // Path-only URIs from the gateway (`/api/sessions/…`) need the origin outside a browser page.
  const origin = /^https?:\/\//.test(base) ? new URL(base).origin : "";

  const auth = (s?: TrinoGatewaySession): Record<string, string> =>
    options.headerAuth && s ? { "X-Session-Id": s.sessionId } : {};

  async function call<T>(method: string, path: string, s?: TrinoGatewaySession, body?: unknown): Promise<T> {
    const res = await baseFetch(`${base}${path}`, {
      method,
      credentials: "same-origin",
      headers: { ...auth(s), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!res.ok || json.error) {
      throw new TrinoGatewayError(json.error?.code ?? `HTTP_${res.status}`, json.error?.message ?? res.statusText, res.status);
    }
    return json as T;
  }

  /** Track `USE` from the state headers the gateway returns with statement pages. */
  function tracking(session: TrinoGatewaySession, inner: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      const cat = res.headers.get("x-trino-set-catalog");
      const sch = res.headers.get("x-trino-set-schema");
      if (cat !== null) session.catalog = cat || undefined;
      if (sch !== null) session.schema = sch || undefined;
      if (res.headers.get("x-trino-started-transaction-id")) session.inTransaction = true;
      if (res.headers.get("x-trino-clear-transaction-id") !== null) session.inTransaction = false;
      return res;
    }) as typeof fetch;
  }

  return {
    aliases: () => call<TrinoGatewayAlias[]>("GET", "/aliases"),

    login: (input) => call<TrinoGatewaySession>("POST", "/sessions", undefined, input),

    async refresh(session) {
      const info = await call<Omit<TrinoGatewaySession, "sessionId">>("GET", `/sessions/${session.sessionId}`, session);
      return Object.assign(session, { catalog: undefined, schema: undefined }, info);
    },

    logout: (session) => call<void>("DELETE", `/sessions/${session.sessionId}`, session),

    connection(session, extra = {}) {
      return {
        baseUrl: `${base}/sessions/${session.sessionId}`,
        user: session.user,
        catalog: () => session.catalog,
        schema: () => session.schema,
        credentials: "same-origin",
        headers: auth(session),
        ...(origin ? { rewriteNextUri: (uri: string) => (uri.startsWith("/") ? origin + uri : uri) } : {}),
        ...extra,
        fetch: tracking(session, extra.fetch ?? baseFetch),
      };
    },
  };
}
