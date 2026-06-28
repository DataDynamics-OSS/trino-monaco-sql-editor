/**
 * Context-aware completion core.
 *
 * Lexes & parses Trino SQL with the generated ANTLR parser, then uses
 * antlr4-c3 (CodeCompletionCore) to compute — from the grammar's ATN — exactly
 * which tokens and rules are valid at the caret. This is the real context
 * analysis: "after FROM expect a table", "in the SELECT list expect a column or
 * function", "after `a.` expect columns of alias a".
 *
 * Pure logic (no Worker/DOM APIs) so it can be unit-tested in Node and reused
 * by the Web Worker.
 */
import {
  CharStream,
  CommonTokenStream,
  Token,
  BaseErrorListener,
  type Recognizer,
  type ATNSimulator,
} from "antlr4ng";
import { CodeCompletionCore } from "antlr4-c3";
import { TrinoSqlLexer } from "../generated/TrinoSqlLexer.js";
import {
  TrinoSqlParser,
  AliasedRelationContext,
} from "../generated/TrinoSqlParser.js";
import type {
  CaretContext,
  GrammarError,
  AliasInfo,
} from "./protocol.js";

class CollectingErrorListener extends BaseErrorListener {
  readonly errors: GrammarError[] = [];

  override syntaxError<S extends Token, T extends ATNSimulator>(
    _recognizer: Recognizer<T>,
    offendingSymbol: S | null,
    line: number,
    column: number,
    msg: string,
  ): void {
    const len = offendingSymbol?.text?.length ?? 1;
    this.errors.push({
      line,
      column: column + 1, // antlr is 0-based, Monaco is 1-based
      endColumn: column + 1 + Math.max(len, 1),
      message: msg,
    });
  }
}

interface ParseResult {
  parser: TrinoSqlParser;
  tokenStream: CommonTokenStream;
  tree: ReturnType<TrinoSqlParser["root"]>;
  errors: GrammarError[];
}

function parse(text: string): ParseResult {
  const errorListener = new CollectingErrorListener();

  const input = CharStream.fromString(text);
  const lexer = new TrinoSqlLexer(input);
  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener);

  const tokenStream = new CommonTokenStream(lexer);
  const parser = new TrinoSqlParser(tokenStream);
  parser.removeErrorListeners();
  parser.addErrorListener(errorListener);

  const tree = parser.root();
  tokenStream.fill();

  return { parser, tokenStream, tree, errors: errorListener.errors };
}

/** Absolute character offset for a 1-based (line, column) position. */
function offsetAt(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the newline
  }
  return offset + (column - 1);
}

/** Token index (into the full stream) the parser is "at" for the caret. */
function caretTokenIndex(tokens: Token[], caretOffset: number): number {
  let eofIndex = 0;
  for (const t of tokens) {
    if (t.type === Token.EOF) {
      eofIndex = t.tokenIndex;
      continue;
    }
    if (t.channel !== 0) continue;
    const endExclusive = t.stop + 1;
    if (caretOffset <= t.start) return t.tokenIndex; // caret before this token
    if (caretOffset < endExclusive) return t.tokenIndex; // caret strictly inside
    if (caretOffset === endExclusive && ID_TYPES.has(t.type)) {
      return t.tokenIndex; // at the end of an identifier being typed -> complete it
    }
    // Caret sits just after this token (e.g. after `(` or a keyword) — advance
    // to the next token so c3 reports what may follow.
  }
  return eofIndex;
}

function identifierText(t: Token): string {
  const raw = t.text ?? "";
  if (t.type === TrinoSqlParser.QUOTED_IDENTIFIER && raw.length >= 2) {
    return raw.slice(1, -1).replace(/""/g, '"');
  }
  return raw;
}

const ID_TYPES = new Set<number>([
  TrinoSqlParser.IDENTIFIER,
  TrinoSqlParser.QUOTED_IDENTIFIER,
]);

/** Detect the partial word and qualifier chain (`a.b.`) just before the caret. */
function analyzePrefix(
  defaultTokens: Token[],
  caretOffset: number,
): { partialWord: string; qualifier: string[] } {
  // Find the token the caret sits inside (a partial identifier), if any.
  let partialIdx = -1;
  let partialWord = "";
  for (let i = 0; i < defaultTokens.length; i++) {
    const t = defaultTokens[i];
    if (caretOffset > t.start && caretOffset <= t.stop + 1) {
      if (ID_TYPES.has(t.type)) {
        partialIdx = i;
        partialWord = (t.text ?? "").slice(0, caretOffset - t.start);
      }
      break;
    }
    if (t.start >= caretOffset) break;
  }

  // Index of the token immediately before the caret/partial.
  let j: number;
  if (partialIdx >= 0) {
    j = partialIdx - 1;
  } else {
    j = -1;
    for (let i = 0; i < defaultTokens.length; i++) {
      if (defaultTokens[i].stop + 1 <= caretOffset) j = i;
      else break;
    }
  }

  const qualifier: string[] = [];
  while (
    j >= 1 &&
    defaultTokens[j].type === TrinoSqlParser.DOT &&
    ID_TYPES.has(defaultTokens[j - 1].type)
  ) {
    qualifier.unshift(identifierText(defaultTokens[j - 1]));
    j -= 2;
  }

  return { partialWord, qualifier };
}

/** Walk the parse tree collecting `aliasedRelation` table aliases. */
function collectAliases(node: unknown, out: AliasInfo[]): void {
  if (!node || typeof node !== "object") return;

  if (node instanceof AliasedRelationContext) {
    const table = node.relationPrimary()?.tableRef()?.qualifiedName()?.getText();
    if (table) {
      const aliasId = node.identifier();
      const alias = aliasId ? aliasId.getText() : table.split(".").pop()!;
      out.push({ alias: stripQuotes(alias), table });
    }
  }

  const children = (node as { children?: unknown[] }).children;
  if (Array.isArray(children)) {
    for (const child of children) collectAliases(child, out);
  }
}

function stripQuotes(s: string): string {
  return s.startsWith('"') && s.endsWith('"')
    ? s.slice(1, -1).replace(/""/g, '"')
    : s;
}

// Token types that should never be offered as suggestions by c3 (everything
// that is not a keyword: identifiers, literals, punctuation, operators).
const IGNORED_TOKENS = new Set<number>([Token.EOF]);
for (let t = TrinoSqlParser.LPAREN; t <= TrinoSqlParser.WS; t++) {
  IGNORED_TOKENS.add(t);
}

const PREFERRED_RULES = new Set<number>([
  TrinoSqlParser.RULE_tableRef,
  TrinoSqlParser.RULE_columnRef,
  TrinoSqlParser.RULE_functionName,
]);

export function getCaretContext(
  text: string,
  position: { line: number; column: number },
): CaretContext {
  const { parser, tokenStream, tree } = parse(text);
  const tokens = tokenStream.getTokens();
  const defaultTokens = tokens.filter(
    (t) => t.channel === 0 && t.type !== Token.EOF,
  );

  const caretOffset = offsetAt(text, position.line, position.column);
  const tokenIndex = caretTokenIndex(tokens, caretOffset);

  const core = new CodeCompletionCore(parser);
  core.preferredRules = PREFERRED_RULES;
  core.ignoredTokens = IGNORED_TOKENS;

  const candidates = core.collectCandidates(tokenIndex);

  const keywords: string[] = [];
  for (const type of candidates.tokens.keys()) {
    const literal = TrinoSqlParser.literalNames[type];
    if (literal) keywords.push(literal.slice(1, -1)); // strip surrounding quotes
  }

  const expectTable = candidates.rules.has(TrinoSqlParser.RULE_tableRef);
  const expectColumn = candidates.rules.has(TrinoSqlParser.RULE_columnRef);
  const expectFunction = candidates.rules.has(TrinoSqlParser.RULE_functionName);

  const { partialWord, qualifier } = analyzePrefix(defaultTokens, caretOffset);

  const aliases: AliasInfo[] = [];
  collectAliases(tree, aliases);

  return {
    keywords: keywords.sort(),
    expectTable,
    expectColumn,
    expectFunction,
    qualifier,
    partialWord,
    aliases,
  };
}

export function validateGrammar(text: string): GrammarError[] {
  if (!text.trim()) return [];
  return parse(text).errors;
}
