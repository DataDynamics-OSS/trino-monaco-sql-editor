import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { TRINO_LANGUAGE_ID, trinoLanguage, trinoLanguageConf } from "./language";
import {
  TRINO_DARK_THEME,
  TRINO_LIGHT_THEME,
  trinoDarkTheme,
  trinoLightTheme,
} from "./themes";
import {
  resolveLanguageElements,
  type TrinoLanguageElements,
} from "./keywords";
import {
  createTrinoCompletionProvider,
  type MetadataProvider,
} from "./completion";

export interface SetupOptions {
  /** Override or extend the built-in keywords/functions/operators/types. */
  languageElements?: Partial<TrinoLanguageElements>;
  /** Optional async provider for catalog/schema/table/column suggestions. */
  metadataProvider?: MetadataProvider;
  /**
   * Register the built-in (static) completion provider. Set to `false` when a
   * context-aware worker provider will be registered instead. Default `true`.
   */
  registerCompletion?: boolean;
}

let completionDisposable: IDisposable | null = null;
let registered = false;

/**
 * Register the Trino language, themes and completion provider with Monaco.
 * Safe to call multiple times — the language/themes register once, while the
 * completion provider is refreshed so `languageElements`/`metadataProvider`
 * changes take effect.
 */
export function setupTrino(monaco: Monaco, options: SetupOptions = {}): void {
  const elements: TrinoLanguageElements = resolveLanguageElements(
    options.languageElements,
  );

  if (!registered) {
    monaco.languages.register({ id: TRINO_LANGUAGE_ID });

    monaco.languages.setMonarchTokensProvider(TRINO_LANGUAGE_ID, {
      ...trinoLanguage,
      keywords: elements.keywords,
      operators: elements.operators,
      builtinFunctions: elements.functions,
    });

    monaco.languages.setLanguageConfiguration(TRINO_LANGUAGE_ID, trinoLanguageConf);

    monaco.editor.defineTheme(TRINO_LIGHT_THEME, trinoLightTheme);
    monaco.editor.defineTheme(TRINO_DARK_THEME, trinoDarkTheme);

    registered = true;
  }

  // (Re)register completion so updated elements / metadataProvider apply.
  completionDisposable?.dispose();
  completionDisposable = null;
  if (options.registerCompletion !== false) {
    completionDisposable = monaco.languages.registerCompletionItemProvider(
      TRINO_LANGUAGE_ID,
      createTrinoCompletionProvider(monaco, elements, options.metadataProvider),
    );
  }
}
