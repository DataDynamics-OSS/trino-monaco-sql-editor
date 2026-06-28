/**
 * Lightweight Trino SQL formatter.
 *
 * A small, dependency-free formatter shipped as a sensible default for the
 * "Prettify" action. You can replace it entirely via the `formatter` prop on
 * `<TrinoEditor />` (e.g. to delegate to a server-side / worker formatter).
 */

export type Formatter = (sql: string) => string | Promise<string>;

const NEWLINE_BEFORE = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT",
  "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "CROSS JOIN", "JOIN",
  "UNION ALL", "UNION", "INTERSECT", "EXCEPT", "ON", "WITH", "VALUES",
  "INSERT INTO", "UPDATE", "DELETE FROM", "SET",
];

/**
 * Format a SQL string: collapse whitespace, uppercase leading clause keywords,
 * and break major clauses onto their own lines. Intentionally conservative so
 * it never corrupts a query.
 */
export const formatTrinoSql: Formatter = (sql: string): string => {
  if (!sql.trim()) return sql;

  // Normalize whitespace outside of string literals.
  const normalized = collapseWhitespaceOutsideStrings(sql).trim();

  let result = normalized;
  for (const clause of NEWLINE_BEFORE) {
    const re = new RegExp(`\\s+(${clause.replace(/ /g, "\\s+")})\\b`, "gi");
    result = result.replace(re, (_m, kw: string) => `\n${kw.toUpperCase()}`);
  }

  // Ensure a single trailing newline-free output, trimmed lines.
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
};

function collapseWhitespaceOutsideStrings(input: string): string {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      // collapse runs of whitespace to a single space
      if (out.length && out[out.length - 1] !== " ") out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}
