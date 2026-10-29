/**
 * Editor UI languages: action labels, built-in help, completion details and
 * grammar-check messages in English, Korean, Japanese and Chinese (Simplified).
 *
 * SQL, syntax outlines and examples stay as written; documentation links
 * always point to the English Trino documentation. Errors returned by the
 * Trino server are not translated.
 */
import type { DocKind, TrinoDocEntry } from "../docs";
import type { DocTranslation, TrinoLocale } from "./types";
import ko from "./docs.ko";
import ja from "./docs.ja";
import zh from "./docs.zh";

export type { DocTranslation, TrinoLocale } from "./types";

/** Supported locales with their native names (for a language picker). */
export const TRINO_LOCALES: { id: TrinoLocale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ko", label: "한국어" },
  { id: "ja", label: "日本語" },
  { id: "zh", label: "中文" },
];

const DOCS: Partial<Record<TrinoLocale, DocTranslation>> = { ko, ja, zh };

export interface TrinoUiStrings {
  actions: {
    runQuery: string;
    explainQuery: string;
    prettify: string;
    showHelp: string;
  };
  docKind: Record<DocKind, string>;
  example: string;
  documentation: string;
  /** Completion item details. */
  completion: {
    function: string;
    keyword: string;
    type: string;
    alias: (table: string) => string;
  };
  /** Grammar-check messages (ANTLR) from the worker. */
  mismatched: (input: string, expected: string) => string;
  extraneous: (input: string, expected: string) => string;
  missing: (what: string, at: string) => string;
  noViable: (input: string) => string;
  invalidToken: (text: string) => string;
}

const en: TrinoUiStrings = {
  actions: {
    runQuery: "Run query",
    explainQuery: "Explain Query",
    prettify: "Prettify",
    showHelp: "Show Help",
  },
  docKind: {
    function: "function",
    aggregate: "aggregate function",
    window: "window function",
    statement: "SQL statement",
    clause: "clause",
    operator: "operator",
    expression: "expression",
    type: "data type",
  },
  example: "Example:",
  documentation: "Trino documentation ↗",
  completion: {
    function: "function",
    keyword: "keyword",
    type: "type",
    alias: (t) => `alias · ${t}`,
  },
  mismatched: (i, e) => `mismatched input ${i} expecting ${e}`,
  extraneous: (i, e) => `extraneous input ${i} expecting ${e}`,
  missing: (w, a) => `missing ${w} at ${a}`,
  noViable: (i) => `no viable alternative at input ${i}`,
  invalidToken: (t) => `token recognition error at: ${t}`,
};

const koUi: TrinoUiStrings = {
  actions: {
    runQuery: "쿼리 실행",
    explainQuery: "실행 계획 보기",
    prettify: "SQL 정렬",
    showHelp: "도움말 보기",
  },
  docKind: {
    function: "함수",
    aggregate: "집계 함수",
    window: "윈도 함수",
    statement: "SQL 문",
    clause: "절",
    operator: "연산자",
    expression: "식",
    type: "데이터 타입",
  },
  example: "예제:",
  documentation: "Trino 문서 ↗",
  completion: {
    function: "함수",
    keyword: "키워드",
    type: "타입",
    alias: (t) => `별칭 · ${t}`,
  },
  mismatched: (i, e) => `${i} 에서 구문 오류: ${e} 이(가) 필요합니다`,
  extraneous: (i, e) => `불필요한 입력 ${i}: ${e} 이(가) 필요합니다`,
  missing: (w, a) => `${a} 앞에 ${w} 이(가) 없습니다`,
  noViable: (i) => `${i} 을(를) 해석할 수 없습니다`,
  invalidToken: (t) => `잘못된 문자: ${t}`,
};

const jaUi: TrinoUiStrings = {
  actions: {
    runQuery: "クエリを実行",
    explainQuery: "実行計画を表示",
    prettify: "SQL を整形",
    showHelp: "ヘルプを表示",
  },
  docKind: {
    function: "関数",
    aggregate: "集計関数",
    window: "ウィンドウ関数",
    statement: "SQL 文",
    clause: "句",
    operator: "演算子",
    expression: "式",
    type: "データ型",
  },
  example: "例:",
  documentation: "Trino ドキュメント ↗",
  completion: {
    function: "関数",
    keyword: "キーワード",
    type: "型",
    alias: (t) => `別名 · ${t}`,
  },
  mismatched: (i, e) => `${i} で構文エラー: ${e} が必要です`,
  extraneous: (i, e) => `不要な入力 ${i}: ${e} が必要です`,
  missing: (w, a) => `${a} の前に ${w} がありません`,
  noViable: (i) => `${i} を解析できません`,
  invalidToken: (t) => `不正な文字: ${t}`,
};

const zhUi: TrinoUiStrings = {
  actions: {
    runQuery: "运行查询",
    explainQuery: "查看执行计划",
    prettify: "格式化 SQL",
    showHelp: "显示帮助",
  },
  docKind: {
    function: "函数",
    aggregate: "聚合函数",
    window: "窗口函数",
    statement: "SQL 语句",
    clause: "子句",
    operator: "运算符",
    expression: "表达式",
    type: "数据类型",
  },
  example: "示例：",
  documentation: "Trino 文档 ↗",
  completion: {
    function: "函数",
    keyword: "关键字",
    type: "类型",
    alias: (t) => `别名 · ${t}`,
  },
  mismatched: (i, e) => `${i} 处语法错误：需要 ${e}`,
  extraneous: (i, e) => `多余的输入 ${i}：需要 ${e}`,
  missing: (w, a) => `${a} 前缺少 ${w}`,
  noViable: (i) => `无法解析输入 ${i}`,
  invalidToken: (t) => `无效字符：${t}`,
};

const UI: Record<TrinoLocale, TrinoUiStrings> = { en, ko: koUi, ja: jaUi, zh: zhUi };

/** UI strings for `locale` (English when unknown). */
export function uiStrings(locale: TrinoLocale | undefined): TrinoUiStrings {
  return UI[locale ?? "en"] ?? en;
}

/** Translated summary for a help id (`fn:count`, `topic:SELECT` …), if any. */
export function docSummary(id: string, locale: TrinoLocale | undefined): string | undefined {
  return locale && locale !== "en" ? DOCS[locale]?.summaries[id] : undefined;
}

/** A help entry with title / summary in `locale` (English fallback per field). */
export function localizeDoc(entry: TrinoDocEntry, locale: TrinoLocale | undefined): TrinoDocEntry {
  const t = locale && locale !== "en" ? DOCS[locale] : undefined;
  if (!t) return entry;
  return { ...entry, title: t.titles[entry.id] ?? entry.title, summary: t.summaries[entry.id] ?? entry.summary };
}

/** Grammar-check messages produced by the worker (ANTLR, English) in `locale`. */
export function localizeMessage(message: string, locale: TrinoLocale | undefined): string {
  if (!locale || locale === "en") return message;
  const s = uiStrings(locale);
  let m: RegExpExecArray | null;
  if ((m = /^mismatched input (.*?) expecting (.*)$/s.exec(message))) return s.mismatched(m[1], m[2]);
  if ((m = /^extraneous input (.*?) expecting (.*)$/s.exec(message))) return s.extraneous(m[1], m[2]);
  if ((m = /^missing (.*?) at (.*)$/s.exec(message))) return s.missing(m[1], m[2]);
  if ((m = /^no viable alternative at input (.*)$/s.exec(message))) return s.noViable(m[1]);
  if ((m = /^token recognition error at: (.*)$/s.exec(message))) return s.invalidToken(m[1]);
  return message;
}
