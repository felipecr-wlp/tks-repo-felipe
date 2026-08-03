/**
 * Tabla de verdad del flujo de SOLICITUDES.
 *
 * `evaluarAccion` es pura: no toca red ni base. Eso permite afirmar cosas sobre
 * el sistema COMPLETO (todas las acciones por todos los estados por todos los
 * actores) en milisegundos, que es la unica forma de que una regla nueva no
 * rompa una vieja sin que nadie se entere.
 *
 * Lo que se prueba aqui no son casos sueltos, son INVARIANTES. Un caso suelto
 * ("el admin puede canalizar") se vuelve verde el dia que se rompe todo lo
 * demas; un invariante ("nadie sin mando canaliza, desde ningun estado") no.
 */
import { describe, it, expect } from 'vitest'
import {
  TRANSICIONES,
  evaluarAccion,
  estaCerrada,
  ESTADOS_CERRADOS,
  type AccionSolicitud,
  type EstadoSolicitud,
} from '../src/lib/tickets/flujo-solicitud'
import { ESTADOS, COLUMNAS, PESO_PRIORIDAD, PRIORIDADES } from '../src/lib/tickets/catalogo'

const ESTADOS_TODOS: EstadoSolicitud[] = [
  'solicitado', 'canalizado', 'en_proceso', 'resuelto', 'rechazado', 'cancelado',
]
const ACCIONES = Object.keys(TRANSICIONES) as AccionSolicitud[]

/** Actor con todo apagado, para encender solo lo que cada prueba afirma. */
const NADIE = {
  esSolicitante: false,
  esResponsable: false,
  esAdmin: false,
  tieneNota: true,
  tieneDestino: true,
}

describe('Flujo de solicitudes: la tabla es coherente consigo misma', () => {
  it('toda transicion apunta a un estado que existe', () => {
    for (const [accion, regla] of Object.entries(TRANSICIONES)) {
      if (regla.hacia !== null) {
        expect(ESTADOS_TODOS, `${accion} lleva a un estado inexistente`).toContain(regla.hacia)
      }
      for (const desde of regla.desde) {
        expect(ESTADOS_TODOS, `${accion} sale de un estado inexistente`).toContain(desde)
      }
    }
  })

  it('todo estado del catalogo tiene una accion que lleva a el, o es el inicial', () => {
    const alcanzables = new Set<string>(['solicitado'])
    for (const regla of Object.values(TRANSICIONES)) {
      if (regla.hacia) alcanzables.add(regla.hacia)
    }
    // Un estado que ninguna accion produce es una columna del tablero que jamas
    // se llena: el usuario ve un carril vacio para siempre sin saber por que.
    for (const e of ESTADOS_TODOS) {
      expect(alcanzables, `nada lleva al estado "${e}"`).toContain(e)
    }
  })

  it('todo estado tiene salida, salvo que sea de los cerrados', () => {
    for (const e of ESTADOS_TODOS) {
      const tieneSalida = Object.values(TRANSICIONES).some((r) => r.desde.includes(e))
      expect(tieneSalida, `del estado "${e}" no se sale nunca`).toBe(true)
    }
    // Y de los cerrados se sale SOLO por reabrir o canalizar de nuevo, nunca por
    // arrancar o resolver: retomar algo cerrado exige volver a decidirlo.
    for (const e of ESTADOS_CERRADOS) {
      const salidas = ACCIONES.filter((a) => TRANSICIONES[a].desde.includes(e))
      for (const a of salidas) {
        expect(['reabrir', 'canalizar'], `"${a}" sale de "${e}" y no debería`).toContain(a)
      }
    }
  })

  it('el catalogo de estados cubre exactamente los del flujo', () => {
    expect(ESTADOS.map((e) => e.key).sort()).toEqual([...ESTADOS_TODOS].sort())
    // Los cerrados no son columnas del tablero abierto salvo 'resuelto', que si
    // se muestra: esconder lo terminado hace que nadie vea que si se avanza.
    expect(COLUMNAS.map((c) => c.key)).toEqual(['solicitado', 'canalizado', 'en_proceso', 'resuelto'])
    expect(ESTADOS_CERRADOS.every(estaCerrada)).toBe(true)
    expect(estaCerrada('solicitado')).toBe(false)
  })

  it('cada prioridad del catalogo tiene peso de orden', () => {
    for (const p of PRIORIDADES) {
      expect(PESO_PRIORIDAD[p.key], `falta el peso de "${p.key}"`).toBeTypeOf('number')
    }
  })
})

describe('Flujo de solicitudes: quien puede que', () => {
  it('sin ningun rol no se puede NINGUNA accion, desde NINGUN estado', () => {
    for (const accion of ACCIONES) {
      for (const estado of ESTADOS_TODOS) {
        const v = evaluarAccion({ ...NADIE, accion, estadoActual: estado })
        expect(v.ok, `un desconocido pudo "${accion}" desde "${estado}"`).toBe(false)
      }
    }
  })

  it('canalizar y rechazar son SOLO de mando, desde cualquier estado', () => {
    for (const accion of ['canalizar', 'rechazar'] as AccionSolicitud[]) {
      for (const estado of ESTADOS_TODOS) {
        // Ni el solicitante ni el responsable, por mas que sean los dueños del
        // asunto. Si el solicitante pudiera canalizar la suya, el filtro del
        // admin (que es el punto entero del modulo) dejaria de existir.
        for (const rol of ['esSolicitante', 'esResponsable'] as const) {
          const v = evaluarAccion({ ...NADIE, [rol]: true, accion, estadoActual: estado })
          expect(v.ok, `${rol} pudo "${accion}" desde "${estado}"`).toBe(false)
        }
      }
    }
  })

  it('el admin puede lo del responsable, pero NO lo del solicitante', () => {
    for (const accion of ACCIONES) {
      const regla = TRANSICIONES[accion]
      for (const estado of regla.desde) {
        const v = evaluarAccion({ ...NADIE, esAdmin: true, accion, estadoActual: estado })
        if (regla.quien === 'solicitante') {
          // Cancelar o reabrir lo ajeno no es destrabar, es decidir por otro si
          // su problema ya quedo resuelto.
          expect(v.ok, `el admin pudo "${accion}", que es del solicitante`).toBe(false)
        } else {
          expect(v.ok, `el admin no pudo "${accion}" desde "${estado}"`).toBe(true)
        }
      }
    }
  })
})

describe('Flujo de solicitudes: las exigencias se cumplen de verdad', () => {
  it('toda accion con exigeNota falla sin nota, con el rol correcto y el estado correcto', () => {
    for (const accion of ACCIONES) {
      const regla = TRANSICIONES[accion]
      if (!regla.exigeNota) continue
      for (const estado of regla.desde) {
        const base = {
          ...NADIE,
          tieneNota: false,
          accion,
          estadoActual: estado,
          esSolicitante: regla.quien === 'solicitante',
          esResponsable: regla.quien === 'responsable',
          esAdmin: regla.quien === 'admin',
        }
        const v = evaluarAccion(base)
        expect(v.ok, `"${accion}" paso sin nota desde "${estado}"`).toBe(false)
        // Y con nota SI pasa: si fallara igual, la prueba de arriba estaria
        // pasando por el motivo equivocado (permiso, no nota).
        expect(evaluarAccion({ ...base, tieneNota: true }).ok).toBe(true)
      }
    }
  })

  it('canalizar sin destino no procede, ni siendo admin', () => {
    for (const estado of TRANSICIONES.canalizar.desde) {
      const v = evaluarAccion({
        ...NADIE, esAdmin: true, tieneDestino: false, accion: 'canalizar', estadoActual: estado,
      })
      expect(v.ok, `se canalizo sin destino desde "${estado}"`).toBe(false)
      expect(v.ok === false && v.error).toMatch(/departamento|cargo/i)
    }
  })

  it('una accion desde un estado que no la admite devuelve 409, no 403', () => {
    // Importa la diferencia: 403 dice "no eres tu", 409 dice "no es el momento".
    // Confundirlas manda a la gente a pedir permisos que ya tiene.
    const prohibidos = ESTADOS_TODOS.filter((e) => !TRANSICIONES.arrancar.desde.includes(e))
    for (const estado of prohibidos) {
      const v = evaluarAccion({ ...NADIE, esResponsable: true, accion: 'arrancar', estadoActual: estado })
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.estado, `desde "${estado}"`).toBe(409)
    }
  })

  it('una solicitud canalizada ya NO se puede editar', () => {
    // Quien se comprometio a hacer algo se comprometio a hacer ESO. Cambiarle el
    // enunciado por debajo es como se producen entregables que no eran los
    // pedidos, y ese fallo es invisible hasta que se entrega.
    for (const estado of ESTADOS_TODOS.filter((e) => e !== 'solicitado')) {
      const v = evaluarAccion({ ...NADIE, esSolicitante: true, accion: 'editar', estadoActual: estado })
      expect(v.ok, `se edito una solicitud en "${estado}"`).toBe(false)
    }
  })

  it('una accion inexistente no se cuela por el hueco de la tabla', () => {
    const v = evaluarAccion({
      ...NADIE, esAdmin: true, accion: 'aprobarTodo' as AccionSolicitud, estadoActual: 'solicitado',
    })
    expect(v.ok).toBe(false)
  })
})
