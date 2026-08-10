/**
 * Diagnostico de la Academia: revisa la ESTRUCTURA sin tocar un solo byte de
 * video.
 *
 * POR QUE IMPORTA QUE NO CARGUE VIDEO. Un "banco de pruebas" que reproduce
 * para comprobar cada rama costaria egress cada vez que alguien lo abre, y se
 * abre justo cuando se esta armando el curso, o sea muchas veces seguidas.
 * Todo lo que se revisa aqui (destinos, rutas, huerfanos, preguntas
 * incontestables) vive en los METADATOS que la pagina ya cargo. Cero bytes de
 * video, cero egress.
 *
 * Lo que esto NO puede decir: si el video se ve bien, si el audio se escucha,
 * si el segundo 30 es el momento correcto para preguntar. Eso solo se sabe
 * viendolo. Esto revisa lo que una persona no puede revisar de memoria: que
 * los cientos de enlaces apunten a algo.
 */
import type { VideoAcademia, RutaAcademia } from './videos'
import { construirArbol } from './rutas'

export type Gravedad = 'error' | 'aviso'

export interface Hallazgo {
  gravedad: Gravedad
  /** Que esta mal, en una linea. */
  titulo: string
  /** Que hacer al respecto. */
  arreglo: string
  /** Donde: titulo del video o de la ruta afectada. */
  donde: string
  /** Para poder enlazar a la pantalla del objeto. */
  videoId?: string
  pathId?: string
}

/**
 * Revisa todo y devuelve los hallazgos, los graves primero.
 * Determinista y puro: los mismos datos dan el mismo resultado.
 */
export function diagnosticar(
  videos: readonly VideoAcademia[],
  rutas: readonly RutaAcademia[],
): Hallazgo[] {
  const h: Hallazgo[] = []
  const porId = new Map(videos.map((v) => [v.id, v]))

  for (const v of videos) {
    for (const it of v.interactions) {
      // 1. Destino que no existe: boton a un 404 a mitad de la historia.
      for (const o of it.opts) {
        if (o.go && !porId.has(o.go)) {
          h.push({
            gravedad: 'error',
            titulo: `La opción "${o.t}" lleva a un video que ya no existe`,
            arreglo: 'Edita la pregunta y apunta la opción a un video vivo, o quita la opción.',
            donde: v.title,
            videoId: v.id,
          })
        }
      }

      // 2. Pregunta de quiz cuya "correcta" esta fuera de rango: nadie puede
      //    acertar, y el video se queda pausado para siempre. Esto ya no
      //    deberia poder guardarse, pero puede haber quedado de antes.
      if (it.a !== undefined && (it.a < 0 || it.a >= it.opts.length)) {
        h.push({
          gravedad: 'error',
          titulo: `Una pregunta no tiene respuesta correcta posible (segundo ${it.s})`,
          arreglo: 'Corrige el número de la opción correcta: nadie puede pasar de aquí.',
          donde: v.title,
          videoId: v.id,
        })
      }

      // 3. Pregunta despues del final del video: nunca se dispara.
      if (v.duration_seconds && it.s > v.duration_seconds) {
        h.push({
          gravedad: 'aviso',
          titulo: `Hay una pregunta en el segundo ${it.s}, pero el video dura ${v.duration_seconds}`,
          arreglo: 'Mueve la pregunta a un segundo dentro del video; así nunca aparece.',
          donde: v.title,
          videoId: v.id,
        })
      }
    }

    // 4. Capitulo mas alla del final: se ve en la lista y no lleva a nada.
    for (const c of v.chapters) {
      if (v.duration_seconds && c.s > v.duration_seconds) {
        h.push({
          gravedad: 'aviso',
          titulo: `El capítulo "${c.t}" empieza después de que el video termina`,
          arreglo: 'Corrige el tiempo del capítulo.',
          donde: v.title,
          videoId: v.id,
        })
      }
    }
  }

  // 4b. Audiencia mal configurada: elegido "por perfiles" y sin perfiles
  //     marcados. No lo ve NADIE, y desde la galeria del admin se ve normal
  //     porque el admin lo ve todo. Es el fallo perfecto para pasar semanas
  //     sin que nadie lo note.
  for (const v of videos) {
    if (v.status !== 'live') continue
    if (v.audience === 'perfiles' && v.audience_profiles.length === 0) {
      h.push({
        gravedad: 'error',
        titulo: 'Video publicado "por perfiles" pero sin ningún perfil: no lo ve nadie',
        arreglo: 'Marca los perfiles que deben verlo, o cámbialo a "Todos".',
        donde: v.title,
        videoId: v.id,
      })
    }
  }

  // 5. Rutas: descabezadas, publicadas sin entrada, o con enlaces rotos.
  const alcanzablesTotal = new Set<string>()
  for (const r of rutas) {
    if (!r.entry_video_id) {
      h.push({
        gravedad: r.status === 'live' ? 'error' : 'aviso',
        titulo: 'Ruta sin video de entrada',
        arreglo: 'Asígnale el video por el que se empieza, en la pestaña Rutas.',
        donde: r.title,
        pathId: r.id,
      })
      continue
    }
    if (!porId.has(r.entry_video_id)) {
      h.push({
        gravedad: 'error',
        titulo: 'El video de entrada de la ruta ya no existe',
        arreglo: 'Asígnale otro video de entrada.',
        donde: r.title,
        pathId: r.id,
      })
      continue
    }
    const arbol = construirArbol(r.entry_video_id, videos, [])
    for (const id of idsAlcanzables(r.entry_video_id, porId)) alcanzablesTotal.add(id)
    if (arbol.truncado) {
      h.push({
        gravedad: 'aviso',
        titulo: 'La ruta encadena demasiados niveles y el mapa se corta',
        arreglo: 'Acorta la cadena de videos: más de 25 niveles no se puede seguir.',
        donde: r.title,
        pathId: r.id,
      })
    }
  }

  // 6. Videos publicados que ninguna ruta alcanza y que ademas no estan en
  //    ningun stack: existen pero nadie los va a encontrar.
  for (const v of videos) {
    if (v.status !== 'live') continue
    if (alcanzablesTotal.has(v.id)) continue
    if (v.stack_id !== null) continue
    h.push({
      gravedad: 'aviso',
      titulo: 'Video publicado que no está en ningún stack ni en ninguna ruta',
      arreglo: 'Asígnalo a un stack o enlázalo desde una ruta, o nadie lo va a encontrar.',
      donde: v.title,
      videoId: v.id,
    })
  }

  // Los errores primero: son los que dejan a alguien atorado.
  return h.sort((a, b) => (a.gravedad === b.gravedad ? 0 : a.gravedad === 'error' ? -1 : 1))
}

/** Ids alcanzables desde una entrada, con corte de ciclos. */
function idsAlcanzables(
  entrada: string,
  porId: ReadonlyMap<string, VideoAcademia>,
): Set<string> {
  const vistos = new Set<string>()
  const pila = [entrada]
  while (pila.length > 0) {
    const id = pila.pop()!
    if (vistos.has(id)) continue
    vistos.add(id)
    const v = porId.get(id)
    if (!v) continue
    for (const it of v.interactions) {
      for (const o of it.opts) if (o.go) pila.push(o.go)
    }
  }
  return vistos
}
