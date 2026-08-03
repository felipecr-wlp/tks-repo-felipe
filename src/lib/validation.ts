/**
 * Validacion compartida para handlers de API.
 * Valida parametros de ruta dinamica (UUID) antes de tocar la base de datos,
 * para devolver 422 en vez de dejar que Postgres arroje el error 22P02.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

const uuidSchema = z.string().uuid()

/** Devuelve true si el valor es un UUID valido. */
export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success
}

/**
 * Identificador de una herramienta del marketplace.
 *
 * No es uuid a proposito: se escribe en URLs que ve la gente (`/w/<ws>/apps/wli`)
 * y lo elige quien propone la herramienta, asi que tiene que ser legible. Eso no
 * lo exime de tener forma: sin guarda, `params.appId` seria texto libre que va
 * derecho a un `.eq('id', ...)`. Minusculas, numeros y guion, entre 2 y 39.
 */
export const RE_APP_ID = /^[a-z0-9][a-z0-9-]{1,38}$/

/** Devuelve true si el valor tiene forma de id de herramienta del marketplace. */
export function isAppId(value: string): boolean {
  return RE_APP_ID.test(value)
}

/**
 * Guarda de parametro UUID. Si el valor no es un UUID valido, devuelve una
 * respuesta 422 lista para retornar desde el handler. Si es valido, devuelve null.
 */
export function invalidUuidResponse(value: string): NextResponse | null {
  if (isUuid(value)) return null
  return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
}

/**
 * Anti open-redirect. Solo se permite volver a rutas INTERNAS del mismo origen,
 * asi que un destino controlado por el usuario (?redirectTo, ?next, cookie de
 * OAuth) que no sea una ruta relativa segura cae al fallback ('/').
 *
 * Se rechaza:
 *  - null/undefined/vacio
 *  - todo lo que no empiece con '/' (URLs absolutas: https://evil.com, mailto:, etc.)
 *  - '//host' (protocol-relative, el navegador lo resuelve como https://host)
 *  - '/\\host' (backslash-trick: algunos navegadores lo tratan como '//host')
 *
 * Es el mismo criterio que aplican el login, el callback OAuth y google/connect;
 * centralizarlo evita que una copia se quede sin la guarda en un refactor.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.startsWith('/\\')) return fallback
  return value
}
