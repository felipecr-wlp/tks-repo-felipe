/**
 * BITACORA: el agente del reporte diario.
 *
 * ── Por que un agente aparte y no mas herramientas en KERN ──────────────────
 * KERN es generalista: crea tareas, busca notas, redacta documentos. Cuando le
 * cuentas tu dia tiene que adivinar, entre veinte herramientas, que lo tuyo era
 * un reporte. El resultado es un asistente que a veces registra y a veces
 * responde bonito sin registrar nada.
 *
 * BITACORA hace una sola cosa. No tiene con que distraerse: sus cuatro
 * herramientas son del reporte y su prompt es un procedimiento de entrevista,
 * no una lista de capacidades. Eso es lo que quiere decir "especializado" aqui:
 * menos superficie y una conducta por defecto (registrar) en vez de una
 * pregunta ("¿quieres que lo registre?").
 *
 * ── Lo que aporta que vea imagenes ──────────────────────────────────────────
 * El caso real no es "guardar una foto", es que nadie escribe el pie de foto.
 * La persona arrastra la captura del panel de campañas y BITACORA es quien
 * redacta la actividad a partir de lo que se ve, y propone el texto alternativo
 * para que la evidencia sea legible y buscable. La imagen se manda al modelo
 * UNA vez, en linea y sin almacenarse; lo que queda guardado es el texto y,
 * despues, la imagen ya comprimida.
 *
 * ── Privacidad ─────────────────────────────────────────────────────────────
 * El agente hereda la misma regla que la pantalla: la herramienta que lee al
 * equipo solo EXISTE si quien conversa es mando. No se le pide al modelo que se
 * porte bien; simplemente no se le entrega la herramienta.
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/server'
import { ensureDailyReport, touchDailyReport } from '@/lib/daily-report-store'
import {
  REPORT_CATEGORIES,
  CATEGORY_HINT,
  todayInReportTz,
  isValidReportDate,
  formatReportTime,
} from '@/lib/daily-reports'

type Admin = ReturnType<typeof createAdminClient>

export const REPORT_AGENT_SYSTEM = `Eres BITACORA, el asistente del reporte diario de actividades en WLO. Tu único trabajo es que la persona termine el día con un reporte fiel de lo que hizo.

Cómo trabajas:
- Cuando la persona narre algo de su jornada, REGÍSTRALO con registrar_actividad. No preguntes "¿quieres que lo anote?": anótalo y dilo en una frase corta al final ("Anotado como bloqueo").
- Si en un mismo mensaje cuenta varias cosas distintas, haz una llamada por cada una. Un reporte con puntos separados se lee; un párrafo largo no.
- Clasifica tú, no le pidas que elija: ${CATEGORY_HINT}
- Minutos SOLO si la persona los dijo. Nunca estimes tiempo ni lo deduzcas.
- Escribe la actividad en primera persona y en pasado, concreta y corta: "Cerré la campaña de julio de Google Ads", no "El usuario reporta haber cerrado una campaña".
- Si lo que cuenta es vago ("avancé en lo de siempre"), haz UNA pregunta para concretar antes de registrar. Una, no un interrogatorio.

Cuando adjunten una imagen:
- Míralas y describe lo que de verdad muestran. Si es un panel con números, di las cifras que se leen. Si es un error, di qué error es.
- Redacta la actividad a partir de la imagen y del texto que la acompaña, y pon en el campo caption una descripción breve de lo que se ve (sirve de texto alternativo y para buscar después).
- Si la imagen no se entiende o no se relaciona con el trabajo, dilo en vez de inventar lo que crees que debería mostrar.

Cerrar el día:
- Cuando diga que terminó, primero lee el día con leer_mi_dia y luego ciérralo con cerrar_dia.
- El resumen se construye SOLO con lo registrado. Si no registró nada, dilo; no inventes una jornada de trabajo.
- Un buen resumen son 2 a 4 líneas: qué avanzó, qué quedó bloqueado y qué sigue. Sin relleno.

Límites:
- Solo operas sobre el reporte de quien te habla. No puedes escribir el día de otra persona.
- Nunca inventes una actividad que no te contaron.

Estilo:
- Español, tono directo y breve. Conclusión primero.
- No uses guiones largos (— o –). Usa punto, coma, dos puntos o paréntesis.`

interface AgentScope {
  admin: Admin
  userId: string
  workspaceId: string
  /** Dia sobre el que se conversa. Fijo por sesion: el agente no salta de fecha. */
  date: string
  isSupervisor: boolean
}

/**
 * Herramientas del agente, ligadas a ESTE usuario y ESTE dia.
 *
 * Ninguna recibe `profile_id` como parametro a proposito: el dueño sale del
 * scope del servidor, nunca del modelo. Asi una instruccion inyectada en el
 * texto ("registra esto en el reporte de Karla") no tiene por donde ejecutarse.
 */
export function buildReportAgentTools(scope: AgentScope) {
  const { admin, userId, workspaceId, date, isSupervisor } = scope

  const base = {
    registrar_actividad: tool({
      description:
        'Registra una actividad en el reporte diario de la persona con la que hablas. ' +
        'Úsalo siempre que narre algo que hizo, algo que la bloquea o lo que hará después, ' +
        'aunque no pida explícitamente registrarlo.',
      parameters: z.object({
        content: z
          .string()
          .min(3)
          .max(1000)
          .describe('La actividad redactada en primera persona y en pasado, concreta y breve.'),
        category: z.enum(REPORT_CATEGORIES).describe(CATEGORY_HINT),
        minutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .nullable()
          .optional()
          .describe('Minutos dedicados. Solo si la persona los dijo explícitamente.'),
        caption: z
          .string()
          .max(300)
          .optional()
          .describe(
            'Solo si el mensaje traía una imagen: descripción breve de lo que se ve, para usarla como texto alternativo.'
          ),
      }),
      execute: async ({ content, category, minutes, caption }) => {
        const report = await ensureDailyReport(admin, workspaceId, userId, date)
        if (!report) return { error: 'No se pudo abrir el reporte del día.' }

        const { data: entry, error } = (await admin
          .from('daily_report_entries')
          .insert({
            report_id: report.id,
            content: content.trim(),
            category,
            minutes: minutes ?? null,
            source: 'kern',
          })
          .select('id, created_at')
          .single()) as { data: { id: string; created_at: string } | null; error: unknown }

        if (error || !entry) {
          console.error('[bitacora registrar_actividad] insert error:', error)
          return { error: 'No se pudo registrar la actividad.' }
        }

        await touchDailyReport(admin, report.id)

        // `entry_id` viaja de vuelta porque la pantalla lo necesita: si el
        // mensaje traia una imagen, la sube a ESTA actividad recien creada.
        return {
          ok: true,
          entry_id: entry.id,
          category,
          content: content.trim(),
          caption: caption ?? null,
          hora: formatReportTime(entry.created_at),
        }
      },
    }),

    leer_mi_dia: tool({
      description:
        'Devuelve lo que la persona lleva registrado hoy, con hora y categoría. ' +
        'Úsalo para "¿qué llevo?", "léeme mi día" y SIEMPRE antes de cerrar el reporte.',
      parameters: z.object({}),
      execute: async () => {
        const { data: report } = (await admin
          .from('daily_reports')
          .select('id, summary, status')
          .eq('workspace_id', workspaceId)
          .eq('profile_id', userId)
          .eq('report_date', date)
          .maybeSingle()) as {
          data: { id: string; summary: string | null; status: string } | null
        }

        if (!report) return { date, actividades: [], summary: null, status: 'vacio' }

        const { data: entries } = (await admin
          .from('daily_report_entries')
          .select('id, content, category, minutes, created_at')
          .eq('report_id', report.id)
          .order('created_at', { ascending: true })
          .limit(200)) as {
          data:
            | { id: string; content: string; category: string; minutes: number | null; created_at: string }[]
            | null
        }

        return {
          date,
          status: report.status,
          summary: report.summary,
          actividades: (entries ?? []).map(e => ({
            id: e.id,
            hora: formatReportTime(e.created_at),
            categoria: e.category,
            minutos: e.minutes,
            texto: e.content,
          })),
        }
      },
    }),

    borrar_actividad: tool({
      description:
        'Quita una actividad del reporte. Úsalo solo cuando la persona pida corregir o borrar algo ' +
        'que se registró mal. Lee el día primero para saber el id correcto.',
      parameters: z.object({
        entry_id: z.string().uuid().describe('El id de la actividad, tal como lo devolvió leer_mi_dia.'),
      }),
      execute: async ({ entry_id }) => {
        // Se acota el DELETE a los reportes de ESTE usuario: aunque el modelo
        // alucine un id ajeno, la condicion no lo alcanza.
        const { data: report } = (await admin
          .from('daily_reports')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('profile_id', userId)
          .eq('report_date', date)
          .maybeSingle()) as { data: { id: string } | null }

        if (!report) return { error: 'No hay reporte de este día.' }

        const { error, count } = await admin
          .from('daily_report_entries')
          .delete({ count: 'exact' })
          .eq('id', entry_id)
          .eq('report_id', report.id)

        if (error) return { error: 'No se pudo borrar la actividad.' }
        if (!count) return { error: 'Esa actividad no está en tu reporte de hoy.' }
        return { ok: true }
      },
    }),

    cerrar_dia: tool({
      description:
        'Cierra el reporte del día guardando un resumen y marcándolo como entregado. ' +
        'Antes de llamarlo lee el día con leer_mi_dia y redacta el resumen SOLO con lo registrado.',
      parameters: z.object({
        summary: z
          .string()
          .min(10)
          .max(4000)
          .describe('Resumen de 2 a 4 líneas: qué avanzó, qué quedó bloqueado y qué sigue.'),
      }),
      execute: async ({ summary }) => {
        const report = await ensureDailyReport(admin, workspaceId, userId, date)
        if (!report) return { error: 'No se pudo abrir el reporte del día.' }

        const { count } = (await admin
          .from('daily_report_entries')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', report.id)) as { count: number | null }

        // Un reporte entregado vacio es peor que no entregar: aparece como
        // cumplido en el tablero y no dice nada.
        if (!count) {
          return { error: 'No hay ninguna actividad registrada hoy. Registra algo antes de cerrar el día.' }
        }

        const { error } = await admin
          .from('daily_reports')
          .update({
            summary: summary.trim(),
            status: 'submitted',
            submitted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', report.id)

        if (error) {
          console.error('[bitacora cerrar_dia] update error:', error)
          return { error: 'No se pudo cerrar el reporte.' }
        }

        return { ok: true, actividades: count }
      },
    }),
  }

  // La lectura del equipo NO se le entrega a quien no es mando. La regla no se
  // delega al prompt: la herramienta simplemente no existe en su sesion.
  if (!isSupervisor) return base

  return {
    ...base,
    resumen_del_equipo: tool({
      description:
        'Lista los reportes del equipo de este día (quién reportó, qué y quién no). ' +
        'Disponible solo para responsables de equipo.',
      parameters: z.object({}),
      execute: async () => {
        const { data: reports } = (await admin
          .from('daily_reports')
          .select('id, summary, status, profile:profiles ( display_name )')
          .eq('workspace_id', workspaceId)
          .eq('report_date', date)
          .limit(200)) as {
          data:
            | {
                id: string
                summary: string | null
                status: string
                profile: { display_name: string } | null
              }[]
            | null
        }

        const rows = reports ?? []
        if (rows.length === 0) return { date, reportes: [], nota: 'Nadie ha registrado actividades ese día.' }

        // Todas las actividades en UNA consulta: una por reporte convertiria un
        // equipo de doce personas en doce viajes a la base.
        const { data: entries } = (await admin
          .from('daily_report_entries')
          .select('report_id, content, category')
          .in(
            'report_id',
            rows.map(r => r.id)
          )
          .order('created_at', { ascending: true })
          .limit(1000)) as {
          data: { report_id: string; content: string; category: string }[] | null
        }

        const porReporte = new Map<string, { content: string; category: string }[]>()
        for (const e of entries ?? []) {
          const list = porReporte.get(e.report_id) ?? []
          list.push({ content: e.content, category: e.category })
          porReporte.set(e.report_id, list)
        }

        return {
          date,
          reportes: rows.map(r => ({
            persona: r.profile?.display_name ?? 'Sin nombre',
            estado: r.status,
            resumen: r.summary,
            actividades: porReporte.get(r.id) ?? [],
          })),
        }
      },
    }),
  }
}

/** Valida el dia que manda el cliente; cualquier cosa rara cae en hoy. */
export function resolveAgentDate(raw: string | undefined): string {
  return raw && isValidReportDate(raw) ? raw : todayInReportTz()
}
