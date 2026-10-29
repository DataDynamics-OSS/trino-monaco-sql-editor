/**
 * Query runner for the editor's "Run query" action.
 *
 * Executes a statement over the Trino REST protocol, streaming result pages
 * (so large results render incrementally), surfacing query errors, and
 * cancelling both client- and server-side (DELETE the active URI) on abort.
 */
import {
  buildHeaders,
  statementPages,
  type TrinoColumn,
  type TrinoConnectionOptions,
} from "./connection";

export interface TrinoQueryResult {
  /** Trino query id (e.g. for the query details UI). */
  id?: string;
  columns: TrinoColumn[];
  rows: unknown[][];
}

export interface RunQueryOptions {
  /** Abort the query (also cancels it server-side). */
  signal?: AbortSignal;
  /** Called for every data page as it arrives (incremental rendering). */
  onPage?: (page: { columns: TrinoColumn[]; rows: unknown[][] }) => void;
}

export class TrinoQueryError extends Error {
  readonly queryId?: string;
  constructor(message: string, queryId?: string) {
    super(message);
    this.name = "TrinoQueryError";
    this.queryId = queryId;
  }
}

export type TrinoQueryRunner = (
  sql: string,
  options?: RunQueryOptions,
) => Promise<TrinoQueryResult>;

export function createTrinoQueryRunner(
  options: TrinoConnectionOptions,
): TrinoQueryRunner {
  const doFetch = options.fetch ?? globalThis.fetch;

  return async (sql, runOpts = {}) => {
    const { signal, onPage } = runOpts;

    let id: string | undefined;
    let columns: TrinoColumn[] = [];
    const rows: unknown[][] = [];
    let lastUri: string | undefined;

    // Best-effort server-side cancellation.
    const onAbort = () => {
      if (lastUri && doFetch) {
        void doFetch(lastUri, {
          method: "DELETE",
          headers: buildHeaders(options),
          credentials: options.credentials,
        }).catch(() => {});
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      for await (const page of statementPages(options, sql, signal, (u) => (lastUri = u))) {
        if (page.error) throw new TrinoQueryError(page.error.message ?? "Trino query error", id);
        if (page.id) id = page.id;
        if (page.columns && columns.length === 0) {
          columns = page.columns.map((c) => ({ name: c.name, type: c.type ?? "" }));
        }
        if (page.data && page.data.length) {
          rows.push(...page.data);
          onPage?.({ columns, rows: page.data });
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return { id, columns, rows };
  };
}
