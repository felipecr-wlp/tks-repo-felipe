/**
 * Tripwire: el catalogo de scopes no puede mentir sobre lo que existe.
 *
 * El catalogo corrio meses por delante de la implementacion sin decirlo.
 * `emailer:enroll_contact` estuvo ahi desde el principio sin una sola linea
 * detras, y quien construia una herramienta lo marcaba, pasaba la revision, se
 * instalaba con el permiso concedido, llamaba a la API y recibia un error sin
 * forma de saber que el problema no era suyo. El campo `estado` arregla eso;
 * este test evita que se vuelva a desincronizar en silencio, que es como se
 * desincronizan las cosas.
 *
 * Contrato, en las dos direcciones porque las dos fallan distinto:
 *
 *   - Marcar `disponible` algo que no tiene accion es la mentira original:
 *     manda a alguien a construir contra el vacio.
 *   - Dejar en `reservado` algo que YA se implemento es la mentira contraria y
 *     la que mas probable ocurra: alguien agrega la accion, se le olvida el
 *     catalogo, y el permiso queda escondido detras de un candado que ya no
 *     corresponde. Nadie lo reporta porque no se ve.
 *
 * Solo se cruzan los scopes de la app 'wlo': son los unicos que este repo sirve.
 * Los de WLI y WLM viven en registros que todavia no existen, y por eso ninguno
 * puede estar disponible aqui.
 */
import { describe, it, expect } from 'vitest'
import { SCOPE_CATALOG, SCOPES_DISPONIBLES } from '@/lib/connectors/scopes'
import { WLO_ACTIONS } from '@/lib/connectors/actions'

/** Scopes que alguna accion implementada exige de verdad. `ping` no exige ninguno. */
const SCOPES_CON_ACCION = new Set(
  Object.values(WLO_ACTIONS)
    .map((a) => a.scope)
    .filter((s): s is string => s !== null),
)

describe('El catalogo de scopes dice la verdad sobre lo que existe', () => {
  it('todo scope de WLO marcado disponible tiene una accion detras', () => {
    const mentirosos = SCOPE_CATALOG
      .filter((s) => s.app === 'wlo' && s.estado === 'disponible')
      .filter((s) => !SCOPES_CON_ACCION.has(s.scope))
      .map((s) => s.scope)

    expect(
      mentirosos,
      `marcados disponibles sin accion en WLO_ACTIONS: ${mentirosos.join(', ')}`,
    ).toEqual([])
  })

  it('toda accion implementada esta marcada disponible en el catalogo', () => {
    // La direccion que se olvida: se agrega la accion y el catalogo se queda
    // atras, dejando el permiso escondido sin que nadie lo note.
    const escondidos = [...SCOPES_CON_ACCION].filter((scope) => {
      const def = SCOPE_CATALOG.find((s) => s.scope === scope)
      return !def || def.estado !== 'disponible'
    })

    expect(
      escondidos,
      `implementados pero no marcados disponibles: ${escondidos.join(', ')}`,
    ).toEqual([])
  })

  it('ningun scope de WLI o WLM puede estar disponible: sus registros no existen', () => {
    const ajenos = SCOPE_CATALOG
      .filter((s) => s.app !== 'wlo' && s.estado === 'disponible')
      .map((s) => s.scope)

    expect(ajenos).toEqual([])
  })

  it('SCOPES_DISPONIBLES coincide con lo marcado en el catalogo', () => {
    const esperado = SCOPE_CATALOG.filter((s) => s.estado === 'disponible').map((s) => s.scope)
    expect(SCOPES_DISPONIBLES).toEqual(esperado)
  })

  it('hay al menos un scope disponible', () => {
    // Recuento defensivo: si el cruce se rompe y todo queda reservado, el
    // formulario se quedaria sin nada que ofrecer y los tests de arriba pasarian
    // igual, porque una lista vacia cumple cualquier "no debe contener".
    expect(SCOPES_DISPONIBLES.length).toBeGreaterThan(0)
  })

  it('todo scope declara un estado valido', () => {
    for (const s of SCOPE_CATALOG) {
      expect(['disponible', 'reservado'], `${s.scope}`).toContain(s.estado)
    }
  })
})
