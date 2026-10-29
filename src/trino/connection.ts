/**
 * Shared Trino REST connection layer used by both the metadata provider and the
 * query runner. Speaks the Trino client protocol: `POST /v1/statement`, then
 * follow `nextUri` (GET) through QUEUED → RUNNING → FINISHED, accumulating
 * `columns` (sent once) and `data` pages.
 */

export interface TrinoConnectionOptions {
  /** Trino base URL or same-origin proxy prefix, e.g. "/trino" or "https://host:8443". */
  baseUrl: string;
  /** Trino user (X-Trino-User). Default "trino". */
  user?: string;
  /** Authorization header value, e.g. "Basic …" or "Bearer …". */
  authorization?: string;
  /** X-Trino-Source header. Default "trino-monaco". */
  source?: string;
  /** Default catalog (string or getter, so `USE` changes take effect). */
  catalog?: string | (() => string | undefined);
  /** Default schema (string or getter). */
  schema?: string | (() => string | undefined);
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Sent on every request (use "include" for cookie/proxy auth). */
  credentials?: RequestCredentials;
  /**
   * Transform each follow-up `nextUri` before fetching it. Trino returns
   * absolute URLs; in a browser behind a proxy you must route them back through
   * the proxy, e.g. `(uri) => uri.replace(/^https?:\/\/[^/]+/, "/trino")`.
   */
  rewriteNextUri?: (uri: string) => string;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

export interface TrinoColumn {
  name: string;
  type: string;
}

export interface StatementPage {
  id?: string;
  columns?: { name: string; type?: string }[];
  data?: unknown[][];
  nextUri?: string;
  error?: { message?: string };
  stats?: { state?: string };
}

export function resolveOpt(
  v: string | (() => string | undefined) | undefined,
): string | undefined {
  return typeof v === "function" ? v() : v;
}

export function buildHeaders(o: TrinoConnectionOptions): Record<string, string> {
  const h: Record<string, string> = {
    "X-Trino-User": o.user ?? "trino",
    "X-Trino-Source": o.source ?? "trino-monaco",
    ...o.headers,
  };
  if (o.authorization) h["Authorization"] = o.authorization;
  const cat = resolveOpt(o.catalog);
  const sch = resolveOpt(o.schema);
  if (cat) h["X-Trino-Catalog"] = cat;
  if (sch) h["X-Trino-Schema"] = sch;
  return h;
}

/**
 * Yield each protocol page for a statement. `onUri` reports the latest follow
 * URI (so callers can DELETE it to cancel server-side).
 */
export async function* statementPages(
  o: TrinoConnectionOptions,
  sql: string,
  signal?: AbortSignal,
  onUri?: (uri: string) => void,
): AsyncGenerator<StatementPage> {
  const doFetch = o.fetch ?? globalThis.fetch;
  if (!doFetch) throw new Error("No fetch available; pass options.fetch");
  const headers = buildHeaders(o);

  let res = await doFetch(`${o.baseUrl}/v1/statement`, {
    method: "POST",
    headers,
    body: sql,
    signal,
    credentials: o.credentials,
  });
  let json = (await res.json()) as StatementPage;

  // Cap iterations to guard against a misbehaving server.
  for (let i = 0; i < 100_000; i++) {
    yield json;
    if (json.error || !json.nextUri) return;
    const next = o.rewriteNextUri ? o.rewriteNextUri(json.nextUri) : json.nextUri;
    onUri?.(next);
    res = await doFetch(next, {
      method: "GET",
      headers,
      signal,
      credentials: o.credentials,
    });
    json = (await res.json()) as StatementPage;
  }
}

/** Run a statement to completion and return the full result set. */
export async function runStatement(
  o: TrinoConnectionOptions,
  sql: string,
  signal?: AbortSignal,
): Promise<{ id?: string; columns: TrinoColumn[]; rows: unknown[][] }> {
  let id: string | undefined;
  let columns: TrinoColumn[] = [];
  const rows: unknown[][] = [];
  for await (const page of statementPages(o, sql, signal)) {
    if (page.error) throw new Error(page.error.message ?? "Trino query error");
    if (page.id) id = page.id;
    if (page.columns && columns.length === 0) {
      columns = page.columns.map((c) => ({ name: c.name, type: c.type ?? "" }));
    }
    if (page.data) rows.push(...page.data);
  }
  return { id, columns, rows };
}
