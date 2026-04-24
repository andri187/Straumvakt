export type AppLanguage = "is" | "en";

export const DEFAULT_LANGUAGE: AppLanguage = "en";
export const LANGUAGE_COOKIE = "straumvakt-language";

export function isAppLanguage(
  value: string | null | undefined,
): value is AppLanguage {
  return value === "is" || value === "en";
}

export function getLocale(language: AppLanguage) {
  return language === "is" ? "is-IS" : "en-GB";
}

export function pickLanguage<T>(
  language: AppLanguage,
  values: { is: T; en: T },
): T {
  return values[language];
}
