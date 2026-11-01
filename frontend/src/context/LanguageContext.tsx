import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from '@/i18n/en';
import { uk } from '@/i18n/uk';

export type Lang = 'en' | 'uk';
export type TFunction = (key: string, params?: Record<string, string | number>) => string;

const LANG_KEY = 'ac_lang';
const dictionaries: Record<Lang, Record<string, string>> = { en, uk };

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectInitialLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'en' || stored === 'uk') return stored;
  if (navigator.language?.toLowerCase().startsWith('uk')) return 'uk';
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(LANG_KEY, next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'uk' ? 'uk' : 'en';
  }, [lang]);

  const t = useCallback<TFunction>(
    (key, params) => {
      const dict = dictionaries[lang] ?? dictionaries.en;
      let text = dict[key] ?? dictionaries.en[key] ?? key;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        }
      }
      return text;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
