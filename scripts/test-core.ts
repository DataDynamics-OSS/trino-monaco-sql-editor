/* Node smoke test for the c3 completion core. Run: npx tsx scripts/test-core.ts */
import { getCaretContext, validateGrammar } from "../src/worker/completionCore.js";

interface Case {
  name: string;
  sql: string;
  /** caret marked by `|` in `sql`; computed automatically. */
}

const cases: Case[] = [
  { name: "after FROM (expect table)", sql: "SELECT * FROM |" },
  { name: "partial table after FROM", sql: "SELECT * FROM ord|" },
  { name: "in SELECT list (expect column/function)", sql: "SELECT | FROM t" },
  { name: "after WHERE (expect column/function)", sql: "SELECT * FROM t WHERE |" },
  { name: "qualified column a.| ", sql: "SELECT * FROM orders a WHERE a.|" },
  { name: "start of statement", sql: "|" },
  { name: "after SELECT col, (expect column)", sql: "SELECT a, | FROM t" },
  { name: "INSERT INTO (expect table)", sql: "INSERT INTO |" },
  { name: "INSERT column list (expect column)", sql: "INSERT INTO orders (|)" },
  { name: "DELETE FROM (expect table)", sql: "DELETE FROM |" },
  { name: "UPDATE (expect table)", sql: "UPDATE |" },
  { name: "UPDATE SET (expect column)", sql: "UPDATE orders SET |" },
  { name: "DROP TABLE (expect table)", sql: "DROP TABLE |" },
  { name: "SHOW COLUMNS FROM (expect table)", sql: "SHOW COLUMNS FROM |" },
  { name: "UNION second SELECT (expect column/function)", sql: "SELECT a FROM t UNION SELECT | FROM s" },
  { name: "EXPLAIN wraps query (expect table)", sql: "EXPLAIN SELECT * FROM |" },
];

function splitCaret(s: string): { text: string; line: number; column: number } {
  const idx = s.indexOf("|");
  const text = s.replace("|", "");
  const before = s.slice(0, idx);
  const lines = before.split("\n");
  return {
    text,
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

let pass = 0;
let fail = 0;
for (const c of cases) {
  const { text, line, column } = splitCaret(c.sql);
  const ctx = getCaretContext(text, { line, column });
  console.log(`\n■ ${c.name}`);
  console.log(`  sql: ${JSON.stringify(c.sql)}`);
  console.log(
    `  expectTable=${ctx.expectTable} expectColumn=${ctx.expectColumn} expectFunction=${ctx.expectFunction}`,
  );
  console.log(`  qualifier=${JSON.stringify(ctx.qualifier)} partial=${JSON.stringify(ctx.partialWord)}`);
  console.log(`  aliases=${JSON.stringify(ctx.aliases)}`);
  console.log(`  keywords(${ctx.keywords.length}): ${ctx.keywords.slice(0, 12).join(", ")}`);
}

// Assertions
function assert(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}

console.log("\n=== assertions ===");
{
  const a = getCaretContext("SELECT * FROM ", { line: 1, column: 15 });
  assert("FROM -> expectTable", a.expectTable === true);
}
{
  const a = getCaretContext("SELECT  FROM t", { line: 1, column: 8 });
  assert("SELECT list -> expectColumn", a.expectColumn === true);
  assert("SELECT list -> expectFunction", a.expectFunction === true);
}
{
  const a = getCaretContext("SELECT * FROM orders a WHERE a.", { line: 1, column: 32 });
  assert("a. -> qualifier=[a]", JSON.stringify(a.qualifier) === JSON.stringify(["a"]));
  assert("a. -> alias resolved orders", a.aliases.some(x => x.alias === "a" && x.table === "orders"));
}
{
  const a = getCaretContext("SELECT * FROM ", { line: 1, column: 15 });
  assert("FROM keywords do not suggest SELECT", !a.keywords.includes("SELECT"));
}
{
  const errs = validateGrammar("SELECT FROM");
  assert("invalid SQL produces grammar error(s)", errs.length > 0);
  const ok = validateGrammar("SELECT a FROM t");
  assert("valid SQL produces no error", ok.length === 0);
}

// --- extended statements ---
function ctx(sql: string) {
  const { text, line, column } = splitCaret(sql);
  return getCaretContext(text, { line, column });
}
{
  assert("INSERT INTO -> expectTable", ctx("INSERT INTO |").expectTable === true);
  assert("INSERT column list -> expectColumn", ctx("INSERT INTO orders (|)").expectColumn === true);
  assert("DELETE FROM -> expectTable", ctx("DELETE FROM |").expectTable === true);
  assert("UPDATE -> expectTable", ctx("UPDATE |").expectTable === true);
  assert("UPDATE SET -> expectColumn", ctx("UPDATE orders SET |").expectColumn === true);
  assert("DROP TABLE -> expectTable", ctx("DROP TABLE |").expectTable === true);
  assert("SHOW COLUMNS FROM -> expectTable", ctx("SHOW COLUMNS FROM |").expectTable === true);
  const u = ctx("SELECT a FROM t UNION SELECT | FROM s");
  assert("UNION second SELECT -> expectColumn", u.expectColumn === true);
  assert("UNION second SELECT -> expectFunction", u.expectFunction === true);
  assert("EXPLAIN query -> expectTable", ctx("EXPLAIN SELECT * FROM |").expectTable === true);
}
{
  assert("valid INSERT...SELECT no error", validateGrammar("INSERT INTO t SELECT * FROM s").length === 0);
  assert("valid CREATE TABLE no error", validateGrammar("CREATE TABLE foo (id BIGINT, name VARCHAR(10))").length === 0);
  assert("valid CTAS no error", validateGrammar("CREATE TABLE foo AS SELECT * FROM bar").length === 0);
  assert("valid UPDATE no error", validateGrammar("UPDATE t SET a = 1 WHERE b > 2").length === 0);
  assert("invalid DROP produces error", validateGrammar("DROP TABLE").length > 0);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
