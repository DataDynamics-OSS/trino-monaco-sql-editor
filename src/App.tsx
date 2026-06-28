import { useMemo, useRef, useState } from "react";
import { TrinoEditor } from "./TrinoEditor";
import type { MetadataProvider } from "./trino/completion";
import { createTrinoMetadataProvider } from "./trino/metadata";
import { createTrinoQueryRunner, type TrinoQueryResult } from "./trino/runner";
import { basicAuth } from "./trino/auth";

const SAMPLE = `-- Trino sample query
SELECT *
FROM tpch.sf1.orders o
WHERE o.orderdate >= DATE '1995-01-01'
LIMIT 100;
`;

// Offline fallback metadata (used until you connect to a cluster).
const TABLES: Record<string, { name: string; type: string }[]> = {
  orders: [
    { name: "orderkey", type: "bigint" },
    { name: "custkey", type: "bigint" },
    { name: "totalprice", type: "double" },
    { name: "orderdate", type: "date" },
  ],
  customer: [
    { name: "custkey", type: "bigint" },
    { name: "name", type: "varchar" },
  ],
};
const offlineMetadata: MetadataProvider = ({ word, expectTable, expectColumn, qualifier, aliases }) => {
  const w = word.toLowerCase();
  const out: { label: string; kind: "table" | "column" | "catalog" | "schema"; detail?: string }[] = [];
  if (qualifier?.length) {
    const last = qualifier[qualifier.length - 1];
    const t = aliases?.find((a) => a.alias === last)?.table.split(".").pop() ?? last;
    for (const c of TABLES[t] ?? []) out.push({ label: c.name, kind: "column", detail: `${c.type} · ${t}` });
    return out;
  }
  if (expectTable) {
    out.push({ label: "tpch", kind: "catalog", detail: "catalog" });
    for (const t of Object.keys(TABLES)) out.push({ label: t, kind: "table", detail: "table" });
  }
  if (expectColumn) {
    for (const [t, cols] of Object.entries(TABLES))
      for (const c of cols) out.push({ label: c.name, kind: "column", detail: `${c.type} · ${t}` });
  }
  return w ? out.filter((m) => m.label.toLowerCase().includes(w)) : out;
};

interface Conn {
  user: string;
  password: string;
  catalog: string;
  schema: string;
}

// Trino returns absolute nextUri URLs; route them back through the Vite proxy.
const toProxy = (uri: string) => uri.replace(/^https?:\/\/[^/]+/, "/trino");

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [value, setValue] = useState(SAMPLE);
  const [conn, setConn] = useState<Conn | null>(null);
  const [form, setForm] = useState<Conn>({ user: "admin", password: "", catalog: "tpch", schema: "sf1" });
  const [result, setResult] = useState<TrinoQueryResult | null>(null);
  const [status, setStatus] = useState<string>("offline (sample metadata)");
  const runCtrl = useRef<AbortController | null>(null);

  // Live providers when connected; offline fallbacks otherwise.
  const metadata = useMemo<MetadataProvider>(() => {
    if (!conn) return offlineMetadata;
    return createTrinoMetadataProvider({
      baseUrl: "/trino",
      user: conn.user,
      authorization: basicAuth(conn.user, conn.password),
      catalog: () => conn.catalog,
      schema: () => conn.schema,
      rewriteNextUri: toProxy,
    });
  }, [conn]);

  const runner = useMemo(() => {
    if (!conn) return null;
    return createTrinoQueryRunner({
      baseUrl: "/trino",
      user: conn.user,
      authorization: basicAuth(conn.user, conn.password),
      catalog: () => conn.catalog,
      schema: () => conn.schema,
      rewriteNextUri: toProxy,
    });
  }, [conn]);

  const runQuery = async (sql: string) => {
    if (!runner) {
      setStatus("Not connected — connect to run queries.");
      return;
    }
    runCtrl.current?.abort();
    runCtrl.current = new AbortController();
    setStatus("running…");
    setResult(null);
    try {
      const res = await runner(sql.replace(/;\s*$/, ""), { signal: runCtrl.current.signal });
      setResult(res);
      setStatus(`${res.rows.length} row(s) · query ${res.id ?? ""}`);
    } catch (e) {
      setStatus("error: " + (e as Error).message);
    }
  };

  const bg = theme === "dark" ? "#0b1021" : "#ffffff";
  const fg = theme === "dark" ? "#d4d4d4" : "#1f2933";
  const border = "1px solid #33415555";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: bg, color: fg }}>
      <header style={{ padding: "8px 16px", display: "flex", gap: 10, alignItems: "center", borderBottom: border, flexWrap: "wrap" }}>
        <strong>Trino Monaco Editor</strong>
        <label><input type="checkbox" checked={theme === "dark"} onChange={(e) => setTheme(e.target.checked ? "dark" : "light")} /> Dark</label>
        <span style={{ width: 1, height: 20, background: "#33415555" }} />
        <input placeholder="user" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} style={inp} />
        <input placeholder="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inp} />
        <input placeholder="catalog" value={form.catalog} onChange={(e) => setForm({ ...form, catalog: e.target.value })} style={{ ...inp, width: 90 }} />
        <input placeholder="schema" value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} style={{ ...inp, width: 90 }} />
        {conn ? (
          <button onClick={() => { setConn(null); setStatus("offline (sample metadata)"); }} style={btn}>Disconnect</button>
        ) : (
          <button onClick={() => { setConn(form); setStatus(`connected as ${form.user}`); }} style={btn}>Connect</button>
        )}
        <span style={{ marginLeft: "auto", opacity: 0.75, fontSize: 12 }}>Ctrl/Cmd+Enter = Run · {status}</span>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <TrinoEditor
          value={value}
          onChange={setValue}
          theme={theme}
          contextAware
          metadataProvider={metadata}
          onRunQuery={runQuery}
          onExplainQuery={(sql) => runQuery(`EXPLAIN ${sql}`)}
        />
      </div>

      <footer style={{ borderTop: border, padding: "8px 16px", maxHeight: "38%", overflow: "auto" }}>
        {result && result.columns.length > 0 ? (
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead>
              <tr>{result.columns.map((c) => (
                <th key={c.name} style={th}>{c.name}<span style={{ opacity: 0.5 }}> :{c.type}</span></th>
              ))}</tr>
            </thead>
            <tbody>
              {result.rows.slice(0, 200).map((row, i) => (
                <tr key={i}>{(row as unknown[]).map((cell, j) => (
                  <td key={j} style={td}>{cell === null ? "NULL" : String(cell)}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.7 }}>{status}</div>
        )}
      </footer>
    </div>
  );
}

const inp: React.CSSProperties = { background: "transparent", color: "inherit", border: "1px solid #33415588", borderRadius: 4, padding: "4px 6px", fontSize: 12, width: 120 };
const btn: React.CSSProperties = { background: "#233979", color: "#fff", border: "none", borderRadius: 4, padding: "5px 12px", fontSize: 12, cursor: "pointer" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #33415588", padding: "3px 8px", position: "sticky", top: 0, background: "#1118" };
const td: React.CSSProperties = { borderBottom: "1px solid #33415522", padding: "3px 8px", whiteSpace: "nowrap" };
