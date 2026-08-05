/**
 * Tripwire del CANDADO de la pizarra (`localDirtyRef`).
 *
 * La pizarra tiene dos flujos que se pisan: lo que dibuja el usuario y lo que
 * llega por realtime cuando otro guarda. Para que lo remoto no borre un trazo a
 * medio hacer, `onChange` levanta un candado (`localDirtyRef.current = true`) y
 * el handler de realtime se abstiene mientras este puesto:
 *
 *     if (localDirtyRef.current) return   // anti-clobber
 *
 * El candado lo suelta el guardado con debounce, 1.5s despues. Y ahi esta el
 * peligro: ese guardado tiene ahora una SALIDA TEMPRANA (si lo serializado es
 * identico a lo ultimo conocido no se escribe nada, para no despertar por
 * realtime a todos cada vez que alguien solo hace zoom o selecciona). Si el
 * `= false` quedara DESPUES de ese `return`, el candado nunca se soltaria en el
 * caso mas comun de todos, y la pizarra dejaria de aceptar los cambios de los
 * demas PARA SIEMPRE.
 *
 * Y lo haria en silencio: sin error, sin toast, sin nada en consola. Cada quien
 * veria su propia pizarra actualizada y creeria que los otros no estan
 * trabajando. Es exactamente la clase de fallo que no se descubre hasta que
 * alguien pierde una hora de dibujo.
 *
 * No se puede probar ejecutando: es una clausura dentro de un componente de
 * React que necesita Excalidraw montado (~1MB, sin SSR). Lo que SI se puede
 * comprobar, y es lo unico que hace falta, es el ORDEN de las dos lineas.
 *
 * Alcance honesto: esto verifica la posicion relativa de un `= false` y un
 * `return` dentro del setTimeout del guardado. No prueba que el anti-clobber
 * funcione; prueba que no se rompa por la reordenacion concreta que este cambio
 * volvio posible.
 *
 * Determinista: solo lee la fuente.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDITOR = join(
  process.cwd(),
  'src', 'app', '(app)', 'w', '[workspaceSlug]', 'whiteboards', '[whiteboardId]',
  'WhiteboardEditor.tsx'
)

const src = readFileSync(EDITOR, 'utf8')

/** El cuerpo del guardado con debounce: del setTimeout hasta su cierre `}, 1500)`. */
function cuerpoDelGuardado(): string {
  const desde = src.indexOf('contentSaveTimer.current = setTimeout(')
  const hasta = src.indexOf('}, 1500)', desde)
  return desde === -1 || hasta === -1 ? '' : src.slice(desde, hasta)
}

describe('Invariante: el candado anti-clobber de la pizarra siempre se suelta', () => {
  const cuerpo = cuerpoDelGuardado()

  it('encuentra el guardado con debounce (el scan no esta vacio)', () => {
    // Si el debounce se renombra o cambia de forma, este test deja de vigilar
    // nada y hay que volver a apuntarlo a mano, en vez de quedarse verde.
    expect(cuerpo.length).toBeGreaterThan(0)
    expect(cuerpo).toContain('localDirtyRef.current = false')
  })

  it('el handler de realtime sigue dependiendo del candado', () => {
    // Si esto desaparece, el tripwire de abajo ya no protege nada y hay que
    // borrarlo en vez de dejarlo dando una seguridad que no existe.
    expect(src).toMatch(/if\s*\(localDirtyRef\.current\)\s*return/)
  })

  it('el candado se suelta ANTES de cualquier salida temprana del guardado', () => {
    const suelta = cuerpo.indexOf('localDirtyRef.current = false')
    // Cualquier `return` del cuerpo, no solo el que existe hoy: si manana se
    // agrega otra salida temprana por encima, este test la caza igual.
    const primerReturn = cuerpo.search(/\breturn\b/)
    expect(suelta).toBeGreaterThanOrEqual(0)
    if (primerReturn === -1) return // sin salidas tempranas no hay riesgo
    // Se comparan como texto para que el fallo diga QUE esta mal, no solo que
    // un numero es mayor que otro.
    expect(`suelta el candado antes del primer return: ${suelta < primerReturn}`).toBe(
      'suelta el candado antes del primer return: true'
    )
  })
})
