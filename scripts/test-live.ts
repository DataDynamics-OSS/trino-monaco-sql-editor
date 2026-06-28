/* Live smoke test against a real Trino/Starburst cluster.
   Run: TRINO_URL=https://host:8443 TRINO_USER=admin TRINO_PASS=secret \
        NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/test-live.ts
   Skips (exit 0) if TRINO_URL is not set. */
import { createTrinoQueryRunner } from "../src/trino/runner.js";
import { createTrinoMetadataProvider } from "../src/trino/metadata.js";
import { basicAuth } from "../src/trino/auth.js";

const baseUrl = process.env.TRINO_URL;
if (!baseUrl) {
  console.log("TRINO_URL not set — skipping live test.");
  process.exit(0);
}
const user = process.env.TRINO_USER ?? "trino";
const pass = process.env.TRINO_PASS ?? "";
const authorization = pass ? basicAuth(user, pass) : undefined;

async function main() {
  const run = createTrinoQueryRunner({ baseUrl, user, authorization });
  const meta = createTrinoMetadataProvider({ baseUrl, user, authorization });

  console.log("→ SELECT 42 ...");
  const r = await run("SELECT 42 AS answer, 'trino' AS who");
  console.log("  columns:", r.columns.map((c) => `${c.name}:${c.type}`).join(", "));
  console.log("  rows:", JSON.stringify(r.rows));

  console.log("→ metadata FROM | (catalogs/schemas/tables) ...");
  const items = await meta({ text: "", position: { line: 1, column: 1 }, word: "", expectTable: true, qualifier: [] });
  const byKind: Record<string, number> = {};
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  console.log("  counts:", JSON.stringify(byKind));
  console.log("  sample:", items.slice(0, 8).map((i) => `${i.label}(${i.kind})`).join(", "));

  console.log("\n✅ live smoke test OK");
}

main().catch((e) => {
  console.error("❌ live test failed:", e);
  process.exit(1);
});
