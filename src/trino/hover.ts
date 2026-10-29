/**
 * Built-in help as a Monaco hover: functions called at the cursor
 * (`count(`), keywords / statements chosen by the following words
 * (`GROUP BY`, `CREATE TABLE … AS`, `IS NOT NULL`) and data types.
 * Words inside string literals, quoted identifiers and comments, and
 * qualified names (`t.count`), get no help.
 */
import type { Monaco } from "@monaco-editor/react";
import type { languages, editor, Position } from "monaco-editor";
import { docFor, renderDoc, type TrinoDocEntry } from "./docs";
import { splitSegments } from "./format";
import type { TrinoLocale } from "./i18n";

export interface HelpAt {
  entry: TrinoDocEntry;
  /** Word range as text offsets (`end` exclusive). */
  start: number;
  end: number;
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;

/** Whether `offset` is inside a string literal, quoted identifier or comment. */
function inLiteral(text: string, offset: number): boolean {
  let pos = 0;
  for (const seg of splitSegments(text)) {
    const end = pos + seg.text.length;
    if (offset < end) return seg.type !== "code";
    pos = end;
  }
  return false;
}

/** The next few words (and `(`, `;`) after `offset`, upper-case: context for multi-word keywords. */
function wordsAfter(text: string, offset: number, n = 8): string[] {
  return (text.slice(offset, offset + 300).match(/[A-Za-z_][A-Za-z0-9_]*|[(;]/g) ?? [])
    .slice(0, n)
    .map((w) => w.toUpperCase());
}

/** Help for the word at text `offset`, if it is a built-in function, keyword or type. */
export function helpAt(text: string, offset: number): HelpAt | undefined {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start--;
  WORD.lastIndex = start;
  const m = WORD.exec(text);
  if (!m || offset > start + m[0].length) return undefined;
  const end = start + m[0].length;
  // `t.count` / `count.x` are names, not built-ins.
  if (text[start - 1] === "." || /^\s*\.(?!\.)/.test(text.slice(end, end + 50))) return undefined;
  if (inLiteral(text, start)) return undefined;

  const call = /^\s*\(/.test(text.slice(end, end + 50));
  const entry = docFor(m[0], { next: wordsAfter(text, end), call });
  return entry ? { entry, start, end } : undefined;
}

export interface TrinoHoverOptions {
  /** UI language of the help text. */
  locale?: () => TrinoLocale | undefined;
  /** Return `false` to skip a model (e.g. one owned by another editor). */
  enabled?: (model: editor.ITextModel) => boolean;
}

/** Monaco hover provider showing the built-in help. */
export function createTrinoHoverProvider(
  monaco: Monaco,
  options: TrinoHoverOptions = {},
): languages.HoverProvider {
  return {
    provideHover(model: editor.ITextModel, position: Position) {
      if (options.enabled && !options.enabled(model)) return null;
      const help = helpAt(model.getValue(), model.getOffsetAt(position));
      if (!help) return null;
      const from = model.getPositionAt(help.start);
      const to = model.getPositionAt(help.end);
      return {
        range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
        contents: [{ value: renderDoc(help.entry, options.locale?.()) }],
      };
    },
  };
}
