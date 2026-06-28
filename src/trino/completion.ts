import type { Monaco } from "@monaco-editor/react";
import type { languages, editor, Position, IRange } from "monaco-editor";
import { TRINO_LANGUAGE_ID } from "./language";
import type { TrinoLanguageElements } from "./keywords";

/**
 * A metadata suggestion item supplied by the host application
 * (e.g. a catalog/schema/table/column from the Trino metadata API).
 */
export interface TrinoMetadataItem {
  /** Text inserted / shown. */
  label: string;
  /** What kind of object this is — affects icon + sort order. */
  kind: "catalog" | "schema" | "table" | "column" | "view";
  /** Optional secondary text shown to the right of the label. */
  detail?: string;
  /** Optional markdown documentation. */
  documentation?: string;
  /** Overrides what is inserted (defaults to `label`). */
  insertText?: string;
}

/**
 * Async hook the host can implement to provide schema-aware suggestions.
 * Receives the full text, the cursor position, and (when context-aware
 * completion is enabled) the parser-derived caret context.
 */
export interface MetadataProviderContext {
  text: string;
  position: { line: number; column: number };
  /** The word currently being typed (before the cursor). */
  word: string;
  /** True when the grammar expects a table here (after FROM / JOIN). */
  expectTable?: boolean;
  /** True when the grammar expects a column / qualified reference here. */
  expectColumn?: boolean;
  /** Qualifier chain typed before the caret: `a.` -> ["a"], `cat.sch.` -> ["cat","sch"]. */
  qualifier?: string[];
  /** Table aliases in scope, resolved from the parse tree. */
  aliases?: { alias: string; table: string }[];
}

export type MetadataProvider = (
  context: MetadataProviderContext,
) => TrinoMetadataItem[] | Promise<TrinoMetadataItem[]>;

const SORT = {
  metadata: "1",
  function: "2",
  keyword: "3",
  type: "4",
} as const;

/** Match the case of a keyword to what the user is currently typing (UPPER vs lower). */
function matchCase(text: string, typed: string): string {
  if (!typed) return text.toUpperCase();
  // all-uppercase typed token -> uppercase, otherwise lowercase
  return typed.toUpperCase() === typed ? text.toUpperCase() : text.toLowerCase();
}

function metadataKind(
  monaco: Monaco,
  kind: TrinoMetadataItem["kind"],
): languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "catalog":
      return K.Module;
    case "schema":
      return K.Folder;
    case "table":
      return K.Struct;
    case "view":
      return K.Interface;
    case "column":
      return K.Field;
    default:
      return K.Value;
  }
}

/**
 * Build the Trino completion item provider.
 *
 * Suggests built-in functions, keywords and data types from the configured
 * language elements, plus optional schema-aware metadata from `metadataProvider`.
 * De-duplicates by label and matches keyword casing to the user's input.
 */
export function createTrinoCompletionProvider(
  monaco: Monaco,
  elements: TrinoLanguageElements,
  metadataProvider?: MetadataProvider,
): languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", " ", "(", ","],

    async provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
    ): Promise<languages.CompletionList> {
      const wordInfo = model.getWordUntilPosition(position);
      const typed = wordInfo.word;
      const range: IRange = {
        startLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordInfo.endColumn,
      };

      const K = monaco.languages.CompletionItemKind;
      const items: languages.CompletionItem[] = [];

      // functions
      for (const fn of elements.functions) {
        items.push({
          label: fn,
          kind: K.Function,
          insertText: `${fn}($0)`,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: "function",
          range,
          sortText: `${SORT.function}-${fn}`,
        });
      }

      // keywords (case-matched)
      for (const kw of elements.keywords) {
        const value = matchCase(kw, typed);
        items.push({
          label: value,
          kind: K.Keyword,
          insertText: value,
          detail: "keyword",
          range,
          sortText: `${SORT.keyword}-${value}`,
        });
      }

      // data types
      for (const t of elements.types) {
        const value = matchCase(t, typed);
        items.push({
          label: value,
          kind: K.TypeParameter,
          insertText: value,
          detail: "type",
          range,
          sortText: `${SORT.type}-${value}`,
        });
      }

      // host-supplied metadata (catalog/schema/table/column)
      if (metadataProvider) {
        try {
          const metas = await metadataProvider({
            text: model.getValue(),
            position: { line: position.lineNumber, column: position.column },
            word: typed,
          });
          for (const m of metas) {
            items.push({
              label: m.label,
              kind: metadataKind(monaco, m.kind),
              insertText: m.insertText ?? m.label,
              detail: m.detail ?? m.kind,
              documentation: m.documentation,
              range,
              sortText: `${SORT.metadata}-${m.label}`,
            });
          }
        } catch {
          // ignore metadata errors — keep static suggestions
        }
      }

      // de-dupe by label (keep first occurrence / best sort)
      const seen = new Set<string>();
      const suggestions = items.filter((i) => {
        const key = String(i.label);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { suggestions };
    },
  };
}

export { TRINO_LANGUAGE_ID };
