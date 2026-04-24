"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { AppLanguage, LANGUAGE_COOKIE } from "@/lib/i18n";

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (next: AppLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// ── English-only mode ────────────────────────────────────────────────────────
// Icelandic translations are parked per V3 scope. All `pickLanguage(lang, { is, en })`
// calls see `lang === "en"` and pick the English branch. The `is` strings
// remain in source so bilingual mode can be restored without rewiring every
// call site.
// To restore bilingual: revert this file to a previous version and remove
// any `// @ts-expect-error` markers on language-toggle sites.
const FORCED_LANGUAGE: AppLanguage = "en";

export function LanguageProvider({
  children,
}: {
  children: React.ReactNode;
  initialLanguage?: AppLanguage;
}) {
  useEffect(() => {
    document.documentElement.lang = FORCED_LANGUAGE;
    document.cookie = `${LANGUAGE_COOKIE}=${FORCED_LANGUAGE}; path=/; max-age=31536000; samesite=lax`;
    const stored = window.localStorage.getItem(LANGUAGE_COOKIE);
    if (stored && stored !== FORCED_LANGUAGE) {
      window.localStorage.setItem(LANGUAGE_COOKIE, FORCED_LANGUAGE);
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language: FORCED_LANGUAGE,
      setLanguage: () => {},
    }),
    [],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
