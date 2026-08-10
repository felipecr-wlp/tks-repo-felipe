/**
 * Logica pura de la galeria de videos: el ordenamiento "que ver hoy", la
 * validacion de capitulos y el parser de tiempos. Ejecuta la logica real
 * (no escanea fuente): esta en src/lib/academy/videos.ts justamente para eso.
 *
 * Lo que protegen estos tests: el carril "continuar viendo" es la unica
 * automatizacion de la galeria. Si un video terminado reaparece como nuevo, o
 * un video empezado se pierde del carril, la galeria "funciona" y sin embargo
 * deja de servir para lo unico que promete: decirte que sigue.
 */
import { describe, it, expect } from 'vitest'
import {
  agruparPorStack,
  ordenarVideosParaUsuario,
  porcentajeVisto,
  validarCapitulos,
  validarInteracciones,
  parsearTiempo,
  formatearSegundos,
  UMBRAL_EMPEZADO,
  type AvanceVideo,
  type StackAcademia,
  type VideoAcademia,
} from '@/lib/academy/videos'

function video(id: string, created: string, stack_id: string | null = null): VideoAcademia {
  return {
    id,
    title: id,
    description: '',
    storage_path: `videos/${id}/v.mp4`,
    thumbnail_path: null,
    duration_seconds: 600,
    chapters: [],
    interactions: [],
    tags: [],
    stack_id,
    status: 'live',
    created_by: null,
    created_at: created,
    updated_at: created,
  }
}

function stack(id: string, title: string, position: number): StackAcademia {
  return {
    id, title, position,
    description: '', accent: '#f59e0b', created_by: null,
    created_at: '2026-08-01', updated_at: '2026-08-01',
  }
}

function avance(video_id: string, extra: Partial<AvanceVideo> = {}): AvanceVideo {
  return {
    video_id,
    last_position: 0,
    seconds_watched: 0,
    completed: false,
    updated_at: '2026-08-01T00:00:00Z',
    ...extra,
  }
}

describe('Que ver hoy: los tres carriles', () => {
  it('reparte: empezado -> continuar, sin tocar -> nuevos, terminado -> vistos', () => {
    const videos = [video('a', '2026-08-01'), video('b', '2026-08-02'), video('c', '2026-08-03')]
    const avances = [
      avance('a', { seconds_watched: 120, last_position: 120 }),
      avance('c', { completed: true, seconds_watched: 600 }),
    ]
    const g = ordenarVideosParaUsuario(videos, avances)
    expect(g.continuar.map((v) => v.id)).toEqual(['a'])
    expect(g.nuevos.map((v) => v.id)).toEqual(['b'])
    expect(g.vistos.map((v) => v.id)).toEqual(['c'])
  })

  it('abrir un video por error (menos del umbral) NO lo saca de nuevos', () => {
    const g = ordenarVideosParaUsuario(
      [video('a', '2026-08-01')],
      [avance('a', { seconds_watched: UMBRAL_EMPEZADO - 1 })],
    )
    expect(g.nuevos.map((v) => v.id)).toEqual(['a'])
    expect(g.continuar).toHaveLength(0)
  })

  it('nuevos: lo mas reciente primero (lo que se sube hoy aparece arriba hoy)', () => {
    const g = ordenarVideosParaUsuario(
      [video('viejo', '2026-07-01'), video('nuevo', '2026-08-05')],
      [],
    )
    expect(g.nuevos.map((v) => v.id)).toEqual(['nuevo', 'viejo'])
  })

  it('continuar: lo que tocaste mas recientemente va primero', () => {
    const g = ordenarVideosParaUsuario(
      [video('a', '2026-08-01'), video('b', '2026-08-01')],
      [
        avance('a', { seconds_watched: 60, updated_at: '2026-08-01T10:00:00Z' }),
        avance('b', { seconds_watched: 60, updated_at: '2026-08-03T10:00:00Z' }),
      ],
    )
    expect(g.continuar.map((v) => v.id)).toEqual(['b', 'a'])
  })

  it('un video terminado NUNCA reaparece en continuar aunque tenga posicion', () => {
    const g = ordenarVideosParaUsuario(
      [video('a', '2026-08-01')],
      [avance('a', { completed: true, seconds_watched: 900, last_position: 300 })],
    )
    expect(g.continuar).toHaveLength(0)
    expect(g.vistos.map((v) => v.id)).toEqual(['a'])
  })
})

describe('Porcentaje de la tarjeta', () => {
  it('completado es 100 aunque la posicion no llegue al final', () => {
    const v = { ...video('a', '2026-08-01'), avance: avance('a', { completed: true, last_position: 10 }) }
    expect(porcentajeVisto(v)).toBe(100)
  })

  it('sin duracion conocida no inventa un numero: 0', () => {
    const v = {
      ...video('a', '2026-08-01'),
      duration_seconds: null,
      avance: avance('a', { last_position: 300, seconds_watched: 300 }),
    }
    expect(porcentajeVisto(v)).toBe(0)
  })

  it('a medias reporta la fraccion y tope 99 si no esta completado', () => {
    const v = { ...video('a', '2026-08-01'), avance: avance('a', { last_position: 300 }) }
    expect(porcentajeVisto(v)).toBe(50)
    const casi = { ...video('b', '2026-08-01'), avance: avance('b', { last_position: 599 }) }
    expect(porcentajeVisto(casi)).toBe(99)
  })
})

describe('Capitulos', () => {
  it('ordena por segundo y recorta espacios', () => {
    const r = validarCapitulos([
      { s: 90, t: '  Tendido ' },
      { s: 0, t: 'Llegada' },
    ])
    expect(r).toEqual([
      { s: 0, t: 'Llegada' },
      { s: 90, t: 'Tendido' },
    ])
  })

  it('rechaza lo que romperia el reproductor: negativos, sin titulo, duplicados', () => {
    expect(validarCapitulos([{ s: -1, t: 'x' }])).toBeNull()
    expect(validarCapitulos([{ s: 0, t: '   ' }])).toBeNull()
    expect(validarCapitulos([{ s: 5, t: 'a' }, { s: 5, t: 'b' }])).toBeNull()
    expect(validarCapitulos([{ s: 1.5, t: 'a' }])).toBeNull()
    expect(validarCapitulos('no es arreglo')).toBeNull()
  })

  it('vacio es valido: un video sin capitulos es normal', () => {
    expect(validarCapitulos([])).toEqual([])
  })
})

describe('Interacciones: preguntas ancladas a un segundo', () => {
  const buena = { s: 30, q: 'Que se revisa primero?', opts: ['Aceite', 'Nada'], a: 0 }

  it('acepta y ordena preguntas validas', () => {
    const r = validarInteracciones([{ ...buena, s: 90 }, buena])
    expect(r?.map((x) => x.s)).toEqual([30, 90])
  })

  it('rechaza lo que dejaria al reproductor sin salida', () => {
    // indice de correcta fuera de rango: la pregunta seria incontestable y el
    // video quedaria pausado para siempre. Este es EL caso que importa.
    expect(validarInteracciones([{ ...buena, a: 2 }])).toBeNull()
    expect(validarInteracciones([{ ...buena, a: -1 }])).toBeNull()
    expect(validarInteracciones([{ ...buena, opts: ['solo una'] }])).toBeNull()
    expect(validarInteracciones([{ ...buena, q: '  ' }])).toBeNull()
    expect(validarInteracciones([buena, { ...buena }])).toBeNull() // mismo segundo
  })

  it('vacio es valido y la explicacion es opcional', () => {
    expect(validarInteracciones([])).toEqual([])
    const con = validarInteracciones([{ ...buena, ex: ' porque si ' }])
    expect(con?.[0].ex).toBe('porque si')
    const sin = validarInteracciones([buena])
    expect(sin?.[0].ex).toBeUndefined()
  })
})

describe('Agrupado por stacks', () => {
  const vc = (id: string, sid: string | null) => ({ ...video(id, '2026-08-01', sid), avance: null })

  it('agrupa por stack en su orden y manda los sueltos al final', () => {
    const stacks = [stack('s2', 'Concreto', 2), stack('s1', 'Advisors', 1)]
    const secciones = agruparPorStack(
      [vc('a', 's1'), vc('b', 's2'), vc('c', null), vc('d', 's1')],
      stacks,
    )
    expect(secciones.map((x) => x.stack?.title ?? 'SUELTOS')).toEqual(['Advisors', 'Concreto', 'SUELTOS'])
    expect(secciones[0].videos.map((v) => v.id)).toEqual(['a', 'd'])
  })

  it('un stack vacio no pinta seccion', () => {
    const secciones = agruparPorStack([vc('a', 's1')], [stack('s1', 'A', 1), stack('s2', 'B', 2)])
    expect(secciones).toHaveLength(1)
  })

  it('un video con stack borrado (huerfano) cae a sueltos, no se pierde', () => {
    const secciones = agruparPorStack([vc('a', 'stack-que-ya-no-existe')], [])
    expect(secciones).toHaveLength(1)
    expect(secciones[0].stack).toBeNull()
    expect(secciones[0].videos.map((v) => v.id)).toEqual(['a'])
  })
})

describe('Parser de tiempos del editor', () => {
  it('acepta lo que una persona teclearia', () => {
    expect(parsearTiempo('83')).toBe(83)
    expect(parsearTiempo('1:23')).toBe(83)
    expect(parsearTiempo('01:02:03')).toBe(3723)
    expect(parsearTiempo(' 0:00 ')).toBe(0)
  })

  it('rechaza lo ambiguo en vez de adivinar', () => {
    expect(parsearTiempo('')).toBeNull()
    expect(parsearTiempo('1:60')).toBeNull()
    expect(parsearTiempo('1:2:3:4')).toBeNull()
    expect(parsearTiempo('abc')).toBeNull()
    expect(parsearTiempo('-5')).toBeNull()
  })

  it('es inverso de formatearSegundos para valores reales', () => {
    for (const s of [0, 59, 83, 3599, 3723]) {
      expect(parsearTiempo(formatearSegundos(s))).toBe(s)
    }
  })
})
