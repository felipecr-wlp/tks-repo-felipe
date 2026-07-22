/**
 * Tripwire de CONTENCION DEL SERVICE_ROLE (fuga de la llave admin al browser).
 *
 * createAdminClient() usa SUPABASE_SERVICE_ROLE_KEY, que BYPASSA RLS por completo:
 * con esa llave se lee y escribe CUALQUIER fila de CUALQUIER tenant. Es la llave
 * maestra del sistema. Si alguna vez terminara en el bundle del navegador, un
 * atacante la extrae del JS y tiene la base entera. Dos formas de que se filtre:
 *   (1) un componente 'use client' que importe createAdminClient (o toque la llave),
 *       arrastrando el codigo server al bundle;
 *   (2) renombrar la variable a NEXT_PUBLIC_..._SERVICE_ROLE_..., lo que hace que
 *       Next.js la INLINE en el cliente.
 *
 * Contrato, tres aristas:
 *   A) Ningun archivo con la directiva 'use client' puede referenciar
 *      createAdminClient, SUPABASE_SERVICE_ROLE_KEY ni el literal service_role.
 *   B) La llave service_role NUNCA lleva prefijo NEXT_PUBLIC_ (eso la publicaria).
 *   C) createAdminClient debe estar definido en un modulo server-only (server.ts
 *      importa next/headers, que rompe el build si se incluye en el cliente).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 0 componentes cliente tocan la llave, 0 usos con prefijo publico, y la
 * definicion vive tras la barrera next/headers. Una regresion catastrofica cae aqui.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSrc(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const TOUCHES_ADMIN = /createAdminClient|SUPABASE_SERVICE_ROLE_KEY|\bservice_role\b/
const PUBLIC_SERVICE_ROLE = /NEXT_PUBLIC[A-Z_]*SERVICE_ROLE/i

describe('Invariante: la llave service_role nunca puede alcanzar el bundle del cliente', () => {
  const files = walkSrc(SRC)
  const clientLeaks: string[] = []
  const publicKeyLeaks: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    // 'use client' es una directiva al tope del archivo.
    const isClient = /^\s*(['"])use client\1/.test(src.replace(/^﻿/, ''))
    if (isClient && TOUCHES_ADMIN.test(src)) clientLeaks.push(rel)
    if (PUBLIC_SERVICE_ROLE.test(src)) publicKeyLeaks.push(rel)
  }

  it('el scan recorre el arbol de fuentes (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(200)
  })

  it('ningun componente cliente referencia el admin client ni la llave service_role', () => {
    expect(clientLeaks.sort()).toEqual([])
  })

  it('la llave service_role nunca lleva prefijo NEXT_PUBLIC_ (no se publica al cliente)', () => {
    expect(publicKeyLeaks.sort()).toEqual([])
  })

  it('createAdminClient vive tras la barrera server-only (next/headers en server.ts)', () => {
    const server = readFileSync(join(SRC, 'lib', 'supabase', 'server.ts'), 'utf8')
    expect(server).toMatch(/from 'next\/headers'/)
    expect(server).toMatch(/createAdminClient/)
  })
})
