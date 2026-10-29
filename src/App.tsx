import { useEffect, useMemo, useRef, useState } from "react";
import { TrinoEditor } from "./TrinoEditor";
import type { MetadataProvider } from "./trino/completion";
import { createTrinoMetadataProvider } from "./trino/metadata";
import { createTrinoQueryRunner, type TrinoQueryResult } from "./trino/runner";
import { basicAuth } from "./trino/auth";
import {
  createTrinoGatewayClient,
  type TrinoGatewayAlias,
  type TrinoGatewaySession,
} from "./trino/gateway";
import { TRINO_LOCALES, type TrinoLocale } from "./trino/i18n";
import { DEFAULT_TRINO_EDITOR_FONT, TRINO_EDITOR_FONTS } from "./trino/fonts";
import { APP_STRINGS, initialFont, initialLocale, saveFont, saveLocale } from "./appStrings";

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

// Gateway (servers/) behind the Vite proxy at /api. Without one, the demo
// falls back to calling Trino directly through the /trino proxy.
const gateway = createTrinoGatewayClient();

type Status =
  | { key: "offline" | "notConnected" | "running" }
  | { key: "connected"; user: string }
  | { key: "rows"; n: number; id: string }
  | { key: "error"; message: string };

export default function App() {
  const [locale, setLocaleState] = useState<TrinoLocale>(initialLocale);
  const s = APP_STRINGS[locale];
  const setLocale = (l: TrinoLocale) => {
    setLocaleState(l);
    saveLocale(l);
  };
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
  }, [locale]);
  const [fontId, setFontId] = useState(() => initialFont(DEFAULT_TRINO_EDITOR_FONT.id));
  const font = TRINO_EDITOR_FONTS.find((f) => f.id === fontId) ?? DEFAULT_TRINO_EDITOR_FONT;
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [value, setValue] = useState(SAMPLE);
  const [conn, setConn] = useState<Conn | null>(null);
  const [aliases, setAliases] = useState<TrinoGatewayAlias[] | null>(null);
  const [session, setSession] = useState<TrinoGatewaySession | null>(null);
  const [alias, setAlias] = useState("");
  useEffect(() => {
    gateway.aliases().then(
      (list) => {
        setAliases(list);
        setAlias(list[0]?.alias ?? "");
      },
      () => setAliases(null),
    );
  }, []);
  const [form, setForm] = useState<Conn>({ user: "admin", password: "", catalog: "tpch", schema: "sf1" });
  const [result, setResult] = useState<TrinoQueryResult | null>(null);
  const [status, setStatus] = useState<Status>({ key: "offline" });
  const statusText = (() => {
    switch (status.key) {
      case "connected": return s.connectedAs(status.user);
      case "rows": return s.rows(status.n, status.id);
      case "error": return s.error(status.message);
      default: return s[status.key];
    }
  })();
  const runCtrl = useRef<AbortController | null>(null);

  // Live providers when connected (gateway session or direct); offline fallbacks otherwise.
  const metadata = useMemo<MetadataProvider>(() => {
    if (session) return createTrinoMetadataProvider(gateway.connection(session));
    if (!conn) return offlineMetadata;
    return createTrinoMetadataProvider({
      baseUrl: "/trino",
      user: conn.user,
      authorization: basicAuth(conn.user, conn.password),
      catalog: () => conn.catalog,
      schema: () => conn.schema,
      rewriteNextUri: toProxy,
    });
  }, [conn, session]);

  const runner = useMemo(() => {
    if (session) return createTrinoQueryRunner(gateway.connection(session));
    if (!conn) return null;
    return createTrinoQueryRunner({
      baseUrl: "/trino",
      user: conn.user,
      authorization: basicAuth(conn.user, conn.password),
      catalog: () => conn.catalog,
      schema: () => conn.schema,
      rewriteNextUri: toProxy,
    });
  }, [conn, session]);

  const login = async () => {
    try {
      const sess = await gateway.login({ connectAlias: alias, user: form.user, password: form.password });
      setSession(sess);
      setForm({ ...form, password: "" });
      setStatus({ key: "connected", user: sess.user });
    } catch (e) {
      setStatus({ key: "error", message: (e as Error).message });
    }
  };
  const logout = () => {
    if (session) void gateway.logout(session).catch(() => {});
    setSession(null);
    setStatus({ key: "offline" });
  };

  const runQuery = async (sql: string) => {
    if (!runner) {
      setStatus({ key: "notConnected" });
      return;
    }
    runCtrl.current?.abort();
    runCtrl.current = new AbortController();
    setStatus({ key: "running" });
    setResult(null);
    try {
      const res = await runner(sql.replace(/;\s*$/, ""), { signal: runCtrl.current.signal });
      setResult(res);
      setStatus({ key: "rows", n: res.rows.length, id: res.id ?? "" });
    } catch (e) {
      setStatus({ key: "error", message: (e as Error).message });
    }
  };

  const bg = theme === "dark" ? "#0b1021" : "#ffffff";
  const fg = theme === "dark" ? "#d4d4d4" : "#1f2933";
  const border = "1px solid #33415555";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: UI_FONT, fontSize: 13, background: bg, color: fg }}>
      <header style={{ padding: "8px 16px", display: "flex", gap: 10, alignItems: "center", borderBottom: border, flexWrap: "wrap" }}>
        <strong>Trino Monaco Editor</strong>
        <label>
          {s.language}{" "}
          <select value={locale} onChange={(e) => setLocale(e.target.value as TrinoLocale)} style={sel}>
            {TRINO_LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label>
          {s.font}{" "}
          <select value={font.id} onChange={(e) => { setFontId(e.target.value); saveFont(e.target.value); }} style={sel}>
            {TRINO_EDITOR_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={theme === "dark"} onChange={(e) => setTheme(e.target.checked ? "dark" : "light")} /> {s.dark}</label>
        <span style={{ width: 1, height: 20, background: "#33415555" }} />
        {session ? (
          <>
            <span>{session.user}@{session.connectAlias} · Trino {session.version}</span>
            <button onClick={logout} style={btn}>{s.disconnect}</button>
          </>
        ) : aliases ? (
          <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => { e.preventDefault(); void login(); }}>
            <select value={alias} onChange={(e) => setAlias(e.target.value)} style={sel} aria-label={s.cluster}>
              {aliases.map((a) => <option key={a.alias} value={a.alias}>{a.label}</option>)}
            </select>
            <input placeholder={s.user} value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} style={inp} />
            <input placeholder={s.password} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inp} />
            <button type="submit" style={btn}>{s.connect}</button>
          </form>
        ) : (
          <>
            <input placeholder={s.user} value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} style={inp} />
            <input placeholder={s.password} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inp} />
            <input placeholder={s.catalog} value={form.catalog} onChange={(e) => setForm({ ...form, catalog: e.target.value })} style={{ ...inp, width: 90 }} />
            <input placeholder={s.schema} value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} style={{ ...inp, width: 90 }} />
            {conn ? (
              <button onClick={() => { setConn(null); setStatus({ key: "offline" }); }} style={btn}>{s.disconnect}</button>
            ) : (
              <button onClick={() => { setConn(form); setStatus({ key: "connected", user: form.user }); }} style={btn}>{s.connect}</button>
            )}
          </>
        )}
        <span style={{ marginLeft: "auto", opacity: 0.75 }}>{s.shortcuts} · {statusText}</span>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <TrinoEditor
          value={value}
          onChange={setValue}
          theme={theme}
          locale={locale}
          fontFamily={font.fontFamily}
          fontLigatures={font.ligatures}
          contextAware
          metadataProvider={metadata}
          onRunQuery={runQuery}
          onExplainQuery={(sql) => runQuery(`EXPLAIN ${sql}`)}
        />
      </div>

      <footer style={{ borderTop: border, padding: "8px 16px", maxHeight: "38%", overflow: "auto" }}>
        {result && result.columns.length > 0 ? (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
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
          <div style={{ opacity: 0.7 }}>{statusText}</div>
        )}
      </footer>
    </div>
  );
}

/**
 * Demo UI font: Roboto Condensed for Latin text, then fonts with Hangul / kana /
 * Hanzi (Roboto has none) so mixed-language labels look the same on every OS.
 * Everything in the page chrome is 13px; form controls inherit it (`font: inherit`).
 */
const UI_FONT =
  "'Roboto Condensed', 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

const inp: React.CSSProperties = { background: "transparent", color: "inherit", border: "1px solid #33415588", borderRadius: 4, padding: "4px 6px", font: "inherit", width: 120 };
const sel: React.CSSProperties = { ...inp, padding: "2px 4px", width: "auto" };
const btn: React.CSSProperties = { background: "#233979", color: "#fff", border: "none", borderRadius: 4, padding: "5px 12px", font: "inherit", cursor: "pointer" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #33415588", padding: "3px 8px", position: "sticky", top: 0, background: "#1118" };
const td: React.CSSProperties = { borderBottom: "1px solid #33415522", padding: "3px 8px", whiteSpace: "nowrap" };
