/**
 * Test 1 (ancla, sin mocks): la guarda de UUID compartida.
 * Cubre isUuid e invalidUuidResponse, base de las guardas 422 de las rutas.
 */
import { describe, it, expect } from 'vitest'
import { isUuid, invalidUuidResponse, safeInternalPath } from '@/lib/validation'

const VALID_UUID = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

describe('isUuid', () => {
  it('devuelve true para un UUID valido', () => {
    expect(isUuid(VALID_UUID)).toBe(true)
  })

  it('devuelve false para basura', () => {
    expect(isUuid('not-a-uuid')).toBe(false)
  })

  it('devuelve false para string vacio', () => {
    expect(isUuid('')).toBe(false)
  })

  it('devuelve false para un slug', () => {
    expect(isUuid('mi-proyecto-2026')).toBe(false)
  })
})

describe('invalidUuidResponse', () => {
  it('devuelve null cuando el UUID es valido', () => {
    expect(invalidUuidResponse(VALID_UUID)).toBeNull()
  })

  it('devuelve 422 con { error: "ID inválido" } para entrada invalida', async () => {
    const res = invalidUuidResponse('garbage')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(422)
    const json = await res!.json()
    expect(json).toEqual({ error: 'ID inválido' })
  })
})

describe('safeInternalPath (anti open-redirect)', () => {
  it('acepta una ruta interna simple', () => {
    expect(safeInternalPath('/w/miespacio/tareas')).toBe('/w/miespacio/tareas')
  })

  it('acepta la raiz', () => {
    expect(safeInternalPath('/')).toBe('/')
  })

  it('rechaza una URL absoluta http/https', () => {
    expect(safeInternalPath('https://evil.com')).toBe('/')
  })

  it('rechaza protocol-relative //host', () => {
    expect(safeInternalPath('//evil.com')).toBe('/')
  })

  it('rechaza el backslash-trick /\\host', () => {
    expect(safeInternalPath('/\\evil.com')).toBe('/')
  })

  it('rechaza esquemas no http (mailto, javascript)', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe('/')
    expect(safeInternalPath('mailto:a@b.com')).toBe('/')
  })

  it('cae al fallback con null, undefined o vacio', () => {
    expect(safeInternalPath(null)).toBe('/')
    expect(safeInternalPath(undefined)).toBe('/')
    expect(safeInternalPath('')).toBe('/')
  })

  it('respeta un fallback personalizado', () => {
    expect(safeInternalPath('https://evil.com', '/lobby')).toBe('/lobby')
  })
})
