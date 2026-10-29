/**
 * Shared types between the completion worker and the main thread.
 * (No antlr imports here, so the main bundle never pulls in the parser.)
 */

export interface AliasInfo {
  /** Alias name (or the bare table name when no explicit alias). */
  alias: string;
  /** Fully-qualified table text as written, e.g. "tpch.sf1.orders". */
  table: string;
}

export interface CaretContext {
  /** Keyword / operator texts that are grammatically valid at the caret. */
  keywords: string[];
  /** A table reference is expected at the caret (e.g. after FROM / JOIN). */
  expectTable: boolean;
  /** A column / qualified reference is expected (SELECT list, WHERE, …). */
  expectColumn: boolean;
  /** A function name is expected (anywhere an expression is valid). */
  expectFunction: boolean;
  /**
   * Qualifier chain typed before the caret:
   *   `a.`        -> ["a"]
   *   `cat.sch.`  -> ["cat", "sch"]
   * Lets the host fetch columns of a specific alias/table or objects under a
   * specific catalog/schema.
   */
  qualifier: string[];
  /** The partial word immediately before the caret (for filtering). */
  partialWord: string;
  /** Table aliases in scope, resolved from the parse tree. */
  aliases: AliasInfo[];
}

export interface GrammarError {
  /** 1-based line. */
  line: number;
  /** 1-based start column (Monaco convention). */
  column: number;
  /** 1-based end column. */
  endColumn: number;
  message: string;
}

/** The RPC surface the worker exposes via Comlink. */
export interface CompletionWorkerApi {
  getCaretContext(
    text: string,
    position: { line: number; column: number },
  ): CaretContext;
  validateGrammar(text: string): GrammarError[];
}
