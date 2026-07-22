/**
 * Tripwire de AUTENTICACION DE CRON (trigger de efectos secundarios sin auth).
 *
 * Los endpoints bajo /api/cron NO llevan sesion de usuario: los invoca Vercel Cron.
 * Pero SI mutan la DB (crean notificaciones, recordatorios, avisos de revision de
 * SOP). Si uno quedara abierto, cualquiera en internet podria dispararlo en bucle:
 * spam de notificaciones a todo el equipo, carga sobre la DB, ruido operativo. La
 * unica compuerta correcta para un cron es un SECRETO COMPARTIDO, no la sesion.
 *
 * Contrato: TODO route.ts bajo /api/cron DEBE (a) leer process.env.CRON_SECRET,
 * (b) fallar CERRADO si el secreto no esta configurado (no ejecutar sin secreto),
 * y (c) exigir el header `Authorization: Bearer <CRON_SECRET>` antes de actuar. Un
 * cron sin alguna de las tres = trigger abierto.
 *
 * Deteccion estructural: se descubre TODO route.ts bajo /api/cron y se le exige el
 * patron de las tres primitivas. Un cron nuevo que omita el secreto cae aqui; no
 * hace falta registrarlo a mano.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 2 crons (due-reminders, sop-reviews); los 2 exigen el secreto y fallan
 * cerrado. Un cron nuevo debe gatear igual. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CRON = join(process.cwd(), 'src', 'app', 'api', 'cron')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

// Las tres primitivas de un cron gateado por secreto.
const READS_SECRET = /process\.env\.CRON_SECRET/
const FAILS_CLOSED = /if\s*\(\s*!secret\s*\)/          // rechaza si falta el secreto
const BEARER_CHECK = /Bearer \$\{secret\}/             // compara el header Authorization

describe('Invariante: todo endpoint de cron exige CRON_SECRET y falla cerrado', () => {
  const files = existsSync(CRON) ? walkRoutes(CRON) : []
  const gaps: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = file.replace(join(process.cwd(), 'src', 'app', 'api'), '').replace(/\\/g, '/').replace(/^\//, '')
    if (!READS_SECRET.test(src) || !FAILS_CLOSED.test(src) || !BEARER_CHECK.test(src)) {
      gaps.push('/src/app/api/' + rel)
    }
  }

  it('el scan encuentra los endpoints de cron (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(2)
  })

  it('todo cron lee CRON_SECRET, falla cerrado y exige el Bearer', () => {
    expect(gaps.sort()).toEqual([])
  })
})
