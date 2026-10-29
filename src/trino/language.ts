/*---------------------------------------------------------------------------------------------
 *  Trino language definition for Monaco.
 *
 *  Derived from the Monaco Editor open-source SQL language definition
 *  (microsoft/monaco-editor, `src/basic-languages/sql/sql.ts`), which is
 *  licensed under the MIT License (Copyright (c) Microsoft Corporation).
 *  Adapted here for Trino SQL grammar:
 *    - quoted identifiers use double quotes only (no T-SQL `[...]` brackets,
 *      since `[]` is array subscript in Trino)
 *    - removed the SQL-Server `N'...'` string prefix
 *    - `keywords` / `operators` / `builtinFunctions` are injected at
 *      registration time from the configured language elements (see setup.ts)
 *
 *  Keyword / function lists are sourced from the Trino SQL reference
 *  documentation (https://trino.io/docs/) — see keywords.ts.
 *--------------------------------------------------------------------------------------------*/

import type { languages } from "monaco-editor";

/** Trino language id used to register with Monaco. */
export const TRINO_LANGUAGE_ID = "trino";

/**
 * Language configuration: comments, brackets, auto-closing & surrounding pairs.
 * (Trino-adapted from the Monaco SQL `conf`.)
 */
export const trinoLanguageConf: languages.LanguageConfiguration = {
  comments: {
    lineComment: "--",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

/**
 * Monarch tokenizer for Trino SQL.
 * (Trino-adapted from the Monaco SQL `language`.)
 *
 * `keywords`, `operators` and `builtinFunctions` are populated at registration
 * time from the configured language elements (see setup.ts).
 */
export const trinoLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".sql",
  ignoreCase: true,

  brackets: [
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],

  // Populated at registration time.
  keywords: [],
  operators: [],
  builtinFunctions: [],
  builtinVariables: [],
  pseudoColumns: [],

  tokenizer: {
    root: [
      { include: "@comments" },
      { include: "@whitespace" },
      { include: "@pseudoColumns" },
      { include: "@numbers" },
      { include: "@strings" },
      { include: "@complexIdentifiers" },
      { include: "@scopes" },
      [/[;,.]/, "delimiter"],
      [/[()]/, "@brackets"],
      [
        /[\w@#$]+/,
        {
          cases: {
            "@operators": "operator",
            "@builtinVariables": "predefined",
            "@builtinFunctions": "predefined",
            "@keywords": "keyword",
            "@default": "identifier",
          },
        },
      ],
      [/[<>=!%&+\-*/|~^]/, "operator"],
    ],
    whitespace: [[/\s+/, "white"]],
    comments: [
      [/--+.*/, "comment"],
      [/\/\*/, { token: "comment.quote", next: "@comment" }],
    ],
    comment: [
      [/[^*/]+/, "comment"],
      // Trino does not support nested block comments.
      [/\*\//, { token: "comment.quote", next: "@pop" }],
      [/./, "comment"],
    ],
    pseudoColumns: [
      [
        /[$][A-Za-z_][\w@#$]*/,
        {
          cases: {
            "@pseudoColumns": "predefined",
            "@default": "identifier",
          },
        },
      ],
    ],
    numbers: [
      [/0[xX][0-9a-fA-F]*/, "number"],
      [/[$][+-]*\d*(\.\d*)?/, "number"],
      [/((\d+(\.\d*)?)|(\.\d+))([eE][-+]?\d+)?/, "number"],
    ],
    strings: [[/'/, { token: "string", next: "@string" }]],
    string: [
      [/[^']+/, "string"],
      [/''/, "string"], // SQL escaped single quote
      [/'/, { token: "string", next: "@pop" }],
    ],
    complexIdentifiers: [
      // Trino uses double-quoted identifiers only.
      [/"/, { token: "identifier.quote", next: "@quotedIdentifier" }],
    ],
    quotedIdentifier: [
      [/[^"]+/, "identifier"],
      [/""/, "identifier"],
      [/"/, { token: "identifier.quote", next: "@pop" }],
    ],
    scopes: [],
  },
};
