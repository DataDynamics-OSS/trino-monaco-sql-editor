/**
 * A `metadataProvider` backed by a live Trino cluster.
 *
 * Issues `SHOW CATALOGS / SCHEMAS / TABLES / COLUMNS` over the Trino REST
 * protocol and turns the parser-derived caret context into the right query:
 *
 *   - `FROM |`              -> catalogs + schemas + tables of the current schema
 *   - `FROM cat.|`          -> schemas of catalog `cat`
 *   - `FROM cat.sch.|`      -> tables of `cat.sch`
 *   - `WHERE a.|`           -> columns of the table aliased `a`
 *   - `SELECT | FROM t a`   -> columns of every in-scope table
 *
 * Results are cached with a TTL, identical in-flight requests are de-duplicated,
 * and each completion round aborts the previous round's requests.
 */
import type {
  MetadataProvider,
  MetadataProviderContext,
  TrinoMetadataItem,
} from "./completion";
import {
  resolveOpt,
  runStatement,
  type TrinoColumn,
  type TrinoConnectionOptions,
} from "./connection";

export interface TrinoMetadataOptions extends TrinoConnectionOptions {
  /** Cache TTL in ms. Default 5 minutes. 0 disables caching. */
  cacheTtlMs?: number;
}

interface ResultSet {
  columns: TrinoColumn[];
  rows: unknown[][];
}

const DEFAULT_TTL = 5 * 60_000;

/** Resolve a list query to [] on failure, so one bad query can't break the rest. */
function safe<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch(() => []);
}

function quoteIdent(part: string): string {
  return `"${part.replace(/"/g, '""')}"`;
}

function quotePath(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p).map(quoteIdent).join(".");
}

/** Fill {catalog, schema, name} from a possibly-qualified text using defaults. */
function tableParts(
  text: string,
  defCatalog?: string,
  defSchema?: string,
): { catalog?: string; schema?: string; name: string } {
  const p = text.split(".").map((s) => s.replace(/^"|"$/g, "").replace(/""/g, '"'));
  if (p.length >= 3) return { catalog: p[0], schema: p[1], name: p[2] };
  if (p.length === 2) return { catalog: defCatalog, schema: p[0], name: p[1] };
  return { catalog: defCatalog, schema: defSchema, name: p[0] };
}

export function createTrinoMetadataProvider(
  options: TrinoMetadataOptions,
): MetadataProvider {
  const ttl = options.cacheTtlMs ?? DEFAULT_TTL;

  const cache = new Map<string, { expiry: number; value: ResultSet }>();
  const inflight = new Map<string, Promise<ResultSet>>();
  let controller: AbortController | null = null;

  async function query(sql: string, signal: AbortSignal): Promise<ResultSet> {
    const cached = cache.get(sql);
    if (cached && cached.expiry > Date.now()) return cached.value;

    const existing = inflight.get(sql);
    if (existing) return existing;

    const promise = runStatement(options, sql, signal)
      .then((value) => {
        if (ttl > 0) cache.set(sql, { expiry: Date.now() + ttl, value });
        return value;
      })
      .finally(() => inflight.delete(sql));

    inflight.set(sql, promise);
    return promise;
  }

  function col(rs: ResultSet, name: string): number {
    const i = rs.columns.findIndex((c) => c.name === name);
    return i >= 0 ? i : 0;
  }

  async function listCatalogs(signal: AbortSignal): Promise<string[]> {
    const rs = await query("SHOW CATALOGS", signal);
    const c = col(rs, "Catalog");
    return rs.rows.map((r) => String(r[c]));
  }

  async function listSchemas(catalog: string, signal: AbortSignal): Promise<TrinoMetadataItem[]> {
    const rs = await query(`SHOW SCHEMAS FROM ${quoteIdent(catalog)}`, signal);
    const c = col(rs, "Schema");
    return rs.rows.map((r) => ({
      label: String(r[c]),
      kind: "schema" as const,
      detail: `schema · ${catalog}`,
    }));
  }

  async function listTables(
    catalog: string | undefined,
    schema: string | undefined,
    signal: AbortSignal,
  ): Promise<TrinoMetadataItem[]> {
    if (!schema) return [];
    const rs = await query(`SHOW TABLES FROM ${quotePath(catalog, schema)}`, signal);
    const c = col(rs, "Table");
    return rs.rows.map((r) => ({
      label: String(r[c]),
      kind: "table" as const,
      detail: `table · ${[catalog, schema].filter(Boolean).join(".")}`,
    }));
  }

  async function listColumns(
    catalog: string | undefined,
    schema: string | undefined,
    table: string,
    signal: AbortSignal,
  ): Promise<TrinoMetadataItem[]> {
    const rs = await query(`SHOW COLUMNS FROM ${quotePath(catalog, schema, table)}`, signal);
    const nameI = col(rs, "Column");
    const typeI = col(rs, "Type");
    return rs.rows.map((r) => ({
      label: String(r[nameI]),
      kind: "column" as const,
      detail: `${String(r[typeI])} · ${table}`,
    }));
  }

  async function resolve(
    ctx: MetadataProviderContext,
    signal: AbortSignal,
  ): Promise<TrinoMetadataItem[]> {
    const defCatalog = resolveOpt(options.catalog);
    const defSchema = resolveOpt(options.schema);
    const q = ctx.qualifier ?? [];
    const aliases = ctx.aliases ?? [];

    // ---- column-ish positions ----
    if (ctx.expectColumn && !ctx.expectTable) {
      if (q.length === 0) {
        const lists = await Promise.all(
          aliases.map((a) => {
            const t = tableParts(a.table, defCatalog, defSchema);
            return safe(listColumns(t.catalog, t.schema, t.name, signal));
          }),
        );
        return lists.flat();
      }
      const last = q[q.length - 1];
      const alias = aliases.find((a) => a.alias === last);
      const target = alias ? alias.table : q.join(".");
      const t = tableParts(target, defCatalog, defSchema);
      return listColumns(t.catalog, t.schema, t.name, signal);
    }

    // ---- table-ish positions ----
    if (ctx.expectTable) {
      if (q.length === 0) {
        // Each query is independent — a failure (e.g. inaccessible default
        // catalog) must NOT discard the others (e.g. SHOW CATALOGS).
        const [catalogs, schemas, tables] = await Promise.all([
          safe(
            listCatalogs(signal).then((cs) =>
              cs.map((label) => ({ label, kind: "catalog" as const, detail: "catalog" })),
            ),
          ),
          safe(defCatalog ? listSchemas(defCatalog, signal) : Promise.resolve([])),
          safe(listTables(defCatalog, defSchema, signal)),
        ]);
        return [...tables, ...schemas, ...catalogs];
      }
      if (q.length === 1) {
        const catalogs = await safe(listCatalogs(signal));
        if (catalogs.includes(q[0])) return listSchemas(q[0], signal);
        return listTables(defCatalog, q[0], signal);
      }
      return listTables(q[0], q[1], signal);
    }

    return [];
  }

  return async (ctx) => {
    controller?.abort();
    controller = new AbortController();
    try {
      return await resolve(ctx, controller.signal);
    } catch {
      return [];
    }
  };
}
