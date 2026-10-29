/* Node test for createTrinoMetadataProvider with a mocked fetch.
   Run: npx tsx scripts/test-metadata.ts */
import { createTrinoMetadataProvider } from "../src/trino/metadata.js";
import type { MetadataProviderContext } from "../src/trino/completion.js";

const issued: string[] = []; // SQLs sent via POST /v1/statement

function page(columns: string[], rows: unknown[][], nextUri?: string) {
  return {
    json: async () => ({
      columns: columns.map((name) => ({ name })),
      data: rows,
      nextUri,
    }),
  };
}

const PAGE2 = "https://trino.test/v1/statement/page2";

const fakeFetch = (async (url: string, init?: { method?: string; body?: string }) => {
  if (init?.method === "POST") {
    const sql = String(init.body);
    issued.push(sql);
    switch (sql) {
      case "SHOW CATALOGS":
        return page(["Catalog"], [["tpch"], ["hive"]]);
      case 'SHOW SCHEMAS FROM "tpch"':
        return page(["Schema"], [["sf1"], ["sf100"]]);
      case 'SHOW TABLES FROM "tpch"."sf1"':
        // Return first page + a nextUri to exercise pagination.
        return page(["Table"], [["orders"]], PAGE2);
      case 'SHOW COLUMNS FROM "tpch"."sf1"."orders"':
        return page(
          ["Column", "Type", "Extra", "Comment"],
          [["order_id", "bigint", "", ""], ["total", "double", "", ""]],
        );
      default:
        return page([], []);
    }
  }
  // GET nextUri -> second page of SHOW TABLES
  if (url === PAGE2) return page(["Table"], [["customer"]]);
  return page([], []);
}) as unknown as typeof fetch;

const provider = createTrinoMetadataProvider({
  baseUrl: "https://trino.test",
  catalog: "tpch",
  schema: "sf1",
  fetch: fakeFetch,
});

function ctx(p: Partial<MetadataProviderContext>): MetadataProviderContext {
  return { text: "", position: { line: 1, column: 1 }, word: "", ...p };
}

let pass = 0;
let fail = 0;
function assert(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}

async function main() {
  // 1) FROM | -> catalogs + schemas + tables (with pagination on tables)
  {
    const items = await provider(ctx({ expectTable: true, qualifier: [] }));
    const labels = items.map((i) => i.label);
    assert("FROM | issues SHOW TABLES FROM tpch.sf1", issued.includes('SHOW TABLES FROM "tpch"."sf1"'));
    assert("FROM | issues SHOW CATALOGS", issued.includes("SHOW CATALOGS"));
    assert("FROM | issues SHOW SCHEMAS FROM tpch", issued.includes('SHOW SCHEMAS FROM "tpch"'));
    assert("FROM | tables paginated (orders + customer)", labels.includes("orders") && labels.includes("customer"));
    assert("FROM | includes schema sf1 and catalog hive", labels.includes("sf1") && labels.includes("hive"));
  }

  // 2) FROM tpch.| -> schemas of catalog tpch (tpch is a known catalog)
  {
    const items = await provider(ctx({ expectTable: true, qualifier: ["tpch"] }));
    assert("FROM tpch.| -> schemas", items.every((i) => i.kind === "schema") && items.some((i) => i.label === "sf1"));
  }

  // 3) FROM sf1.| -> tables of current catalog's schema sf1 (sf1 is NOT a catalog)
  {
    const items = await provider(ctx({ expectTable: true, qualifier: ["sf1"] }));
    const labels = items.map((i) => i.label);
    assert(
      "FROM sf1.| -> tables of tpch.sf1",
      items.every((i) => i.kind === "table") && labels.includes("orders"),
    );
  }

  // 4) WHERE a.| with alias a -> orders -> columns
  {
    const items = await provider(
      ctx({ expectColumn: true, qualifier: ["a"], aliases: [{ alias: "a", table: "orders" }] }),
    );
    const labels = items.map((i) => i.label);
    assert("a.| -> columns order_id/total", labels.includes("order_id") && labels.includes("total"));
    assert("a.| columns carry type detail", items.find((i) => i.label === "order_id")?.detail?.includes("bigint") === true);
  }

  // 5) SELECT | with alias -> columns of all in-scope tables
  {
    const items = await provider(
      ctx({ expectColumn: true, qualifier: [], aliases: [{ alias: "o", table: "orders" }] }),
    );
    assert("SELECT | -> columns of in-scope tables", items.some((i) => i.label === "order_id"));
  }

  // 6) caching: SHOW COLUMNS issued only once across the two column calls above
  {
    const count = issued.filter((s) => s === 'SHOW COLUMNS FROM "tpch"."sf1"."orders"').length;
    assert("SHOW COLUMNS cached (issued once)", count === 1);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
