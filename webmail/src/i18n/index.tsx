import React, { createContext, useContext, useState, useEffect } from 'react';
import en from './en.json';
import bn from './bn.json';

type TranslationRecord = typeof en;

export type Locale = 'en' | 'bn';

const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'affinmail_locale';

function getInitialLocale(): Locale {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored) return stored;
    const nav = navigator.language as Locale | undefined;
    if (nav === 'bn' || nav.startsWith('bn')) return 'bn';
  }
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
    const dictionary: TranslationRecord = locale === 'bn' ? bn : en;
    return dictionary[key] || key;
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