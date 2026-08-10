/**
 * Quien ve que en la Academia.
 *
 * Esto es una barrera de acceso, asi que los casos que importan no son los
 * felices: son los que dejarian ver a quien no debe (una fuga) o esconderian
 * contenido a quien si debe (una capacitacion que nadie encuentra). Los dos
 * fallan en silencio en produccion, por eso viven aqui.
 */
import { describe, it, expect } from 'vitest'
import {
  puedeVer, filtrarVisibles, claveDePerfil, describirAudiencia,
  type ConAudiencia, type Espectador,
} from '@/lib/academy/visibilidad'

const contenido = (x: Partial<ConAudiencia> = {}): ConAudiencia => ({
  audience: 'todos', audience_profiles: [], status: 'live', ...x,
})

const persona = (x: Partial<Espectador> = {}): Espectador => ({
  perfiles: [], nombradaEn: new Set(), esAdmin: false, ...x,
})

describe('Visibilidad: no dejar ver a quien no debe', () => {
  it('por perfiles, quien no tiene el perfil NO ve', () => {
    const c = contenido({ audience: 'perfiles', audience_profiles: ['concreto'] })
    expect(puedeVer(c, 'v1', persona({ perfiles: ['asfalto'] }))).toBe(false)
  })

  it('por personas, quien no fue nombrado NO ve', () => {
    const c = contenido({ audience: 'personas' })
    expect(puedeVer(c, 'v1', persona({ nombradaEn: new Set(['otro-video']) }))).toBe(false)
  })

  it('un borrador no se ve, aunque la audiencia sea "todos"', () => {
    expect(puedeVer(contenido({ status: 'draft' }), 'v1', persona())).toBe(false)
  })

  it('"por perfiles" SIN perfiles marcados no lo ve nadie', () => {
    // Elegir "por perfiles" y no marcar ninguno es configuracion a medias.
    // Si esto valiera "todos", un descuido se convertiria en una fuga.
    const c = contenido({ audience: 'perfiles', audience_profiles: [] })
    expect(puedeVer(c, 'v1', persona({ perfiles: ['foreman'] }))).toBe(false)
  })

  it('una audiencia desconocida se niega, no se permite', () => {
    // Falla CERRADO: si mañana se agrega un modo y falta el caso, lo peor que
    // pasa es que no se vea, no que lo vea todo el mundo.
    const c = { audience: 'inventada', audience_profiles: [], status: 'live' } as unknown as ConAudiencia
    expect(puedeVer(c, 'v1', persona({ perfiles: ['foreman'] }))).toBe(false)
  })
})

describe('Visibilidad: no esconder a quien sí debe ver', () => {
  it('por perfiles, con el perfil correcto SÍ ve', () => {
    const c = contenido({ audience: 'perfiles', audience_profiles: ['concreto', 'foreman'] })
    expect(puedeVer(c, 'v1', persona({ perfiles: ['foreman'] }))).toBe(true)
  })

  it('el perfil compara sin acentos ni mayúsculas', () => {
    // "Compactación" escrito por el admin y "compactacion" tecleado en el
    // perfil son la misma cuadrilla. Sin esto, la capacitación no llega y
    // nadie entiende por qué.
    const c = contenido({ audience: 'perfiles', audience_profiles: ['Compactación'] })
    expect(puedeVer(c, 'v1', persona({ perfiles: ['  compactacion '] }))).toBe(true)
  })

  it('por personas, quien fue nombrado SÍ ve', () => {
    const c = contenido({ audience: 'personas' })
    expect(puedeVer(c, 'v1', persona({ nombradaEn: new Set(['v1']) }))).toBe(true)
  })

  it('el admin ve todo, incluidos borradores y audiencias cerradas', () => {
    // Sin esto no podria revisar lo que publica ni arreglar lo roto.
    const cerrado = contenido({ audience: 'personas', status: 'draft' })
    expect(puedeVer(cerrado, 'v1', persona({ esAdmin: true }))).toBe(true)
  })

  it('"todos" es el default y no esconde nada', () => {
    expect(puedeVer(contenido(), 'v1', persona())).toBe(true)
  })
})

describe('Filtrado y descripción', () => {
  it('filtra una lista mezclada dejando solo lo permitido', () => {
    const items = [
      { id: 'a', ...contenido() },
      { id: 'b', ...contenido({ audience: 'perfiles', audience_profiles: ['concreto'] }) },
      { id: 'c', ...contenido({ status: 'draft' }) },
    ]
    const r = filtrarVisibles(items, persona({ perfiles: ['concreto'] }))
    expect(r.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('la etiqueta del panel avisa cuando la configuración deja a nadie', () => {
    // "Perfiles" a secas no dice que nadie lo ve; el texto tiene que decirlo.
    expect(describirAudiencia(contenido({ audience: 'perfiles' }), 0)).toContain('nadie')
    expect(describirAudiencia(contenido({ audience: 'personas' }), 0)).toContain('nadie')
    expect(describirAudiencia(contenido(), 0)).toBe('Todos')
  })

  it('la clave de perfil normaliza igual en los dos lados', () => {
    expect(claveDePerfil(' Asfáltó ')).toBe(claveDePerfil('asfalto'))
  })
})
