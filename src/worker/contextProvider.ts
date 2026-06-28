/**
 * Context-aware Monaco completion provider.
 *
 * Calls the worker for the parser-derived caret context, then expands it into
 * concrete Monaco completion items:
 *   - `expectTable`    -> tables / catalogs / schemas (via metadataProvider)
 *   - `expectColumn`   -> columns (via metadataProvider) + in-scope aliases
 *   - `expectFunction` -> built-in functions
 *   - grammar-valid keywords (case-matched)
 *   - `a.` qualifier   -> only columns of that alias/table
 */
import type { Monaco } from "@monaco-editor/react";
import type { languages, editor, Position, IRange } from "monaco-editor";
import type { Remote } from "comlink";
import type { CompletionWorkerApi } from "./protocol.js";
import type { TrinoLanguageElements } from "../trino/keywords.js";
import type {
  MetadataProvider,
  TrinoMetadataItem,
} from "../trino/completion.js";

function matchCase(text: string, typed: string): string {
  if (!typed) return text.toUpperCase();
  return typed.toUpperCase() === typed ? text.toUpperCase() : text.toLowerCase();
}

function metadataKind(
  monaco: Monaco,
  kind: TrinoMetadataItem["kind"],
): languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "catalog": return K.Module;
    case "schema": return K.Folder;
    case "table": return K.Struct;
    case "view": return K.Interface;
    case "column": return K.Field;
    default: return K.Value;
  }
}

export function createContextAwareCompletionProvider(
  monaco: Monaco,
  api: Remote<CompletionWorkerApi>,
  elements: TrinoLanguageElements,
  metadataProvider?: MetadataProvider,
): languages.CompletionItemProvider {
  const K = monaco.languages.CompletionItemKind;

  return {
    triggerCharacters: [".", " ", "(", ","],

    async provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
    ): Promise<languages.CompletionList> {
      const text = model.getValue();
      const ctx = await api.getCaretContext(text, {
        line: position.lineNumber,
        column: position.column,
      });

      const wordInfo = model.getWordUntilPosition(position);
      const typed = ctx.partialWord || wordInfo.word;
      const range: IRange = {
        startLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordInfo.endColumn,
      };

      const hasQualifier = ctx.qualifier.length > 0;
      const items: languages.CompletionItem[] = [];

      // Schema metadata (tables / columns / catalogs / schemas) — delegated.
      if (metadataProvider && (ctx.expectTable || ctx.expectColumn || hasQualifier)) {
        try {
          const metas = await metadataProvider({
            text,
            position: { line: position.lineNumber, column: position.column },
            word: typed,
            expectTable: ctx.expectTable,
            expectColumn: ctx.expectColumn,
            qualifier: ctx.qualifier,
            aliases: ctx.aliases,
          });
          for (const m of metas) {
            items.push({
              label: m.label,
              kind: metadataKind(monaco, m.kind),
              insertText: m.insertText ?? m.label,
              detail: m.detail ?? m.kind,
              documentation: m.documentation,
              range,
              sortText: `1-${m.label}`,
            });
          }
        } catch {
          /* keep going with static suggestions */
        }
      }

      if (!hasQualifier) {
        // In-scope table aliases when a column is expected.
        if (ctx.expectColumn) {
          for (const a of ctx.aliases) {
            items.push({
              label: a.alias,
              kind: K.Variable,
              insertText: a.alias,
              detail: `alias · ${a.table}`,
              range,
              sortText: `0-${a.alias}`,
            });
          }
        }

        // Built-in functions.
        if (ctx.expectFunction) {
          for (const fn of elements.functions) {
            items.push({
              label: fn,
              kind: K.Function,
              insertText: `${fn}($0)`,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: "function",
              range,
              sortText: `2-${fn}`,
            });
          }
        }

        // Grammar-valid keywords (case-matched).
        for (const kw of ctx.keywords) {
          const value = matchCase(kw, typed);
          items.push({
            label: value,
            kind: K.Keyword,
            insertText: value,
            detail: "keyword",
            range,
            sortText: `3-${value}`,
          });
        }
      }

      // De-dupe by label.
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
