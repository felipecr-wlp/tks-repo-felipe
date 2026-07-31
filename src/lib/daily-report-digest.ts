/**
 * Armado de reportes de la bitacora (dia, semana o rango libre).
 *
 * La bitacora ya guardaba actividades sueltas. Lo que faltaba era el paso que
 * en la practica nadie da: convertir treinta renglones en un texto que se pueda
 * pegar en un correo. Eso obliga a leer todo y redactar, y por eso casi nunca
 * se hace; el viernes la gente escribe "avancé en varias cosas" y la semana
 * entera se pierde.
 *
 * Dos reglas gobiernan este archivo:
 *
 * 1. NO SE INVENTA NADA. El modelo redacta SOLO con las actividades que ya
 *    estan registradas. Si una semana tuvo tres renglones, el reporte dice tres
 *    cosas. Un reporte que rellena huecos con lenguaje corporativo es peor que
 *    no tener reporte, porque se lee como si hubiera pasado algo.
 * 2. LA PRIVACIDAD SE APLICA ANTES DE ARMAR, no despues. El recolector recibe
 *    ya decidido de quien puede leer; nunca decide eso por su cuenta.
 */
import { generateText } from 'ai'
import { geminiFlash } from '@/lib/ai/client'
import { CATEGORY_LABEL, formatReportDate } from '@/lib/daily-reports'
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

export interface DigestMaterial {
  /** Actividades encontradas, ya agrupadas por persona y dia. */
  bloques: string[]
  totalActividades: number
  totalPersonas: number
  bloqueosAbiertos: number
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
  if (reports.length === 0) {
    return { bloques: [], totalActividades: 0, totalPersonas: 0, bloqueosAbiertos: 0 }
  }

  type EntryRow = {
    report_id: string
    content: string
    category: string
    resolved_at: string | null
    created_at: string
    task: { title: string } | null
  }
  const { data: entryRows } = (await admin
    .from('daily_report_entries')
    .select('report_id, content, category, resolved_at, created_at, task:tasks ( title )')
    .in(
      'report_id',
      reports.map(r => r.id)
    )
    .order('created_at', { ascending: true })
    .limit(4000)) as { data: EntryRow[] | null; error: unknown }

  const entries = entryRows ?? []

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

  let bloqueosAbiertos = 0
  const bloques: string[] = []
  for (const p of Array.from(porPersona.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    const lineas: string[] = [`## ${p.nombre}`]
    for (const dia of Array.from(p.dias.keys()).sort()) {
      lineas.push(`### ${formatReportDate(dia)}`)
      for (const e of p.dias.get(dia)!) {
        const etiqueta = CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? e.category
        const abierto = e.category === 'bloqueo' && !e.resolved_at
        if (abierto) bloqueosAbiertos += 1
        const estado = e.category === 'bloqueo' ? (e.resolved_at ? ' [ya resuelto]' : ' [SIGUE ABIERTO]') : ''
        const tarea = e.task?.title ? ` (tarea: ${e.task.title})` : ''
        lineas.push(`- (${etiqueta})${estado} ${e.content}${tarea}`)
      }
    }
    bloques.push(lineas.join('\n'))
  }

  return {
    bloques,
    totalActividades: entries.length,
    totalPersonas: porPersona.size,
    bloqueosAbiertos,
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
- Si el material es pobre, el reporte es corto. Un reporte de tres líneas honesto vale más que uno de dos páginas relleno.
- Nunca uses guiones largos (— o –). Usa punto, coma, dos puntos o paréntesis.
- Español correcto, con ñ y tildes.
- Nada de emojis.
- Tono ejecutivo y directo, sin frases de relleno tipo "en el marco de" o "cabe destacar".

Estructura de tu respuesta (Markdown, sin repetir el título del periodo):

## Resumen
Dos a cuatro frases con lo que de verdad pasó en el periodo. Conclusión primero.

## Lo que se avanzó
Viñetas agrupadas por tema, no por día. Si varias entradas son del mismo trabajo, únelas en una sola viñeta.

## Bloqueos
Solo los que siguen abiertos, cada uno con desde cuándo y a quién detiene. Si no hay ninguno abierto, escribe una sola línea diciéndolo.

## Lo que sigue
Lo que la propia bitácora registró como siguiente. Si no se registró nada, dilo en una línea y no propongas tareas por tu cuenta.

Si el reporte cubre a varias personas, dentro de "Lo que se avanzó" agrupa por persona con negritas.`

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
    'Bitácora cruda:',
    '',
    material.bloques.join('\n\n'),
  ].join('\n')

  const { text } = await generateText({
    model: geminiFlash,
    system: DIGEST_SYSTEM,
    prompt,
    temperature: 0.3,
  })

  // Cinturon y tirantes contra el guion largo: la regla esta en el prompt, pero
  // un modelo la rompe de vez en cuando y el reporte se manda tal cual.
  const limpio = text.replace(/\s?[—–]\s?/g, ', ').trim()

  return { content: limpio, totalActividades: material.totalActividades }
}
