/*
 * Checks that every built-in help entry links to an existing Trino
 * documentation page and anchor. Needs network access; not part of npm test.
 * Run: npx tsx scripts/check-doc-links.ts
 */
import { allDocEntries, docUrl } from "../src/trino/docs.js";

const pages = new Map<string, Set<string>>();
for (const e of allDocEntries()) {
  const [path, anchor] = e.page.split("#");
  if (!pages.has(path)) pages.set(path, new Set());
  if (anchor) pages.get(path)!.add(anchor);
}

let fail = 0;
for (const [path, anchors] of pages) {
  const url = docUrl(path);
  const res = await fetch(url);
  if (!res.ok) {
    fail++;
    console.log(`  ❌ ${url} → ${res.status}`);
    continue;
  }
  const html = await res.text();
  const missing = [...anchors].filter((a) => !html.includes(`id="${a}"`));
  if (missing.length) fail += missing.length;
  console.log(`  ${missing.length ? "❌" : "✅"} ${url}${missing.length ? ` missing #${missing.join(", #")}` : ` (${anchors.size} anchors)`}`);
}
console.log(`\n${pages.size} pages, ${fail} broken`);
if (fail) process.exit(1);
