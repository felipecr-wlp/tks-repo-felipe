/**
 * Traduccion para COMPONENTES DE SERVIDOR (Server Components y route handlers).
 *
 * El provider cliente (`LanguageProvider` + `useT`) no sirve en el servidor,
 * pero el idioma se persiste en la cookie `wlo-lang`, asi que aqui la leemos
 * con `cookies()` y devolvemos una funcion `t(key)` equivalente: idioma activo,
 * cae a espanol y por ultimo a la propia clave. Comparte el MISMO diccionario
 * (`translations`) que el cliente, para que una clave se traduzca igual en
 * ambos lados sin duplicar strings.
 *
 * Uso en una page server:
 *   const t = getServerT()
 *   <h1>{t('myTasks.title')}</h1>
 */
import { cookies } from 'next/headers'
import { translations, type Lang } from './translations'

export function getServerLang(): Lang {
  const v = cookies().get('wlo-lang')?.value
  return v === 'en' ? 'en' : 'es'
}

export function getServerT(): (key: string) => string {
  const lang = getServerLang()
  return (key: string): string => translations[lang]?.[key] ?? translations.es[key] ?? key
}
