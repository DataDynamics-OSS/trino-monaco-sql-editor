export { TrinoEditor, default } from "./TrinoEditor";
export type { TrinoEditorProps, TrinoEditorInstance } from "./TrinoEditor";

export { setupTrino } from "./trino/setup";
export type { SetupOptions } from "./trino/setup";

export {
  TRINO_LANGUAGE_ID,
  trinoLanguage,
  trinoLanguageConf,
} from "./trino/language";

export {
  TRINO_LIGHT_THEME,
  TRINO_DARK_THEME,
  trinoLightTheme,
  trinoDarkTheme,
} from "./trino/themes";

export { DEFAULT_EDITOR_OPTIONS } from "./trino/options";

export {
  DEFAULT_LANGUAGE_ELEMENTS,
  TRINO_KEYWORDS,
  TRINO_FUNCTIONS,
  TRINO_OPERATORS,
  TRINO_TYPES,
  resolveLanguageElements,
} from "./trino/keywords";
export type { TrinoLanguageElements } from "./trino/keywords";

export { createTrinoCompletionProvider } from "./trino/completion";
export type {
  MetadataProvider,
  MetadataProviderContext,
  TrinoMetadataItem,
} from "./trino/completion";

export { formatTrinoSql } from "./trino/format";
export type { Formatter } from "./trino/format";

export { createTrinoMetadataProvider } from "./trino/metadata";
export type { TrinoMetadataOptions } from "./trino/metadata";

// Shared Trino REST connection
export {
  buildHeaders,
  statementPages,
  runStatement,
} from "./trino/connection";
export type {
  TrinoConnectionOptions,
  TrinoColumn,
  StatementPage,
} from "./trino/connection";

// Query runner (for onRunQuery)
export { createTrinoQueryRunner, TrinoQueryError } from "./trino/runner";
export type {
  TrinoQueryRunner,
  TrinoQueryResult,
  RunQueryOptions,
} from "./trino/runner";

// Auth helpers
export { basicAuth, createStarburstFetch } from "./trino/auth";
export type { StarburstFetchOptions } from "./trino/auth";

// Context-aware completion (ANTLR + antlr4-c3 Web Worker)
export { createCompletionWorker } from "./worker/client";
export type { CompletionWorkerHandle } from "./worker/client";
export { createContextAwareCompletionProvider } from "./worker/contextProvider";
export type {
  CompletionWorkerApi,
  CaretContext,
  GrammarError,
  AliasInfo,
} from "./worker/protocol";
