/**
 * Armado de reportes de la bitacora (dia, semana o rango libre).
 *
 * La bitacora ya guardaba actividades sueltas. Lo que faltaba era el paso que
 * en la practica nadie da: convertir treinta renglones en un texto que se pueda
 * pegar en un correo. Eso obliga a leer todo y redactar, y por eso casi nunca
 * se hace; el viernes la gente escribe "avancé en varias cosas" y la semana
 * entera se pierde.
 *
 * Tres reglas gobiernan este archivo:
 *
 * 1. NO SE INVENTA NADA. El modelo redacta SOLO con las actividades que ya
 *    estan registradas. Si una semana tuvo tres renglones, el reporte dice tres
 *    cosas. Un reporte que rellena huecos con lenguaje corporativo es peor que
 *    no tener reporte, porque se lee como si hubiera pasado algo.
 * 2. LOS NUMEROS NO LOS CALCULA EL MODELO. Horas, dias cubiertos, tareas
 *    cerradas y antiguedad de los bloqueos se cuentan aqui, en TypeScript, y
 *    llegan al prompt ya resueltos. Un modelo sumando minutos de treinta
 *    renglones se equivoca lo suficiente como para que alguien lo note, y el
 *    dia que un numero sale mal se deja de creer el reporte entero. El modelo
 *    redacta; la aritmetica no es su trabajo.
 * 3. LA PRIVACIDAD SE APLICA ANTES DE ARMAR, no despues. El recolector recibe
 *    ya decidido de quien puede leer; nunca decide eso por su cuenta.
 */
import { generateText } from 'ai'
import { modeloTexto } from '@/lib/ai/client'
import { CATEGORY_LABEL, formatReportDate } from '@/lib/daily-reports'
import { revisarDuplicados, type EntradaComparable } from '@/lib/daily-report-dedupe'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export type DigestPeriod = 'dia' | 'semana' | 'rango'

export interface DigestScope {
  workspaceId: string
  /** null = reporte del equipo completo. */
  profileId: string | null
  from: string
  to: string
}

/**
 * Lo que se cuenta del periodo. Todo esto sale de las filas, nunca del modelo.
 * Es lo que separa un reporte que narra de uno que ademas se puede auditar.
 */
export interface DigestStats {
  /** Dias del rango que tienen al menos una actividad, contra los dias del rango. */
  diasConActividad: number
  diasDelRango: number
  /** Minutos registrados y cuantas actividades traian tiempo. Sin tiempo, 0. */
  minutosRegistrados: number
  actividadesConTiempo: number
  porCategoria: Record<string, number>
  /** Bloqueos que siguen abiertos, con cuantos dias llevan. */
  bloqueosAbiertos: { texto: string; persona: string; dias: number }[]
  bloqueosResueltos: number
  /** Tareas del tablero tocadas en el periodo y cuantas quedaron cerradas. */
  tareasTocadas: number
  tareasCerradas: number
  tareasAbiertas: string[]
  /** Actividades con foto o archivo adjunto. La evidencia dice que hubo entrega. */
  conEvidencia: number
  /**
   * Pares que parecen el mismo trabajo contado dos veces. NO se borran: se le
   * dicen al redactor para que los una en una sola vinneta en vez de listar el
   * mismo avance dos veces y hacerlo ver como el doble de trabajo.
   */
  redundancias: { a: string; b: string }[]
}

export interface DigestMaterial {
  /** Actividades encontradas, ya agrupadas por persona y dia. */
  bloques: string[]
  totalActividades: number
  totalPersonas: number
  bloqueosAbiertos: number
  stats: DigestStats
}

/** "12 h 30 min". Sin horas, solo minutos; sin minutos, solo horas. */
function formatoHoras(minutos: number): string {
  if (minutos <= 0) return '0 min'
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/** Dias enteros entre dos fechas YYYY-MM-DD. Nunca negativo. */
function diasEntre(desde: string, hasta: string): number {
  const d = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
  return d > 0 ? d : 0
}

/**
 * Junta el material crudo del periodo. Devuelve texto plano ya ordenado, no
 * filas: el modelo redacta mejor sobre algo legible que sobre un JSON, y de
 * paso el prompt se puede leer en un log cuando algo sale raro.
 *
 * El limite de 4000 entradas no es defensivo por gusto: un rango largo de un
 * equipo grande puede pasarse del contexto del modelo, y es preferible un
 * reporte de un periodo acotado que una llamada que revienta.
 */
export async function collectDigestMaterial(admin: Admin, scope: DigestScope): Promise<DigestMaterial> {
  type ReportRow = {
    id: string
    profile_id: string
    report_date: string
    profile: { id: string; display_name: string } | null
  }

  let q = admin
    .from('daily_reports')
    .select('id, profile_id, report_date, profile:profiles ( id, display_name )')
    .eq('workspace_id', scope.workspaceId)
    .gte('report_date', scope.from)
    .lte('report_date', scope.to)
  if (scope.profileId) q = q.eq('profile_id', scope.profileId)

  const { data: reportRows } = (await q.limit(600)) as { data: ReportRow[] | null; error: unknown }
  const reports = reportRows ?? []
  if (reports.length === 0) return materialVacio(scope)

  type EntryRow = {
    id: string
    report_id: string
    content: string
    category: string
    minutes: number | null
    resolved_at: string | null
    created_at: string
    task_id: string | null
    task: { title: string } | null
  }
  const { data: entryRows } = (await admin
    .from('daily_report_entries')
    .select('id, report_id, content, category, minutes, resolved_at, created_at, task_id, task:tasks ( title )')
    .in(
      'report_id',
      reports.map(r => r.id)
    )
    .order('created_at', { ascending: true })
    .limit(4000)) as { data: EntryRow[] | null; error: unknown }

  const entries = entryRows ?? []
  if (entries.length === 0) return materialVacio(scope)

  // El estado de las tareas se pide APARTE y no como embed anidado dentro de
  // `task:tasks ( status:task_statuses ( ... ) )`. Un embed de dos saltos
  // depende de la cache de esquema de PostgREST, y cuando esa cache se queda
  // vieja la consulta entera devuelve error: el reporte dejaria de armarse por
  // un dato accesorio. Asi, si esta segunda consulta falla, el reporte sale
  // igual y solo pierde la linea de tareas cerradas.
  const taskIds = Array.from(new Set(entries.map(e => e.task_id).filter((t): t is string => !!t)))
  type TaskRow = { id: string; title: string; status: { category: string } | null }
  let tasks: TaskRow[] = []
  if (taskIds.length > 0) {
    const { data } = (await admin
      .from('tasks')
      .select('id, title, status:task_statuses ( category )')
      .in('id', taskIds)
      .limit(500)) as { data: TaskRow[] | null; error: unknown }
    tasks = data ?? []
  }

  // Evidencia adjunta. Se cuentan ENTRADAS con imagen, no imagenes: tres fotos
  // de la misma actividad son una entrega, no tres.
  type ImageRow = { entry_id: string }
  const { data: imageRows } = (await admin
    .from('daily_report_images')
    .select('entry_id')
    .in(
      'report_id',
      reports.map(r => r.id)
    )
    .limit(4000)) as { data: ImageRow[] | null; error: unknown }
  const entradasConEvidencia = new Set((imageRows ?? []).map(i => i.entry_id))

  const byReport = new Map<string, EntryRow[]>()
  for (const e of entries) {
    const list = byReport.get(e.report_id) ?? []
    list.push(e)
    byReport.set(e.report_id, list)
  }

  // Se agrupa por PERSONA y dentro por DIA. Al reves (por dia y dentro por
  // persona) el modelo redacta un diario del equipo, que es justo lo que nadie
  // quiere leer; asi redacta la historia de cada quien.
  const porPersona = new Map<string, { nombre: string; dias: Map<string, EntryRow[]> }>()
  for (const r of reports) {
    const propias = byReport.get(r.id) ?? []
    if (propias.length === 0) continue
    const nombre = r.profile?.display_name ?? 'Sin nombre'
    const p = porPersona.get(r.profile_id) ?? { nombre, dias: new Map<string, EntryRow[]>() }
    p.dias.set(r.report_date, propias)
    porPersona.set(r.profile_id, p)
  }

  const stats: DigestStats = {
    diasConActividad: 0,
    diasDelRango: diasEntre(scope.from, scope.to) + 1,
    minutosRegistrados: 0,
    actividadesConTiempo: 0,
    porCategoria: {},
    bloqueosAbiertos: [],
    bloqueosResueltos: 0,
    tareasTocadas: taskIds.length,
    tareasCerradas: tasks.filter(t => t.status?.category === 'done').length,
    tareasAbiertas: tasks.filter(t => t.status?.category !== 'done').map(t => t.title),
    conEvidencia: 0,
    redundancias: [],
  }

  const diasVistos = new Set<string>()
  const bloques: string[] = []

  for (const p of Array.from(porPersona.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    const lineas: string[] = [`## ${p.nombre}`]
    for (const dia of Array.from(p.dias.keys()).sort()) {
      diasVistos.add(dia)
      lineas.push(`### ${formatReportDate(dia)}`)
      for (const e of p.dias.get(dia)!) {
        const etiqueta = CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? e.category
        stats.porCategoria[etiqueta] = (stats.porCategoria[etiqueta] ?? 0) + 1

        if (e.minutes && e.minutes > 0) {
          stats.minutosRegistrados += e.minutes
          stats.actividadesConTiempo += 1
        }
        if (entradasConEvidencia.has(e.id)) stats.conEvidencia += 1

        if (e.category === 'bloqueo') {
          if (e.resolved_at) {
            stats.bloqueosResueltos += 1
          } else {
            stats.bloqueosAbiertos.push({
              texto: e.content,
              persona: p.nombre,
              dias: diasEntre(dia, scope.to),
            })
          }
        }

        const estado = e.category === 'bloqueo' ? (e.resolved_at ? ' [ya resuelto]' : ' [SIGUE ABIERTO]') : ''
        const tarea = e.task?.title ? ` (tarea: ${e.task.title})` : ''
        const tiempo = e.minutes && e.minutes > 0 ? ` [${e.minutes} min]` : ''
        const prueba = entradasConEvidencia.has(e.id) ? ' [con evidencia adjunta]' : ''
        lineas.push(`- (${etiqueta})${estado} ${e.content}${tarea}${tiempo}${prueba}`)
      }
    }

    // Redundancias DENTRO de la misma persona Y del mismo dia. Las dos
    // restricciones importan y por motivos distintos:
    //   - entre personas: dos miembros que describen la misma junta con las
    //     mismas palabras no estan inflando nada, cada quien reporta su parte.
    //   - entre dias: "avance la campaña" el lunes y el miercoles es trabajo
    //     continuado, no el mismo trabajo contado dos veces. Comparar a lo
    //     largo de la semana marcaria como redundante justo lo que es normal, y
    //     un reporte que acusa de inflar donde no lo hubo se deja de usar.
    for (const delDia of p.dias.values()) {
      const comparables: EntradaComparable[] = delDia.map(e => ({
        id: e.id,
        content: e.content,
        category: e.category,
        task_id: e.task_id,
      }))
      for (const par of revisarDuplicados(comparables).filter(x => x.motivo !== 'texto_parecido')) {
        if (stats.redundancias.length >= 6) break
        stats.redundancias.push({ a: par.a.content, b: par.b.content })
      }
    }

    bloques.push(lineas.join('\n'))
  }

  stats.diasConActividad = diasVistos.size

  return {
    bloques,
    totalActividades: entries.length,
    totalPersonas: porPersona.size,
    bloqueosAbiertos: stats.bloqueosAbiertos.length,
    stats,
  }
}

/** Periodo sin nada que contar. Se devuelve con la misma forma para que quien llama no ramifique. */
function materialVacio(scope: DigestScope): DigestMaterial {
  return {
    bloques: [],
    totalActividades: 0,
    totalPersonas: 0,
    bloqueosAbiertos: 0,
    stats: {
      diasConActividad: 0,
      diasDelRango: diasEntre(scope.from, scope.to) + 1,
      minutosRegistrados: 0,
      actividadesConTiempo: 0,
      porCategoria: {},
      bloqueosAbiertos: [],
      bloqueosResueltos: 0,
      tareasTocadas: 0,
      tareasCerradas: 0,
      tareasAbiertas: [],
      conEvidencia: 0,
      redundancias: [],
    },
  }
}

/**
 * Instrucciones de redaccion. Van aqui y no dispersas en la ruta porque el
 * comportamiento del reporte ES este texto: cualquier cambio de tono o de
 * estructura se hace en un solo lugar.
 */
const DIGEST_SYSTEM = `Eres el redactor de reportes de trabajo de WLO. Recibes la bitácora CRUDA de un periodo y la conviertes en un reporte que una persona pueda leer o reenviar sin editarlo.

Reglas que no puedes romper:
- Escribe SOLO con lo que viene en la bitácora. No inventes actividades, cifras, nombres, clientes, porcentajes ni conclusiones que el material no soporte.
- Los números del bloque "Datos calculados" ya vienen contados. Cópialos tal cual. NO sumes, no estimes, no calcules porcentajes por tu cuenta y no contradigas esas cifras.
- Si el material es pobre, el reporte es corto. Un reporte de tres líneas honesto vale más que uno de dos páginas relleno.
- Nunca uses guiones largos (— o –). Usa punto, coma, dos puntos o paréntesis.
- Español correcto, con ñ y tildes.
- Nada de emojis.
- Tono ejecutivo y directo, sin frases de relleno tipo "en el marco de" o "cabe destacar".

Estructura de tu respuesta (Markdown, sin repetir el título del periodo):

## Resumen
Dos a cuatro frases con lo que de verdad pasó en el periodo. Conclusión primero. Si hay tiempo registrado o tareas cerradas, méncionalo aquí con los números que te dieron.

## En números
Lista corta con lo que venga en "Datos calculados": actividades, días cubiertos, tiempo registrado, tareas del tablero tocadas y cerradas, evidencia adjunta. Omite la línea de cualquier dato que venga en cero en vez de escribir "0". Si no hay nada que reportar aquí, omite la sección completa.

## Lo que se avanzó
Viñetas agrupadas por tema, no por día. Si varias entradas son del mismo trabajo, únelas en una sola viñeta. Cuando una viñeta corresponda a una tarea del tablero, nómbrala. Si la actividad traía evidencia adjunta, dilo al final de la viñeta entre paréntesis.

## Bloqueos
Solo los que siguen abiertos, cada uno con cuántos días lleva (te lo dan calculado) y a quién detiene. Si no hay ninguno abierto, escribe una sola línea diciéndolo y menciona cuántos se resolvieron en el periodo, si es que se resolvió alguno.

## Lo que sigue
Lo que la propia bitácora registró como siguiente, más las tareas del tablero que quedaron abiertas. Si no se registró nada, dilo en una línea y no propongas tareas por tu cuenta.

## Puntos de atención
Solo si el material lo justifica: días del rango sin ninguna actividad registrada, actividades que parecen el mismo trabajo contado dos veces (te las señalan como redundancias), o mucho trabajo sin tiempo registrado. Máximo tres viñetas, cada una sobria y sin regañar a nadie. Si no hay nada de esto, omite la sección completa.

Si el reporte cubre a varias personas, dentro de "Lo que se avanzó" agrupa por persona con negritas.`

/**
 * Los numeros ya contados, en texto para el prompt.
 *
 * Va como bloque APARTE de la bitacora cruda y con nombre propio para que el
 * modelo no lo confunda con una actividad mas y lo cite como si alguien lo
 * hubiera escrito. Las lineas en cero se omiten: darle "0 tareas cerradas" solo
 * invita a redactar un parrafo sobre algo que no paso.
 */
function bloqueDatos(s: DigestStats): string {
  const l: string[] = []
  l.push(`- Días del rango con actividad registrada: ${s.diasConActividad} de ${s.diasDelRango}`)
  if (s.minutosRegistrados > 0) {
    l.push(
      `- Tiempo registrado: ${formatoHoras(s.minutosRegistrados)} en ${s.actividadesConTiempo} actividades`
    )
  }
  const cats = Object.entries(s.porCategoria)
  if (cats.length > 0) {
    l.push(`- Por tipo: ${cats.map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  if (s.tareasTocadas > 0) {
    l.push(`- Tareas del tablero tocadas: ${s.tareasTocadas}, de las cuales cerradas: ${s.tareasCerradas}`)
  }
  if (s.tareasAbiertas.length > 0) {
    l.push(`- Tareas que quedaron abiertas: ${s.tareasAbiertas.slice(0, 12).join('; ')}`)
  }
  if (s.conEvidencia > 0) l.push(`- Actividades con evidencia adjunta: ${s.conEvidencia}`)
  if (s.bloqueosResueltos > 0) l.push(`- Bloqueos resueltos en el periodo: ${s.bloqueosResueltos}`)
  for (const b of s.bloqueosAbiertos.slice(0, 10)) {
    l.push(
      `- Bloqueo ABIERTO (${b.persona}, lleva ${b.dias === 0 ? 'menos de un día' : `${b.dias} ${b.dias === 1 ? 'día' : 'días'}`}): ${b.texto}`
    )
  }
  for (const r of s.redundancias.slice(0, 6)) {
    l.push(`- Posible redundancia, únelas en una sola viñeta: "${r.a}" y "${r.b}"`)
  }
  return l.join('\n')
}

export interface BuildDigestResult {
  content: string
  totalActividades: number
}

/**
 * Redacta el reporte. Devuelve `null` si no hubo material: llamar al modelo con
 * una bitacora vacia solo produce un parrafo inventado y cuesta lo mismo.
 */
export async function buildDigest(
  material: DigestMaterial,
  meta: { period: DigestPeriod; from: string; to: string; persona: string | null }
): Promise<BuildDigestResult | null> {
  if (material.totalActividades === 0) return null

  const encabezado =
    meta.period === 'dia'
      ? `Reporte del ${formatReportDate(meta.from)}`
      : `Reporte del ${formatReportDate(meta.from)} al ${formatReportDate(meta.to)}`

  const quien = meta.persona
    ? `Es el reporte de una sola persona: ${meta.persona}. Escribe en tercera persona y no la nombres en cada viñeta.`
    : `Es el reporte de un equipo de ${material.totalPersonas} ${material.totalPersonas === 1 ? 'persona' : 'personas'}.`

  const prompt = [
    encabezado,
    quien,
    `Actividades registradas: ${material.totalActividades}. Bloqueos abiertos: ${material.bloqueosAbiertos}.`,
    '',
    'Datos calculados (ya contados, cópialos tal cual):',
    bloqueDatos(material.stats),
    '',
    'Bitácora cruda:',
    '',
    material.bloques.join('\n\n'),
  ].join('\n')

  const { text } = await generateText({
    model: modeloTexto,
    system: DIGEST_SYSTEM,
    prompt,
    temperature: 0.3,
  })

  // Cinturon y tirantes contra el guion largo: la regla esta en el prompt, pero
  // un modelo la rompe de vez en cuando y el reporte se manda tal cual.
  const limpio = text.replace(/\s?[—–]\s?/g, ', ').trim()

  return { content: limpio, totalActividades: material.totalActividades }
}
