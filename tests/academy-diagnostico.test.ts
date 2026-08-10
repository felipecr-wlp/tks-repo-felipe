/**
 * Panel de pruebas de la Academia.
 *
 * Cada caso de aqui es un fallo que en produccion se descubre con alguien
 * atorado a media capacitacion: un boton que lleva a un video borrado, una
 * pregunta que nadie puede contestar, una ruta publicada sin puerta. El
 * diagnostico existe para encontrarlos ANTES, y sin gastar egress: solo mira
 * metadatos.
 */
import { describe, it, expect } from 'vitest'
import { diagnosticar } from '@/lib/academy/diagnostico'
import type { VideoAcademia, RutaAcademia, Interaccion } from '@/lib/academy/videos'

function v(
  id: string,
  extra: Partial<VideoAcademia> = {},
): VideoAcademia {
  return {
    id, title: id, description: '',
    storage_path: `videos/${id}.mp4`, thumbnail_path: null,
    duration_seconds: 300, chapters: [], interactions: [], tags: [],
    stack_id: 'stack-1', status: 'live', created_by: null,
    audience: 'todos', audience_profiles: [], diagram_x: null, diagram_y: null,
    created_at: '2026-08-01', updated_at: '2026-08-01',
    ...extra,
  }
}

function ruta(extra: Partial<RutaAcademia> = {}): RutaAcademia {
  return {
    id: 'r1', title: 'Ruta', description: '', school_id: null,
    entry_video_id: null, accent: '#000', position: 0, status: 'draft',
    audience: 'todos', audience_profiles: [],
    created_by: null, created_at: '2026-08-01', updated_at: '2026-08-01',
    ...extra,
  }
}

const pregunta = (o: Partial<Interaccion>): Interaccion => ({
  s: 10, q: '¿?', opts: [{ t: 'a' }, { t: 'b' }], ...o,
})

describe('Diagnóstico: encuentra lo que deja atorada a una persona', () => {
  it('caza el enlace a un video borrado y dice qué hacer', () => {
    const r = diagnosticar(
      [v('a', { interactions: [pregunta({ opts: [{ t: 'ir', go: 'fantasma' }, { t: 'no' }] })] })],
      [],
    )
    const err = r.find((x) => x.titulo.includes('ya no existe'))
    expect(err?.gravedad).toBe('error')
    // El hallazgo sin el arreglo obliga a adivinar: se exige que lo traiga.
    expect(err?.arreglo.length).toBeGreaterThan(10)
  })

  it('caza la pregunta que nadie puede contestar', () => {
    // `a` fuera de rango: el video queda pausado para siempre.
    const r = diagnosticar([v('a', { interactions: [pregunta({ a: 5 })] })], [])
    expect(r.some((x) => x.gravedad === 'error' && x.titulo.includes('respuesta correcta'))).toBe(true)
  })

  it('avisa de la pregunta puesta después del final del video', () => {
    const r = diagnosticar([v('a', { duration_seconds: 60, interactions: [pregunta({ s: 90 })] })], [])
    expect(r.some((x) => x.titulo.includes('segundo 90'))).toBe(true)
  })

  it('una ruta PUBLICADA sin entrada es error; en borrador solo aviso', () => {
    // Publicada sin puerta es una promesa rota a la cara del equipo.
    // En borrador es trabajo a medias, que es normal.
    const publicada = diagnosticar([], [ruta({ status: 'live' })])
    const borrador = diagnosticar([], [ruta({ status: 'draft' })])
    expect(publicada[0].gravedad).toBe('error')
    expect(borrador[0].gravedad).toBe('aviso')
  })

  it('caza el video publicado que nadie puede encontrar', () => {
    const r = diagnosticar([v('perdido', { stack_id: null })], [])
    expect(r.some((x) => x.titulo.includes('no está en ningún stack'))).toBe(true)
  })

  it('un video alcanzable desde una ruta NO se reporta como perdido', () => {
    // Sin stack pero enlazado desde la ruta: se encuentra igual.
    const r = diagnosticar(
      [
        v('entrada', { stack_id: null, interactions: [pregunta({ opts: [{ t: 'ir', go: 'hijo' }, { t: 'no' }] })] }),
        v('hijo', { stack_id: null }),
      ],
      [ruta({ entry_video_id: 'entrada', status: 'live' })],
    )
    expect(r.some((x) => x.titulo.includes('no está en ningún stack'))).toBe(false)
  })

  it('los errores salen antes que los avisos', () => {
    const r = diagnosticar(
      [v('a', { duration_seconds: 10, interactions: [pregunta({ s: 99, a: 9 })] })],
      [],
    )
    expect(r.length).toBeGreaterThan(1)
    expect(r[0].gravedad).toBe('error')
    expect(r[r.length - 1].gravedad).toBe('aviso')
  })

  it('caza el video "por perfiles" sin perfiles: no lo ve nadie', () => {
    // El admin lo ve normal (ve todo), asi que sin este aviso se queda
    // invisible para el equipo durante semanas sin que nadie lo note.
    const r = diagnosticar([v('a', { audience: 'perfiles', audience_profiles: [] })], [])
    expect(r.some((x) => x.gravedad === 'error' && x.titulo.includes('no lo ve nadie'))).toBe(true)
  })

  it('caza el video "por personas" sin nadie nombrado', () => {
    // El caso gemelo del de perfiles. Se me paso la primera vez: el modo
    // existia, se podia elegir, y dejaba el video invisible sin que nada
    // avisara. Igual de silencioso, igual de grave.
    const r = diagnosticar([v('a', { audience: 'personas' })], [], {})
    expect(r.some((x) => x.gravedad === 'error' && x.titulo.includes('sin nadie nombrado'))).toBe(true)
  })

  it('con personas nombradas ya no avisa', () => {
    const r = diagnosticar([v('a', { audience: 'personas' })], [], { a: 3 })
    expect(r.some((x) => x.titulo.includes('sin nadie nombrado'))).toBe(false)
  })

  it('una academia sana no inventa hallazgos', () => {
    expect(diagnosticar([v('a')], [])).toEqual([])
  })

  it('no se cuelga con una ruta que da vueltas sobre sí misma', { timeout: 3000 }, () => {
    const ciclo = [
      v('a', { interactions: [pregunta({ opts: [{ t: 'b', go: 'b' }, { t: 'x' }] })] }),
      v('b', { interactions: [pregunta({ opts: [{ t: 'a', go: 'a' }, { t: 'x' }] })] }),
    ]
    expect(() => diagnosticar(ciclo, [ruta({ entry_video_id: 'a', status: 'live' })])).not.toThrow()
  })
})
