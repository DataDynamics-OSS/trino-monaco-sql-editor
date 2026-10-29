/** Editor UI languages. */
export type TrinoLocale = "en" | "ko" | "ja" | "zh";

/** Translated help text, keyed by `TrinoDocEntry.id`. Missing ids fall back to English. */
export interface DocTranslation {
  /** Topic titles that contain prose (`OVER (window functions)`). */
  titles: Record<string, string>;
  summaries: Record<string, string>;
}
