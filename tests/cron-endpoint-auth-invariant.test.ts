/**
 * Tripwire de AUTENTICACION DE ENDPOINTS DE MAQUINA (cron sin sesion humana,
 * OWASP A01 Broken Access Control / missing function-level authorization).
 *
 * Los endpoints bajo /api/cron los dispara Vercel Cron, no un humano: NO tienen
 * sesion ni cookie, y por eso corren con el SERVICE ROLE de Supabase, que BYPASSEA
 * RLS. Un cron abierto es una boca directa al service role: cualquiera que sepa la
 * URL puede pegarle, gatillar barridos masivos (memoria, maxDuration, spam de
 * notificaciones) y, peor, operar con privilegios de service role sin control.
 *
 * La unica barrera correcta para un cron es un SECRETO compartido: exigir
 * `Authorization: Bearer <CRON_SECRET>` y FALLAR CERRADO si la variable no existe
 * (503, no "abierto por defecto"). Vercel Cron manda ese header automaticamente
 * cuando CRON_SECRET esta configurado. (Historia: antes el secreto era opcional y
 * sin la variable el endpoint quedaba abierto operando con service role; se cerro.)
 *
 * Contrato, dos aristas:
 *   A) TODO route.ts bajo /api/cron:
 *        - referencia `process.env.CRON_SECRET`,
 *        - FALLA CERRADO si falta el secreto (`if (!secret)` -> 503),
 *        - compara el header contra `Bearer ${secret}` y rechaza (401) si no cuadra.
 *   B) ANTI-REGRESION: el conjunto de route.ts que instancian un cliente SERVICE
 *      ROLE crudo (leen `SUPABASE_SERVICE_ROLE_KEY` directo, fuera del helper
 *      createAdminClient) es EXACTAMENTE los dos cron. Una ruta nueva que levante un
 *      cliente service-role a mano rompe el test y fuerza revisar su autorizacion:
 *      si es un cron, que tenga el secreto; si no, que use el gate de rol normal.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 2 cron y ambos exigen Bearer CRON_SECRET y fallan cerrado. Un cron nuevo sin
 * secreto, o una ruta que levante service role cruda, cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const API = join(SRC, 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(SRC, '').replace(/\\/g, '/')

// Un cliente service-role crudo: lee la llave directo (fuera de createAdminClient).
const RAW_SERVICE_ROLE = /SUPABASE_SERVICE_ROLE_KEY/

// Rutas que legitimamente levantan service role crudo: son los cron (sin sesion).
const RAW_SERVICE_REGISTRY = [
  '/app/api/cron/daily-reports/route.ts',
  '/app/api/cron/due-reminders/route.ts',
  '/app/api/cron/sop-reviews/route.ts',
]

describe('Invariante: todo endpoint de cron exige Bearer CRON_SECRET y falla cerrado', () => {
  const files = walkRoutes(API)
  const cronRoutes = files.filter(f => rel(f).includes('/api/cron/'))

  it('el scan encuentra los endpoints de cron (no esta vacio)', () => {
    expect(cronRoutes.length).toBeGreaterThanOrEqual(2)
  })

  // Arista A: cada cron referencia el secreto, falla cerrado y exige el Bearer.
  it('todo cron referencia process.env.CRON_SECRET', () => {
    const gaps: string[] = []
    for (const file of cronRoutes) {
      if (!/process\.env\.CRON_SECRET/.test(readFileSync(file, 'utf8'))) gaps.push(rel(file))
    }
    expect(gaps.sort()).toEqual([])
  })

  it('todo cron falla cerrado si falta el secreto (if (!secret) -> 503)', () => {
    const gaps: string[] = []
    for (const file of cronRoutes) {
      const src = readFileSync(file, 'utf8')
      if (!/if\s*\(\s*!secret\s*\)/.test(src) || !/\b503\b/.test(src)) gaps.push(rel(file))
    }
    expect(gaps.sort()).toEqual([])
  })

  it('todo cron exige Authorization: Bearer ${secret} y rechaza con 401', () => {
    const gaps: string[] = []
    for (const file of cronRoutes) {
      const src = readFileSync(file, 'utf8')
      if (!/Bearer \$\{secret\}/.test(src) || !/\b401\b/.test(src)) gaps.push(rel(file))
    }
    expect(gaps.sort()).toEqual([])
  })

  // Arista B: nadie mas levanta un cliente service-role crudo sin pasar por aqui.
  it('el conjunto de rutas con cliente service-role crudo es exactamente los cron', () => {
    const discovered: string[] = []
    for (const file of files) {
      if (RAW_SERVICE_ROLE.test(readFileSync(file, 'utf8'))) discovered.push(rel(file))
    }
    expect(discovered.sort()).toEqual([...RAW_SERVICE_REGISTRY].sort())
  })
})
