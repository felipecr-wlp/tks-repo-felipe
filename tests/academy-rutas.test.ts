/**
 * Arbol de rutas de aprendizaje.
 *
 * Lo que de verdad se prueba aqui es que la app NO SE CUELGUE. El arbol se
 * deriva caminando enlaces que escribe una persona a mano; un ciclo ("si te
 * equivocas vuelve al video anterior") es contenido perfectamente razonable y
 * un recorrido ingenuo se queda dando vueltas hasta tumbar la pestaña. Ese es
 * el fallo que estos tests existen para impedir, y por eso el primero tiene
 * timeout: si vuelve el bucle infinito, falla en vez de colgar la suite.
 */
import { describe, it, expect } from 'vitest'
import {
  construirArbol,
  siguientePaso,
  aplanar,
  PROFUNDIDAD_MAX,
} from '@/lib/academy/rutas'
import type { VideoAcademia, AvanceVideo, Interaccion } from '@/lib/academy/videos'

/** Video con ramas: cada entrada de `va` es [etiqueta, idDestino]. */
function v(id: string, va: Array<[string, string]> = []): VideoAcademia {
  const interactions: Interaccion[] = va.length
    ? [{ s: 5, q: '¿Qué sigue?', opts: va.map(([t, go]) => ({ t, go })) }]
    : []
  return {
    id, title: id, description: '',
    storage_path: `videos/${id}.mp4`, thumbnail_path: null,
    duration_seconds: 300, chapters: [], interactions, tags: [],
    stack_id: null, audience: 'todos', audience_profiles: [], diagram_x: null, diagram_y: null,
    requires_ack: false, requires_verification: false, valid_months: null, ack_text: null,
    status: 'live', created_by: null,
    created_at: '2026-08-01', updated_at: '2026-08-01',
  }
}

const visto = (id: string): AvanceVideo => ({
  video_id: id, last_position: 300, seconds_watched: 300,
  completed: true, updated_at: '2026-08-02',
})

describe('Ruta: el caso que pidió Ali', () => {
  // Bienvenida -> (Concreto | Asfalto) -> cada uno con su subrama.
  const catalogo = [
    v('bienvenida', [['Concreto', 'concreto'], ['Asfalto', 'asfalto']]),
    v('concreto', [['Vaciado', 'conc-vaciado'], ['Acabado', 'conc-acabado']]),
    v('asfalto', [['Compactación', 'asf-compact']]),
    v('conc-vaciado'), v('conc-acabado'), v('asf-compact'),
  ]

  it('arma el árbol completo desde la bienvenida', () => {
    const r = construirArbol('bienvenida', catalogo, [])
    expect(r.totalVideos).toBe(6)
    expect(r.raiz?.hijos.map((h) => h.etiqueta)).toEqual(['Concreto', 'Asfalto'])
    // La subrama de concreto cuelga de concreto, no de la raiz.
    expect(r.raiz?.hijos[0].hijos.map((h) => h.etiqueta)).toEqual(['Vaciado', 'Acabado'])
  })

  it('cuenta el avance solo de lo alcanzable desde la ruta', () => {
    // 'suelto' no cuelga de la ruta: verlo no debe inflar su porcentaje.
    const conSuelto = [...catalogo, v('suelto')]
    const r = construirArbol('bienvenida', conSuelto, [visto('bienvenida'), visto('suelto')])
    expect(r.totalVideos).toBe(6)
    expect(r.vistos).toBe(1)
  })

  it('sugiere el siguiente paso, nunca uno ya visto', () => {
    const r = construirArbol('bienvenida', catalogo, [visto('bienvenida')])
    expect(siguientePaso(r)?.videoId).toBe('concreto')
  })

  it('sigue DENTRO de la rama elegida, no salta a la de al lado', () => {
    // Este es el caso que se vio mal en produccion: tras ver la bienvenida y
    // la introduccion de Concreto, el boton mandaba a ASFALTO, o sea a la
    // rama que la persona no eligio. Tiene que llevar a una subrama de
    // concreto, que es lo que dijo que queria aprender.
    const r = construirArbol('bienvenida', catalogo, [visto('bienvenida'), visto('concreto')])
    expect(siguientePaso(r)?.videoId).toBe('conc-vaciado')
  })

  it('al agotar la rama elegida sí ofrece la otra', () => {
    // Profundidad no significa quedarse encerrado: cuando concreto se acaba,
    // lo siguiente pendiente es asfalto.
    const r = construirArbol('bienvenida', catalogo, [
      visto('bienvenida'), visto('concreto'), visto('conc-vaciado'), visto('conc-acabado'),
    ])
    expect(siguientePaso(r)?.videoId).toBe('asfalto')
  })

  it('sin nada pendiente ya no sugiere nada', () => {
    const todos = catalogo.map((x) => visto(x.id))
    expect(siguientePaso(construirArbol('bienvenida', catalogo, todos))).toBeNull()
  })
})

describe('Ruta: lo que no puede colgar la app', () => {
  it('un ciclo A -> B -> A termina, no da vueltas', { timeout: 3000 }, () => {
    const ciclico = [v('a', [['ir a B', 'b']]), v('b', [['volver a A', 'a']])]
    const r = construirArbol('a', ciclico, [])

    expect(r.totalVideos).toBe(2)
    const vuelta = r.raiz!.hijos[0].hijos[0]
    expect(vuelta.videoId).toBe('a')
    // Se pinta marcado como ciclo y ahi se corta: sin hijos.
    expect(vuelta.ciclo).toBe(true)
    expect(vuelta.hijos).toHaveLength(0)
  })

  it('un video que aparece en DOS ramas sí se pinta en las dos', () => {
    // El corte es por camino, no global. Si fuera global, "seguridad" saldria
    // solo en la primera rama y la segunda quedaria coja sin motivo.
    const diamante = [
      v('raiz', [['Izquierda', 'izq'], ['Derecha', 'der']]),
      v('izq', [['Seguridad', 'seguridad']]),
      v('der', [['Seguridad', 'seguridad']]),
      v('seguridad'),
    ]
    const r = construirArbol('raiz', diamante, [])
    expect(r.raiz!.hijos[0].hijos[0].videoId).toBe('seguridad')
    expect(r.raiz!.hijos[1].hijos[0].videoId).toBe('seguridad')
    expect(r.raiz!.hijos[1].hijos[0].ciclo).toBe(false)
    // Pero cuenta UNA vez para el avance: son el mismo video.
    expect(r.totalVideos).toBe(4)
  })

  it('una cadena larguísima se trunca en vez de crecer sin fin', { timeout: 5000 }, () => {
    const largo = Array.from({ length: PROFUNDIDAD_MAX + 10 }, (_, i) =>
      v(`n${i}`, i < PROFUNDIDAD_MAX + 9 ? [['sigue', `n${i + 1}`]] : []),
    )
    const r = construirArbol('n0', largo, [])
    expect(r.truncado).toBe(true)
  })

  it('un enlace a un video borrado se marca roto y NO revienta el mapa', () => {
    const r = construirArbol('a', [v('a', [['al que ya no existe', 'fantasma']])], [])
    expect(r.rotos).toBe(1)
    expect(r.raiz!.hijos[0].video).toBeNull()
    // Y no cuenta como contenido: seria prometer un video que no hay.
    expect(r.totalVideos).toBe(1)
  })

  it('una ruta descabezada (sin video de entrada) no rompe la pantalla', () => {
    const r = construirArbol(null, [], [])
    expect(r.raiz).toBeNull()
    expect(r.totalVideos).toBe(0)
    expect(siguientePaso(r)).toBeNull()
    expect(aplanar(r.raiz)).toEqual([])
  })
})
