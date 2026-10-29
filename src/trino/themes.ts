import type { editor } from "monaco-editor";

export const TRINO_LIGHT_THEME = "trino-light";
export const TRINO_DARK_THEME = "trino-dark";

/**
 * Light theme. Uses Monaco's standard theme color keys with a neutral,
 * self-contained palette tuned for the Trino token types.
 */
export const trinoLightTheme: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "0033b3", fontStyle: "bold" },
    { token: "number", foreground: "1750eb" },
    { token: "operator", foreground: "5c6773" },
    { token: "operator.sql", foreground: "5c6773" },
    { token: "comment", foreground: "8c8c8c", fontStyle: "italic" },
    { token: "comment.quote", foreground: "8c8c8c", fontStyle: "italic" },
    { token: "string", foreground: "067d17" },
    { token: "predefined", foreground: "7a3e9d" },
    { token: "identifier", foreground: "1f2933" },
    { token: "identifier.quote", foreground: "067d17" },
    { token: "delimiter", foreground: "5c6773" },
  ],
  colors: {
    "editor.foreground": "#1f2933",
    "editor.background": "#ffffff",
    "editor.selectionBackground": "#cfe2ff",
    "editor.inactiveSelectionBackground": "#e6efff",
    "editor.lineHighlightBackground": "#f3f6fb",
  },
};

/**
 * Dark theme. Sets suggest-widget/menu/input surface colors (standard Monaco
 * theme color keys) so the autocomplete popup matches the editor.
 */
export const trinoDarkTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "569cd6", fontStyle: "bold" },
    { token: "number", foreground: "b5cea8" },
    { token: "operator", foreground: "c5c8c6" },
    { token: "operator.sql", foreground: "c5c8c6" },
    { token: "comment", foreground: "6a9955", fontStyle: "italic" },
    { token: "comment.quote", foreground: "6a9955", fontStyle: "italic" },
    { token: "string", foreground: "ce9178" },
    { token: "predefined", foreground: "c586c0" },
    { token: "identifier", foreground: "d4d4d4" },
    { token: "identifier.quote", foreground: "ce9178" },
    { token: "delimiter", foreground: "c5c8c6" },
  ],
  colors: {
    "editor.foreground": "#d4d4d4",
    "editor.background": "#0b1021",
    "editorCursor.foreground": "#d4d4d4",
    "editor.selectionBackground": "#264f78",
    "editor.lineHighlightBackground": "#121831",
    "editor.inactiveSelectionBackground": "#264f7855",
    "editorSuggestWidget.background": "#121831",
    "editorSuggestWidget.foreground": "#d4d4d4",
    "editorSuggestWidget.selectedBackground": "#233979",
    "editorSuggestWidget.border": "#233979",
    "menu.background": "#121831",
    "menu.foreground": "#d4d4d4",
    "menu.selectionBackground": "#233979",
    "input.background": "#121831",
    "input.border": "#233979",
    "input.foreground": "#d4d4d4",
    "list.activeSelectionBackground": "#233979",
    "list.hoverBackground": "#233979",
    "editorWidget.background": "#121831",
    "editorWidget.foreground": "#d4d4d4",
  },
};
