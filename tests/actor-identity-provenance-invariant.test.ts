/**
 * Tripwire de PROVENIENCIA DE LA IDENTIDAD DEL ACTOR (impersonacion / mass
 * assignment, OWASP A01 + A08).
 *
 * Cuando un handler ESCRIBE una fila, algunos campos registran QUIEN realizo la
 * accion: `created_by` (autor de la tarea/nota/sprint), `author_id` (autor del
 * comentario/mensaje), `uploaded_by` (quien subio el adjunto), `added_by` (quien
 * agrego al miembro), `granted_by` (quien otorgo el acceso). Esos campos son la
 * IDENTIDAD DEL ACTOR y deben salir SIEMPRE de la sesion (`user.id`), nunca del
 * cuerpo del request. Si un handler hiciera `author_id: body.authorId`, un usuario
 * podria FIRMAR como otro: publicar un comentario a nombre del admin, marcar una
 * nota como creada por un tercero, atribuirse un otorgamiento de acceso. Es la
 * cara de "mass assignment" que pisa un campo de confianza con input crudo.
 *
 * OJO con el gemelo legitimo: `profile_id` en una membresia/asignacion/grant es el
 * SUJETO sobre el que un admin actua (a quien agrego / a quien asigno), no el
 * actor; ese si viene del body y esta gateado por rol aparte (S55 + gates). Por eso
 * este invariante NO mira `profile_id`: solo los campos de AUTORIA del actor.
 *
 * Contrato: en TODO route.ts, cada asignacion de un campo de autoria del actor
 * (created_by / author_id / uploaded_by / added_by / granted_by) a un VALOR de
 * runtime debe salir de la IDENTIDAD DE SESION: `user.id`, la misma con optional
 * chaining (`user?.id ?? null`), o el id que el gate de rol ya derivo de la sesion
 * (`auth.userId` / `auth.user.id` / `session.user.id`). Tambien es legitimo el
 * PASSTHROUGH de una fila ya persistida en un DTO de respuesta (`row.uploaded_by`),
 * que refleja un valor guardado, no acepta input crudo. Lo que NUNCA pasa es un
 * valor tomado del cuerpo (`body.authorId`, `parsed.data.*`, `payload.*`): eso es la
 * firma de impersonacion. Se ignoran las anotaciones de TIPO (`created_by: string |
 * null` en un `type ... = {`), que no son escrituras.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB. Escaneo por linea; el
 * estilo del repo escribe cada campo del insert en su propia linea.
 *
 * Hoy toda autoria del actor sale de user.id; 0 impersonaciones. Un insert nuevo
 * que firme con input crudo cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

// Campos que registran la identidad del ACTOR (no el sujeto). profile_id queda
// fuera a proposito: es el sujeto de una accion de admin, gateado por rol aparte.
const ACTOR_FIELD = /\b(created_by|author_id|uploaded_by|added_by|granted_by):\s*([^,\n}]+)/

// Un valor es una ANOTACION DE TIPO (no una escritura de runtime) si nombra un
// tipo primitivo o es una union / generico. Esas lineas se ignoran.
function isTypeAnnotation(value: string): boolean {
  return /^(string|number|boolean|Date|null|undefined|unknown|any)\b/.test(value) ||
    value.includes('|') || value.includes('<')
}

// La identidad del actor es LEGITIMA si sale de la sesion (user.id directo o con
// optional chaining, o el id que el gate de rol ya derivo de la sesion) o si es el
// passthrough de una fila ya persistida en un DTO (row.<campo>): refleja un valor
// guardado, no acepta input crudo. Cualquier otra fuente (body.*, parsed.data.*,
// payload.*) queda como violacion = firma de impersonacion.
function isSessionDerived(value: string): boolean {
  return /^user\.id\b/.test(value) ||
    /^user\?\.id\b/.test(value) ||
    /^auth\.user(?:Id|\.id)\b/.test(value) ||
    /^session\.user\.id\b/.test(value) ||
    /^row\.\w+$/.test(value)
}

describe('Invariante: la identidad del actor en un insert siempre sale de user.id', () => {
  const files = walkRoutes(API)
  const violations: string[] = []
  let goodAssignments = 0

  for (const file of files) {
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = line.match(ACTOR_FIELD)
      if (!m) return
      const field = m[1]
      const value = m[2].trim()
      if (isTypeAnnotation(value)) return // definicion de tipo, no una escritura.
      if (isSessionDerived(value)) {
        goodAssignments++
        return
      }
      violations.push(`/src/app/api/${rel}:${i + 1} -> ${field}: ${value}`)
    })
  }

  it('el scan encuentra las asignaciones de autoria del actor (no esta vacio)', () => {
    expect(goodAssignments).toBeGreaterThanOrEqual(10)
  })

  it('ningun campo de autoria del actor se asigna desde input crudo', () => {
    expect(violations.sort()).toEqual([])
  })
})
