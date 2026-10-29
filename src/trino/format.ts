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

// One pass over a longest-first alternation, so a multi-word clause such as
// LEFT JOIN or DELETE FROM is matched once instead of being split again by
// its last word (JOIN / FROM).
const CLAUSE_RE = new RegExp(
  `(^|\\s+)(${[...NEWLINE_BEFORE]
    .sort((a, b) => b.length - a.length)
    .map((c) => c.replace(/ /g, "\\s+"))
    .join("|")})\\b`,
  "gi",
);

export type SegmentType = "code" | "string" | "quoted" | "lineComment" | "blockComment";

export interface Segment {
  type: SegmentType;
  text: string;
}

/**
 * Format a SQL string: collapse whitespace, uppercase leading clause keywords,
 * and break major clauses onto their own lines. Intentionally conservative so
 * it never corrupts a query: string literals, quoted identifiers and comments
 * are copied verbatim, and a `--` comment always keeps its line break.
 */
export const formatTrinoSql: Formatter = (sql: string): string => {
  if (!sql.trim()) return sql;

  const segments = splitSegments(sql);
  let out = "";
  let afterLineComment = false;

  for (const seg of segments) {
    if (seg.type !== "code") {
      out += seg.text;
      afterLineComment = seg.type === "lineComment";
      if (afterLineComment) out += "\n";
      continue;
    }

    // Collapse runs of whitespace, then break before major clauses.
    let code = seg.text.replace(/\s+/g, " ");
    if (!out) code = code.trimStart(); // the leading keyword stays as typed
    code = code.replace(CLAUSE_RE, (m, lead: string, kw: string) =>
      // At the very start of the text the keyword stays as typed.
      lead === "" && !out ? m : `\n${kw.toUpperCase()}`,
    );
    code = code.replace(/ *\n */g, "\n");
    if (afterLineComment) code = code.replace(/^\s+/, "");
    afterLineComment = false;
    out += code;
  }

  // Trim the ends — unless the text ends inside a literal or block comment.
  const last = segments[segments.length - 1];
  const trimEnd = last.type === "code" || last.type === "lineComment";
  return trimEnd ? out.trim() : out.replace(/^\s+/, "");
};

/**
 * Split SQL into code, string literals (`'...'`, `''` escapes), quoted
 * identifiers (`"..."`, `""` escapes), `--` line comments (without their
 * newline) and block comments. Unterminated tokens run to the end.
 */
export function splitSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  let code = "";
  let i = 0;

  const flush = () => {
    if (code) segments.push({ type: "code", text: code });
    code = "";
  };
  const take = (type: SegmentType, end: number) => {
    flush();
    segments.push({ type, text: input.slice(i, end) });
    i = end;
  };
  const closingQuote = (quote: string): number => {
    let j = i + 1;
    while (j < input.length) {
      if (input[j] === quote) {
        if (input[j + 1] === quote) {
          j += 2; // escaped quote
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return input.length;
  };

  while (i < input.length) {
    const ch = input[i];
    if (ch === "-" && input[i + 1] === "-") {
      const nl = input.indexOf("\n", i);
      take("lineComment", nl < 0 ? input.length : nl);
    } else if (ch === "/" && input[i + 1] === "*") {
      const close = input.indexOf("*/", i + 2);
      take("blockComment", close < 0 ? input.length : close + 2);
    } else if (ch === "'") {
      take("string", closingQuote("'"));
    } else if (ch === '"') {
      take("quoted", closingQuote('"'));
    } else {
      code += ch;
      i++;
    }
  }
  flush();
  return segments;
}
