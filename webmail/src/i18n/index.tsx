import React, { createContext, useContext, useState, useEffect } from 'react';
import en from './en.json';

type TranslationRecord = typeof en;

// AffinMail ships English-only (owner decision, 2026-11-25). The i18n
// framework is retained so additional locales can be added later by
// dropping in a new dictionary; the locale is fixed to 'en' for now.
export type Locale = 'en';

const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'affinmail_locale';

function getInitialLocale(): Locale {
  return DEFAULT_LOCALE;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: keyof TranslationRecord) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, locale);
    }
  }, [locale]);

  const t = (key: keyof TranslationRecord): string => {
    return en[key] || key;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
