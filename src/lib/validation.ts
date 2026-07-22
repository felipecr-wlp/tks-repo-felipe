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
 * Guarda de parametro UUID. Si el valor no es un UUID valido, devuelve una
 * respuesta 422 lista para retornar desde el handler. Si es valido, devuelve null.
 */
export function invalidUuidResponse(value: string): NextResponse | null {
  if (isUuid(value)) return null
  return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
}
