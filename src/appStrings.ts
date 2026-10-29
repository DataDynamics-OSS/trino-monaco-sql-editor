/** Demo page (App.tsx) strings. The editor's own strings live in `trino/i18n`. */
import type { TrinoLocale } from "./trino/i18n";

export interface AppStrings {
  language: string;
  font: string;
  dark: string;
  user: string;
  password: string;
  catalog: string;
  schema: string;
  cluster: string;
  connect: string;
  disconnect: string;
  offline: string;
  connectedAs: (user: string) => string;
  shortcuts: string;
  notConnected: string;
  running: string;
  rows: (n: number, id: string) => string;
  error: (message: string) => string;
}

const en: AppStrings = {
  language: "Language",
  font: "Font",
  dark: "Dark",
  user: "user",
  password: "password",
  catalog: "catalog",
  schema: "schema",
  cluster: "Cluster",
  connect: "Connect",
  disconnect: "Disconnect",
  offline: "offline (sample metadata)",
  connectedAs: (u) => `connected as ${u}`,
  shortcuts: "Ctrl/Cmd+Enter = Run · Shift+F1 / Ctrl+Click = Help",
  notConnected: "Not connected — connect to run queries.",
  running: "running…",
  rows: (n, id) => `${n} row(s) · query ${id}`,
  error: (m) => `error: ${m}`,
};

const ko: AppStrings = {
  language: "언어",
  font: "글꼴",
  dark: "다크",
  user: "사용자",
  password: "비밀번호",
  catalog: "카탈로그",
  schema: "스키마",
  cluster: "클러스터",
  connect: "연결",
  disconnect: "연결 해제",
  offline: "오프라인 (샘플 메타데이터)",
  connectedAs: (u) => `${u}(으)로 연결됨`,
  shortcuts: "Ctrl/Cmd+Enter = 실행 · Shift+F1 / Ctrl+클릭 = 도움말",
  notConnected: "연결되지 않았습니다 — 쿼리를 실행하려면 연결하세요.",
  running: "실행 중…",
  rows: (n, id) => `${n}개 행 · 쿼리 ${id}`,
  error: (m) => `오류: ${m}`,
};

const ja: AppStrings = {
  language: "言語",
  font: "フォント",
  dark: "ダーク",
  user: "ユーザー",
  password: "パスワード",
  catalog: "カタログ",
  schema: "スキーマ",
  cluster: "クラスター",
  connect: "接続",
  disconnect: "切断",
  offline: "オフライン (サンプルメタデータ)",
  connectedAs: (u) => `${u} として接続中`,
  shortcuts: "Ctrl/Cmd+Enter = 実行 · Shift+F1 / Ctrl+クリック = ヘルプ",
  notConnected: "未接続です — クエリを実行するには接続してください。",
  running: "実行中…",
  rows: (n, id) => `${n} 行 · クエリ ${id}`,
  error: (m) => `エラー: ${m}`,
};

const zh: AppStrings = {
  language: "语言",
  font: "字体",
  dark: "深色",
  user: "用户",
  password: "密码",
  catalog: "目录",
  schema: "模式",
  cluster: "集群",
  connect: "连接",
  disconnect: "断开连接",
  offline: "离线（示例元数据）",
  connectedAs: (u) => `已作为 ${u} 连接`,
  shortcuts: "Ctrl/Cmd+Enter = 运行 · Shift+F1 / Ctrl+单击 = 帮助",
  notConnected: "未连接 — 请先连接再运行查询。",
  running: "运行中…",
  rows: (n, id) => `${n} 行 · 查询 ${id}`,
  error: (m) => `错误：${m}`,
};

export const APP_STRINGS: Record<TrinoLocale, AppStrings> = { en, ko, ja, zh };

/** Saved language, else the browser language when supported, else English. */
export function initialLocale(): TrinoLocale {
  try {
    const saved = localStorage.getItem("trino-monaco-locale");
    if (saved && saved in APP_STRINGS) return saved as TrinoLocale;
  } catch {
    /* storage unavailable */
  }
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2);
  return lang in APP_STRINGS ? (lang as TrinoLocale) : "en";
}

export function saveLocale(locale: TrinoLocale): void {
  try {
    localStorage.setItem("trino-monaco-locale", locale);
  } catch {
    /* storage unavailable */
  }
}

/** Saved editor font id, else the default (D2Coding Ligature). */
export function initialFont(fallback: string): string {
  try {
    return localStorage.getItem("trino-monaco-font") ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveFont(id: string): void {
  try {
    localStorage.setItem("trino-monaco-font", id);
  } catch {
    /* storage unavailable */
  }
}
