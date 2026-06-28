import { useCallback, useEffect, useMemo, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor, IDisposable } from "monaco-editor";
import { setupTrino } from "./trino/setup";
import { DEFAULT_EDITOR_OPTIONS } from "./trino/options";
import { TRINO_DARK_THEME, TRINO_LIGHT_THEME } from "./trino/themes";
import { TRINO_LANGUAGE_ID } from "./trino/language";
import {
  resolveLanguageElements,
  type TrinoLanguageElements,
} from "./trino/keywords";
import type { MetadataProvider } from "./trino/completion";
import { formatTrinoSql, type Formatter } from "./trino/format";
import {
  createCompletionWorker,
  type CompletionWorkerHandle,
} from "./worker/client";
import { createContextAwareCompletionProvider } from "./worker/contextProvider";

export type TrinoEditorInstance = editor.IStandaloneCodeEditor;

export interface TrinoEditorProps {
  /** Controlled value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Called on every content change. */
  onChange?: (value: string) => void;
  /** Fired when the user runs the query (Ctrl/Cmd+Enter or context menu). */
  onRunQuery?: (sql: string, editor: TrinoEditorInstance) => void;
  /** Fired for "Explain Query". */
  onExplainQuery?: (sql: string, editor: TrinoEditorInstance) => void;
  /** Color theme. */
  theme?: "light" | "dark";
  /** Make the editor read-only. */
  readOnly?: boolean;
  /** Override or extend built-in keywords/functions/operators/types. */
  languageElements?: Partial<TrinoLanguageElements>;
  /** Async provider for catalog/schema/table/column suggestions. */
  metadataProvider?: MetadataProvider;
  /** Custom SQL formatter (defaults to the built-in lightweight formatter). */
  formatter?: Formatter;
  /**
   * Enable context-aware completion + grammar validation via the ANTLR/c3 Web
   * Worker. When true, the static completion provider is replaced by the
   * worker-backed one. Read once at mount. Default `false`.
   */
  contextAware?: boolean;
  /**
   * Show grammar errors as markers while typing (only when `contextAware`).
   * Default `true`.
   */
  validateOnType?: boolean;
  /** Extra Monaco options merged over the defaults. */
  options?: editor.IStandaloneEditorConstructionOptions;
  /** Editor height (CSS value or number of px). Default "100%". */
  height?: string | number;
  /** Editor width. Default "100%". */
  width?: string | number;
  /** className on the wrapper Monaco renders. */
  className?: string;
  /** Escape hatch: called after the editor mounts. */
  onMount?: (editor: TrinoEditorInstance, monaco: Monaco) => void;
}

const MARKER_OWNER = "trino";

/**
 * A Trino SQL editor built on Monaco for React.
 *
 * - Registers the `trino` language (Monarch tokenizer + config)
 * - Light/dark Trino themes
 * - Autocomplete: static (keywords/functions) or context-aware (ANTLR + c3 worker)
 * - Grammar validation markers (context-aware mode)
 * - Actions: Run query (Ctrl/Cmd+Enter), Explain Query, Prettify (Shift+Alt+F)
 */
export function TrinoEditor({
  value,
  defaultValue,
  onChange,
  onRunQuery,
  onExplainQuery,
  theme = "light",
  readOnly = false,
  languageElements,
  metadataProvider,
  formatter = formatTrinoSql,
  contextAware = false,
  validateOnType = true,
  options,
  height = "100%",
  width = "100%",
  className,
  onMount,
}: TrinoEditorProps) {
  const editorRef = useRef<TrinoEditorInstance | null>(null);
  const handlers = useRef({ onRunQuery, onExplainQuery, formatter, metadataProvider });
  handlers.current = { onRunQuery, onExplainQuery, formatter, metadataProvider };

  // Stable delegator so the (once-registered) completion provider always uses
  // the LATEST metadataProvider — e.g. after the host connects to a cluster.
  const stableMetadata = useRef<MetadataProvider>((ctx) =>
    handlers.current.metadataProvider ? handlers.current.metadataProvider(ctx) : [],
  );

  // Disposables for the context-aware worker integration.
  const workerRef = useRef<CompletionWorkerHandle | null>(null);
  const providerDisposeRef = useRef<IDisposable | null>(null);
  const contentDisposeRef = useRef<IDisposable | null>(null);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const elements = useMemo(
    () => resolveLanguageElements(languageElements),
    [languageElements],
  );

  const monacoTheme = theme === "dark" ? TRINO_DARK_THEME : TRINO_LIGHT_THEME;

  const mergedOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({ ...DEFAULT_EDITOR_OPTIONS, readOnly, ...options }),
    [readOnly, options],
  );

  const beforeMount = useCallback(
    (monaco: Monaco) => {
      // In context-aware mode the worker provider replaces the static one.
      setupTrino(monaco, {
        languageElements,
        metadataProvider,
        registerCompletion: !contextAware,
      });
    },
    [languageElements, metadataProvider, contextAware],
  );

  const handleMount = useCallback<OnMount>(
    (ed, monaco) => {
      editorRef.current = ed;

      ed.addAction({
        id: "trino.run-query",
        label: "Run query",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        contextMenuGroupId: "1_execute",
        contextMenuOrder: 1,
        run: (e) => {
          const sql = selectedOrAll(e);
          handlers.current.onRunQuery?.(sql, e as TrinoEditorInstance);
        },
      });

      ed.addAction({
        id: "trino.explain-query",
        label: "Explain Query",
        contextMenuGroupId: "1_execute",
        contextMenuOrder: 2,
        run: (e) => {
          const sql = selectedOrAll(e);
          handlers.current.onExplainQuery?.(sql, e as TrinoEditorInstance);
        },
      });

      ed.addAction({
        id: "trino.prettify",
        label: "Prettify",
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
        contextMenuGroupId: "2_modification",
        contextMenuOrder: 1,
        run: async (e) => {
          await prettifyEditor(e as TrinoEditorInstance, handlers.current.formatter);
        },
      });

      if (contextAware) {
        const handle = createCompletionWorker();
        workerRef.current = handle;

        providerDisposeRef.current = monaco.languages.registerCompletionItemProvider(
          TRINO_LANGUAGE_ID,
          createContextAwareCompletionProvider(
            monaco,
            handle.api,
            elements,
            stableMetadata.current,
          ),
        );

        if (validateOnType) {
          const model = ed.getModel();
          const runValidate = async () => {
            const m = ed.getModel();
            if (!m) return;
            try {
              const errors = await handle.api.validateGrammar(m.getValue());
              monaco.editor.setModelMarkers(
                m,
                MARKER_OWNER,
                errors.map((err) => ({
                  severity: monaco.MarkerSeverity.Error,
                  message: err.message,
                  startLineNumber: err.line,
                  startColumn: err.column,
                  endLineNumber: err.line,
                  endColumn: err.endColumn,
                })),
              );
            } catch {
              /* ignore transient worker errors */
            }
          };

          contentDisposeRef.current = ed.onDidChangeModelContent(() => {
            if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
            validateTimerRef.current = setTimeout(runValidate, 250);
          });
          if (model) void runValidate();
        }
      }

      onMount?.(ed, monaco);
    },
    [contextAware, validateOnType, elements, onMount],
  );

  // Tear down worker / providers / listeners on unmount.
  useEffect(() => {
    return () => {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
      contentDisposeRef.current?.dispose();
      providerDisposeRef.current?.dispose();
      workerRef.current?.dispose();
      contentDisposeRef.current = null;
      providerDisposeRef.current = null;
      workerRef.current = null;
    };
  }, []);

  return (
    <Editor
      language={TRINO_LANGUAGE_ID}
      theme={monacoTheme}
      value={value}
      defaultValue={defaultValue}
      defaultLanguage={TRINO_LANGUAGE_ID}
      onChange={(v) => onChange?.(v ?? "")}
      beforeMount={beforeMount}
      onMount={handleMount}
      options={mergedOptions}
      height={height}
      width={width}
      className={className}
      loading={<div style={{ padding: 12, fontFamily: "sans-serif" }}>Loading editor…</div>}
    />
  );
}

/** Return the selected text, or the whole document if the selection is empty. */
function selectedOrAll(ed: editor.ICodeEditor): string {
  const model = ed.getModel();
  if (!model) return "";
  const selection = ed.getSelection();
  if (selection && !selection.isEmpty()) {
    return model.getValueInRange(selection);
  }
  return model.getValue();
}

/** Format the whole document (or selection) and replace it in place. */
async function prettifyEditor(ed: TrinoEditorInstance, formatter: Formatter) {
  const model = ed.getModel();
  if (!model) return;
  const selection = ed.getSelection();
  const useSelection = !!selection && !selection.isEmpty();
  const cursor = ed.getPosition();

  const source = useSelection ? model.getValueInRange(selection) : model.getValue();
  if (!source.trim()) return;

  const formatted = await formatter(source);
  const range = useSelection ? selection : model.getFullModelRange();

  ed.executeEdits("trino-prettify", [
    { range, text: formatted, forceMoveMarkers: true },
  ]);
  if (cursor && !useSelection) ed.setPosition(cursor);
}

export default TrinoEditor;
