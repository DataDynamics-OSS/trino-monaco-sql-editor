/* Node test for createTrinoQueryRunner with a mocked fetch.
   Run: npx tsx scripts/test-runner.ts */
import { createTrinoQueryRunner, TrinoQueryError } from "../src/trino/runner.js";

const U1 = "https://trino.test/v1/statement/q/1";
const U2 = "https://trino.test/v1/statement/q/2";
const deletes: string[] = [];

function json(body: unknown) {
  return { json: async () => body } as Response;
}

const fakeFetch = (async (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
  if (init?.signal?.aborted) {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }
  if (init?.method === "DELETE") {
    deletes.push(url);
    return json({});
  }
  if (init?.method === "POST") {
    const sql = String(init.body);
    if (sql.includes("BAD")) {
      return json({ id: "qBad", error: { message: "line 1:1: mismatched input 'BAD'" } });
    }
    // queued, no columns/data yet
    return json({ id: "q1", stats: { state: "QUEUED" }, nextUri: U1 });
  }
  if (url === U1) {
    return json({
      stats: { state: "RUNNING" },
      columns: [{ name: "x", type: "integer" }, { name: "y", type: "varchar" }],
      data: [[1, "hi"], [2, "yo"]],
      nextUri: U2,
    });
  }
  if (url === U2) {
    return json({ stats: { state: "FINISHED" } }); // no nextUri -> done
  }
  return json({});
}) as unknown as typeof fetch;

let pass = 0, fail = 0;
function assert(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}

async function main() {
  const run = createTrinoQueryRunner({ baseUrl: "https://trino.test", user: "u", fetch: fakeFetch });

  // 1) happy path: queued -> running(cols+data) -> finished
  {
    const pages: number[] = [];
    const res = await run("SELECT 1 AS x, 'hi' AS y", { onPage: (p) => pages.push(p.rows.length) });
    assert("id captured", res.id === "q1");
    assert("columns mapped (name+type)", res.columns.length === 2 && res.columns[0].name === "x" && res.columns[0].type === "integer");
    assert("rows accumulated", res.rows.length === 2 && (res.rows[0] as unknown[])[1] === "hi");
    assert("onPage streamed", pages.length === 1 && pages[0] === 2);
  }

  // 2) query error -> TrinoQueryError
  {
    let err: unknown;
    try { await run("BAD SQL"); } catch (e) { err = e; }
    assert("throws TrinoQueryError", err instanceof TrinoQueryError);
    assert("error message surfaced", String((err as Error).message).includes("mismatched input"));
  }

  // 3) cancellation -> server-side DELETE issued
  {
    const ctrl = new AbortController();
    let err: unknown;
    try {
      await run("SELECT 1 AS x, 'hi' AS y", {
        signal: ctrl.signal,
        onPage: () => ctrl.abort(), // abort right after first data page
      });
    } catch (e) { err = e; }
    assert("aborted run rejects", (err as Error)?.name === "AbortError");
    assert("server-side DELETE sent on cancel", deletes.length >= 1);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
