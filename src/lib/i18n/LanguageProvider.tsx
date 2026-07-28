'use client'

/**
 * Provider de idioma (ES / EN) sin libreria externa.
 *
 * - Estado `lang` inicializado desde una cookie leida en el servidor
 *   (`initialLang`) para evitar parpadeo de hidratacion.
 * - `setLang` persiste en cookie (`wlo-lang`, 1 año) y en localStorage, y
 *   actualiza <html lang>. La cookie permite que futuras fases traduzcan
 *   tambien componentes de servidor.
 * - `t(key)` busca en el idioma activo, cae a espanol y por ultimo a la clave.
 */
import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { translations, type Lang } from './translations'

interface I18nContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const COOKIE = 'wlo-lang'

function persist(lang: Lang) {
  try {
    document.cookie = `${COOKIE}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    localStorage.setItem(COOKIE, lang)
  } catch {
    // Entorno sin cookies/localStorage: se ignora, queda solo en memoria.
  }
}

export function LanguageProvider({
  initialLang = 'es',
  children,
}: {
  initialLang?: Lang
  children: React.ReactNode
}) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  // Si el usuario cambio idioma en otra pestana (localStorage), reflejarlo.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COOKIE) as Lang | null
      if (stored && (stored === 'es' || stored === 'en') && stored !== lang) {
        setLangState(stored)
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    persist(l)
  }, [])

  const t = useCallback((key: string): string => {
    return translations[lang]?.[key] ?? translations.es[key] ?? key
  }, [lang])

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Fallback defensivo: si algun componente se usa fuera del provider,
    // no romper la app, solo devolver espanol.
    return {
      lang: 'es',
      setLang: () => {},
      t: (key: string) => translations.es[key] ?? key,
    }
  }
  return ctx
}

/** Azucar: hook que devuelve solo la funcion de traduccion. */
export function useT() {
  return useI18n().t
}
