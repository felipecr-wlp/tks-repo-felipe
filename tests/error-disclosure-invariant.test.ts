/**
 * Tripwire de DIVULGACION DE ERRORES (verbose error / information disclosure,
 * CWE-209).
 *
 * Un handler que devuelve al cliente el mensaje CRUDO de una excepcion o del error
 * de la DB (`{ error: err.message }`, `{ details: dbError }`, `String(e)`) filtra
 * internals: nombres de tabla/columna, SQLSTATE, rutas del server, fragmentos de
 * stack. Es reconocimiento gratis para un atacante y a veces fuga directa de datos.
 * La postura correcta, que HOY cumple toda la superficie, es: los 5xx devuelven un
 * string ESTATICO en espanol y el error real solo va a console.error (server-side);
 * el unico detalle estructurado que sale al cliente es el de validacion de zod
 * (`parsed.error.flatten()`), que solo describe los campos que el propio cliente
 * mando, no internals del server.
 *
 * Contrato, dos aristas:
 *   A) El UNICO `details:` que una respuesta JSON puede devolver es
 *      `parsed.error.flatten()` (el error de forma de zod). Cualquier otro
 *      `details:` (un error de DB, un mensaje de excepcion) = fuga.
 *
 *      Con DOS excepciones declaradas abajo, y la razon de que existan importa:
 *      el reporte diario tiene una COLUMNA de dominio que se llama `details` (el
 *      detalle largo de una actividad). Desde que existe, "`details` siempre es
 *      el error de zod" dejo de ser cierto y el token por si solo ya no prueba
 *      nada. Se prefiere una excepcion con nombre y motivo antes que aflojar la
 *      regla para todos: si mañana alguien escribe `details: err.message`, en
 *      ese archivo o en cualquier otro, sigue cayendo aqui.
 *   B) Ninguna respuesta `NextResponse.json(...)` puede incluir un `.message` (el
 *      mensaje de una excepcion o de un error de Supabase). Los mensajes crudos
 *      pertenecen a console.error, nunca al body.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB. Escanea por linea; el estilo
 * del repo es responder JSON en una sola linea, asi que el match por linea es fiel.
 *
 * Hoy ~48 respuestas usan `details: parsed.error.flatten()` (validacion) y 0
 * respuestas filtran un `.message`. Un handler nuevo que devuelva un error crudo cae
 * aqui. Nunca un silencio.
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

/**
 * Las dos formas en que `details` aparece SIN ser un error, ambas del reporte
 * diario. Se listan por su expresion exacta y no por archivo: un allowlist por
 * ruta dejaria pasar cualquier `details:` futuro dentro de ese mismo archivo,
 * que es justo lo que este tripwire existe para atrapar.
 *
 *  1. La declaracion del campo en el esquema (`details: z.string()...`) y la
 *     anotacion de tipo de la fila que se lee (`details: string | null`). Ambas
 *     describen la FORMA del dato, no son una respuesta y no pueden filtrar
 *     nada. `string\b` no cuela un `details: stringify(err)`: ahi no hay limite
 *     de palabra despues de "string".
 *  2. La respuesta del PATCH de una actividad, que devuelve el detalle YA
 *     saneado para que la pantalla pinte exactamente lo que quedo guardado.
 *     `patch.details` sale del saneador, nunca de un catch.
 */
function ES_CAMPO_DE_DOMINIO(line: string): boolean {
  return (
    /\bdetails\??:\s*z\./.test(line) ||
    /\bdetails\??:\s*string\b/.test(line) ||
    /\bdetails\??:\s*patch\.details\b/.test(line)
  )
}

describe('Invariante: ningun handler filtra el mensaje crudo de un error en la respuesta', () => {
  const detailsLeaks: string[] = []
  const messageLeaks: string[] = []
  let detailsOk = 0

  for (const file of walkRoutes(API)) {
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Arista A: todo `details:` debe ser el flatten de zod.
      if (/\bdetails:/.test(line)) {
        if (/parsed\.error\.flatten\(\)/.test(line)) detailsOk++
        else if (!ES_CAMPO_DE_DOMINIO(line)) detailsLeaks.push(`/src/app/api/${rel}:${i + 1}`)
      }
      // Arista B: ninguna respuesta JSON incluye un `.message`.
      if (/NextResponse\.json\(/.test(line) && /\.message\b/.test(line)) {
        messageLeaks.push(`/src/app/api/${rel}:${i + 1}`)
      }
    })
  }

  it('el scan encuentra las respuestas de validacion (no esta vacio)', () => {
    expect(detailsOk).toBeGreaterThanOrEqual(30)
  })

  it('todo `details:` devuelto es el flatten de zod, nunca un error crudo', () => {
    expect(detailsLeaks.sort()).toEqual([])
  })

  it('ninguna respuesta JSON filtra un `.message` de excepcion o de error de DB', () => {
    expect(messageLeaks.sort()).toEqual([])
  })
})
