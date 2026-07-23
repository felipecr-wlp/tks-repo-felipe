/**
 * Tripwire de FUGA DE SECRETO AL BUNDLE DEL CLIENTE via NEXT_PUBLIC_ (CWE-200 Exposure
 * of Sensitive Information / CWE-522 Insufficiently Protected Credentials).
 *
 * Footgun clasico de Next.js: CUALQUIER variable de entorno con prefijo `NEXT_PUBLIC_`
 * se INCRUSTA en el bundle de JavaScript que se sirve al navegador. No es un permiso ni
 * un runtime server: es texto plano que cualquiera lee con "ver codigo fuente". Si un
 * secreto se nombra (o se re-nombra en un refactor) `NEXT_PUBLIC_ALGO`, deja de ser
 * secreto para todo el planeta, en silencio, sin que ningun handler lo decida.
 *
 * La disciplina del repo (documentada en .env.example: "solo estos dos van con
 * NEXT_PUBLIC_") es que SOLO tres variables son publicas por diseno:
 *   - NEXT_PUBLIC_SUPABASE_URL      (URL del proyecto, publica)
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY (anon key, publica por diseno; RLS la respalda)
 *   - NEXT_PUBLIC_APP_URL           (URL base de la app, publica)
 * Todo lo demas (SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, GOOGLE_CLIENT_SECRET,
 * UPSTASH_REDIS_REST_TOKEN, ...) es server-only y JAMAS lleva el prefijo publico.
 *
 * Contrato, dos aristas:
 *   A) En `src/**`, toda referencia `NEXT_PUBLIC_<NAME>` pertenece al allowlist.
 *   B) En `.env.example`, toda variable `NEXT_PUBLIC_<NAME>` declarada pertenece al
 *      allowlist (atrapa documentar un secreto nuevo como publico).
 * Un `NEXT_PUBLIC_` fuera del allowlist cae aqui: para sumarlo hay que confirmar A MANO
 * que la variable NO carga ningun secreto y ampliar el allowlist de forma consciente.
 *
 * Determinista: solo lee fuentes, no monta el server.
 *
 * Hoy 3 variables NEXT_PUBLIC_, todas publicas por diseno. Un secreto que se cuele con
 * prefijo publico cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

// Variables publicas por diseno. Ampliar SOLO tras verificar a mano que no hay secreto.
const PUBLIC_ALLOWLIST = new Set([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_URL',
])

const PUBLIC_ENV = /NEXT_PUBLIC_[A-Z0-9_]+/g

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSource(full, out)
    else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')

describe('Invariante: ninguna variable NEXT_PUBLIC_ fuera del allowlist llega al bundle del cliente (anti CWE-200)', () => {
  const files = walkSource(SRC)

  it('el scan encuentra fuentes en src (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  // Arista A: en el codigo, toda NEXT_PUBLIC_ referenciada es del allowlist.
  it('src: ninguna referencia NEXT_PUBLIC_ esta fuera del allowlist', () => {
    const offenders: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const m of line.matchAll(PUBLIC_ENV)) {
          if (!PUBLIC_ALLOWLIST.has(m[0])) {
            offenders.push(`${rel(file)}:${i + 1} -> ${m[0]}`)
          }
        }
      })
    }
    expect(offenders.sort()).toEqual([])
  })

  // Arista B: .env.example no documenta ningun secreto como publico.
  it('.env.example: ninguna variable NEXT_PUBLIC_ esta fuera del allowlist', () => {
    const envPath = join(ROOT, '.env.example')
    expect(existsSync(envPath)).toBe(true)
    const offenders: string[] = []
    readFileSync(envPath, 'utf8').split('\n').forEach((line, i) => {
      if (line.trim().startsWith('#')) return
      for (const m of line.matchAll(PUBLIC_ENV)) {
        if (!PUBLIC_ALLOWLIST.has(m[0])) offenders.push(`.env.example:${i + 1} -> ${m[0]}`)
      }
    })
    expect(offenders.sort()).toEqual([])
  })
})
