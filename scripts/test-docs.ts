/* Node test for the built-in help (hover / Shift+F1 / Ctrl+Click) and UI languages. Run: npx tsx scripts/test-docs.ts */
import { allDocEntries, docFor, docUrl, functionDoc, renderDoc } from "../src/trino/docs.js";
import { helpAt } from "../src/trino/hover.js";
import { localizeDoc, localizeMessage, uiStrings, type TrinoLocale } from "../src/trino/i18n/index.js";
import { TRINO_FUNCTIONS, TRINO_TYPES } from "../src/trino/keywords.js";

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}\n     got:      ${JSON.stringify(actual)}\n     expected: ${JSON.stringify(expected)}`);
  }
}
const assert = (label: string, ok: boolean, detail?: unknown) =>
  eq(label + (ok ? "" : ` ${JSON.stringify(detail)}`), ok, true);

const title = (w: string, ctx = {}) => docFor(w, ctx)?.title;
/** Help for the `nth` occurrence of `word` in `text`. */
const at = (text: string, word: string, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) idx = text.indexOf(word, idx + 1);
  return helpAt(text, idx + 1)?.entry.title;
};

console.log("=== coverage ===");
eq("every built-in function has help", TRINO_FUNCTIONS.filter((f) => !functionDoc(f)), []);
eq("every type has help", TRINO_TYPES.filter((t) => docFor(t)?.kind !== "type"), []);
eq("ids are unique", allDocEntries().length, new Set(allDocEntries().map((e) => e.id)).size);
assert("every entry has a page", allDocEntries().every((e) => /^(functions|sql|language)\/[\w-]+(#[\w-]+)?$/.test(e.page)));

console.log("\n=== functions ===");
eq("call → function", title("COUNT", { call: true }), "count");
eq("aggregate kind", functionDoc("sum")?.kind, "aggregate");
eq("window kind", functionDoc("row_number")?.kind, "window");
eq("no-paren function", title("current_date"), "current_date");
eq("REPLACE without ( is not replace()", docFor("REPLACE", { next: ["VIEW"] }), undefined);
eq("FILTER (WHERE …) is the clause", title("filter", { call: true, next: ["(", "WHERE"] }), "FILTER (aggregation)");
eq("filter(array, …) is the function", title("filter", { call: true, next: ["(", "ARRAY"] }), "filter");
eq("DATE( → function, DATE → type", [title("date", { call: true }), docFor("DATE")?.kind], ["date", "type"]);

console.log("\n=== keywords in context ===");
eq("GROUP BY", title("GROUP", { next: ["BY"] }), "GROUP BY");
eq("ORDER BY", title("order", { next: ["BY"] }), "ORDER BY");
eq("WITH RECURSIVE", title("WITH", { next: ["RECURSIVE", "T"] }), "WITH RECURSIVE");
eq("WITH TIME ZONE is not a CTE", docFor("WITH", { next: ["TIME", "ZONE"] }), undefined);
eq("WITH (props) is not a CTE", docFor("WITH", { next: ["(", "FORMAT"] }), undefined);
eq("CREATE TABLE", title("CREATE", { next: ["TABLE", "T", "("] }), "CREATE TABLE");
eq("CREATE TABLE … AS", title("CREATE", { next: ["TABLE", "T", "AS", "SELECT"] }), "CREATE TABLE AS");
eq("CREATE OR REPLACE VIEW", title("CREATE", { next: ["OR", "REPLACE", "VIEW"] }), "CREATE VIEW");
eq("DROP MATERIALIZED VIEW", title("DROP", { next: ["MATERIALIZED", "VIEW"] }), "DROP MATERIALIZED VIEW");
eq("unknown CREATE target", docFor("CREATE", { next: ["ROLE"] }), undefined);
eq("SHOW TABLES", title("SHOW", { next: ["TABLES"] }), "SHOW TABLES");
eq("EXPLAIN ANALYZE", title("EXPLAIN", { next: ["ANALYZE"] }), "EXPLAIN ANALYZE");
eq("FETCH FIRST", title("FETCH", { next: ["FIRST", "10"] }), "LIMIT / FETCH FIRST");
eq("IS NOT NULL", title("IS", { next: ["NOT", "NULL"] }), "IS [NOT] NULL");
eq("IS DISTINCT FROM", title("IS", { next: ["DISTINCT", "FROM"] }), "IS [NOT] DISTINCT FROM");
eq("NOT IN", title("NOT", { next: ["IN"] }), "IN");
eq("LEFT → JOIN", title("LEFT", { next: ["JOIN"] }), "JOIN");
eq("CROSS JOIN", title("CROSS", { next: ["JOIN"] }), "CROSS JOIN");
eq("AT TIME ZONE", title("AT", { next: ["TIME", "ZONE"] }), "AT TIME ZONE");
eq("SET SESSION", title("SET", { next: ["SESSION"] }), "SET SESSION");
eq("UPDATE … SET is not SET SESSION", docFor("SET", { next: ["A"] }), undefined);
eq("unknown word", docFor("orders"), undefined);

console.log("\n=== help at a text position ===");
eq("keyword", at("select * from t group by a", "group"), "GROUP BY");
eq("function call", at("SELECT count(*) FROM t", "count"), "count");
eq("call with a space", at("SELECT count (*) FROM t", "count"), "count");
eq("column named like a function", at("SELECT count FROM t", "count"), undefined);
eq("qualified name", at("SELECT t.count FROM t", "count"), undefined);
eq("table qualifier", at("SELECT year.x FROM year", "year"), undefined);
eq("in a string", at("SELECT 'group by' FROM t", "group"), undefined);
eq("in a comment", at("-- group by\nSELECT 1", "group"), undefined);
eq("in a quoted identifier", at('SELECT "select" FROM t', "select"), undefined);
eq("multi-line context", at("CREATE TABLE t\nAS SELECT 1", "CREATE"), "CREATE TABLE AS");
eq("aggregate FILTER", at("SELECT count(*) FILTER (WHERE x) FROM t", "FILTER"), "FILTER (aggregation)");
eq("type in CAST", at("SELECT CAST(x AS varchar) FROM t", "varchar"), "VARCHAR");
eq("cursor at end of word", helpAt("SELECT 1", 6)?.entry.title, "SELECT");
eq("between words", helpAt("SELECT  1", 7), undefined);

console.log("\n=== rendering and links ===");
eq("function link", docUrl(functionDoc("count")!.page), "https://trino.io/docs/current/functions/aggregate.html#count");
eq("statement link", docUrl("sql/select"), "https://trino.io/docs/current/sql/select.html");
const md = renderDoc(functionDoc("lag")!);
assert("markdown: heading, syntax, example, link", md.startsWith("**lag** — window function") && md.includes("```sql\nlag(") && md.includes("Example:") && md.includes("(https://trino.io/docs/current/functions/window.html#lag)"), md);

console.log("\n=== languages ===");
const entries = allDocEntries();
const ticks = (t: string) => (t.match(/`[^`]*`/g) ?? []).sort().join("|");
for (const locale of ["ko", "ja", "zh"] as TrinoLocale[]) {
  eq(`${locale}: every summary translated`, entries.filter((e) => localizeDoc(e, locale).summary === e.summary).map((e) => e.id), []);
  eq(`${locale}: code spans kept`, entries.filter((e) => ticks(localizeDoc(e, locale).summary) !== ticks(e.summary)).map((e) => e.id), []);
  eq(`${locale}: every action labelled`, Object.values(uiStrings(locale).actions).filter((v) => !v || /^[A-Z][a-z]/.test(v)), []);
}
const ko = renderDoc(functionDoc("count")!, "ko");
assert("ko help: kind, example label, link label", ko.startsWith("**count** — 집계 함수") && ko.includes("예제:") && ko.includes("[Trino 문서 ↗]"), ko);
assert("ja prose title translated", renderDoc(docFor("OVER")!, "ja").startsWith("**OVER (ウィンドウ"));
eq("en unchanged", renderDoc(functionDoc("count")!, "en"), renderDoc(functionDoc("count")!));
eq("message: mismatched (ko)", localizeMessage("mismatched input 'FORM' expecting {<EOF>, ','}", "ko"), "'FORM' 에서 구문 오류: {<EOF>, ','} 이(가) 필요합니다");
eq("message: missing (ja)", localizeMessage("missing ')' at '<EOF>'", "ja"), "'<EOF>' の前に ')' がありません");
eq("message: no viable (zh)", localizeMessage("no viable alternative at input 'SELECT FROM'", "zh"), "无法解析输入 'SELECT FROM'");
eq("message: en unchanged", localizeMessage("missing ')' at '<EOF>'", "en"), "missing ')' at '<EOF>'");
eq("message: unknown passes through", localizeMessage("something else", "ko"), "something else");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
