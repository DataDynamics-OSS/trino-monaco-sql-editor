/* Node test for the lightweight formatter. Run: npx tsx scripts/test-format.ts */
import { formatTrinoSql } from "../src/trino/format.js";

let pass = 0;
let fail = 0;
function eq(label: string, sql: string, expected: string) {
  const actual = formatTrinoSql(sql) as string;
  if (actual === expected) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}\n     got:      ${JSON.stringify(actual)}\n     expected: ${JSON.stringify(expected)}`);
  }
}

console.log("=== clauses ===");
eq("breaks major clauses", "select a, b from t where x = 1 order by a limit 10", "select a, b\nFROM t\nWHERE x = 1\nORDER BY a\nLIMIT 10");
eq("collapses whitespace", "  select\n\n\n   *    from   t  ", "select *\nFROM t");
eq("joins", "select * from t left join u on u.id = t.id", "select *\nFROM t\nLEFT JOIN u\nON u.id = t.id");
eq("multi-word clauses stay together", "select a from t union all select b from u", "select a\nFROM t\nUNION ALL\nSELECT b\nFROM u");
eq("DELETE FROM at the start", "delete from t where a = 1", "delete from t\nWHERE a = 1");
eq("INSERT INTO … SELECT", "insert into t select * from u", "insert into t\nSELECT *\nFROM u");

console.log("\n=== literals and comments are never changed ===");
eq("keyword inside a string literal", "select 'a from b' from t", "select 'a from b'\nFROM t");
eq("whitespace inside a string literal", "select 'x    y' from t", "select 'x    y'\nFROM t");
eq("escaped quote in a string", "select 'it''s from' from t", "select 'it''s from'\nFROM t");
eq("quoted identifier", 'select "where  col" from t', 'select "where  col"\nFROM t');
eq("line comment keeps its line break", "select a, -- first column\n  b\nfrom t", "select a, -- first column\nb\nFROM t");
eq("apostrophe in a line comment", "select a -- it's fine\nfrom t where b = 'x  y'", "select a -- it's fine\nFROM t\nWHERE b = 'x  y'");
eq("leading comment", "-- daily report\nselect * from orders where x = 1", "-- daily report\nSELECT *\nFROM orders\nWHERE x = 1");
eq("block comment kept verbatim", "select a /* keep\n   this from */ from t", "select a /* keep\n   this from */\nFROM t");
eq("comment at the end", "select a from t -- done", "select a\nFROM t -- done");
eq("blank input unchanged", "   ", "   ");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
