/**
 * Tests del texto que ve la persona cuando un chat de IA falla.
 *
 * El fallo que originó esto no fue un silencio: fue un ROJO QUE MENTIA. El
 * 2026-08-05, con la cuota diaria del modelo agotada, el servidor respondia
 * 429 con "Se agotó la cuota diaria del modelo de IA" y la pantalla enseñaba
 * una frase fija: en BITACORA "revisa que el asistente esté configurado en el
 * servidor", en KERN "verifica que la API key de Gemini esté configurada".
 * Nada estaba mal configurado y la key estaba sana.
 *
 * Un aviso que apunta al sitio equivocado cuesta MAS que uno que no aparece:
 * manda a arreglar lo que no esta roto (rotar una credencial buena, revisar
 * variables de entorno) y de paso esconde la causa real, que se resuelve sola
 * al dia siguiente o subiendo el plan. Es el mismo pecado que persigue el
 * resto del repo, con el signo cambiado.
 *
 * La causa tecnica de que solo los chats se equivocaran: `useChat` del SDK no
 * entrega el json del servidor, ante un !ok lanza `new Error(response.text())`
 * y el cuerpo llega crudo en `error.message`. El resto del producto hace
 * `data.error ?? respaldo` sobre el json y por eso siempre dijo la verdad.
 *
 * Se prueban las dos direcciones, porque las dos hacen daño:
 *   A) Si el servidor explico el motivo, se enseña ese motivo.
 *   B) Si el cuerpo no es el json esperado, NO se vuelca crudo en pantalla.
 *      Un 504 del gateway o una pagina de error de la plataforma pintada tal
 *      cual seria basura ilegible, y podria arrastrar internals.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mensajeDeErrorIA, RESPALDO_ERROR_IA } from '@/lib/ai/mensaje-de-error'

const CUOTA = 'Se agotó la cuota diaria del modelo de IA. Vuelve a intentarlo mañana o pide que se suba el plan.'

describe('mensajeDeErrorIA', () => {
  it('A) enseña el motivo real que mando el servidor (el caso de la cuota)', () => {
    const error = new Error(JSON.stringify({ error: CUOTA }))
    expect(mensajeDeErrorIA(error)).toBe(CUOTA)
  })

  it('A) sirve igual los otros motivos redactados del endpoint', () => {
    for (const motivo of [
      'La conversación es demasiado larga',
      'Sin acceso a ese espacio de trabajo',
      'La imagen adjunta no es válida',
    ]) {
      expect(mensajeDeErrorIA(new Error(JSON.stringify({ error: motivo })))).toBe(motivo)
    }
  })

  it('B) un cuerpo que no es json cae al respaldo y no se pinta crudo', () => {
    const html = '<html><head><title>504 Gateway Timeout</title></head><body>...</body></html>'
    expect(mensajeDeErrorIA(new Error(html))).toBe(RESPALDO_ERROR_IA)
  })

  it('B) un json sin campo `error` cae al respaldo', () => {
    expect(mensajeDeErrorIA(new Error(JSON.stringify({ ok: false })))).toBe(RESPALDO_ERROR_IA)
  })

  it('B) un motivo vacio o en blanco no se enseña', () => {
    expect(mensajeDeErrorIA(new Error(JSON.stringify({ error: '   ' })))).toBe(RESPALDO_ERROR_IA)
  })

  it('B) un motivo larguisimo no se pinta: eso es un volcado, no un mensaje', () => {
    const volcado = JSON.stringify({ error: 'x'.repeat(5000) })
    expect(mensajeDeErrorIA(new Error(volcado))).toBe(RESPALDO_ERROR_IA)
  })

  it('sin error, o sin message, tampoco revienta', () => {
    expect(mensajeDeErrorIA(null)).toBe(RESPALDO_ERROR_IA)
    expect(mensajeDeErrorIA(undefined)).toBe(RESPALDO_ERROR_IA)
    expect(mensajeDeErrorIA({})).toBe(RESPALDO_ERROR_IA)
  })
})

/**
 * Tripwire: que los paneles no vuelvan a inventarse el motivo.
 *
 * El arreglo de arriba no sirve de nada si mañana alguien vuelve a escribir
 * una frase fija en el jsx. Estas dos frases son las que estaban en produccion
 * y las que mandaban al sitio equivocado; si reaparecen, esto se pone rojo.
 */
describe('Los dos chats muestran el motivo del servidor, no una frase inventada', () => {
  const PANELES = [
    join(process.cwd(), 'src', 'app', '(app)', 'w', '[workspaceSlug]', 'reportes', 'ReportAgentPanel.tsx'),
    join(process.cwd(), 'src', 'components', 'kern', 'KernAssistant.tsx'),
  ]

  it('ninguno culpa a la configuracion ni a la API key', () => {
    for (const panel of PANELES) {
      const src = readFileSync(panel, 'utf8')
      expect(src, `${panel} culpa a la configuracion del servidor`).not.toMatch(
        /esté configurado en el servidor/
      )
      expect(src, `${panel} culpa a la API key`).not.toMatch(/API key de Gemini esté configurada/)
    }
  })

  it('los dos pasan el error por el traductor comun', () => {
    for (const panel of PANELES) {
      expect(readFileSync(panel, 'utf8'), panel).toMatch(/mensajeDeErrorIA\(error\)/)
    }
  })
})
