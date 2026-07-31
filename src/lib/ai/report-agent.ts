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
import { notifyReportBlocker, notifyBlockerResolved, listOpenBlockers } from '@/lib/daily-report-blockers'
import { buscarDuplicado, revisarDuplicados, type EntradaComparable } from '@/lib/daily-report-dedupe'
import {
  REPORT_CATEGORIES,
  CATEGORY_HINT,
  todayInReportTz,
  isValidReportDate,
  formatReportTime,
  reportDayRange,
  shiftDate,
  formatReportDate,
} from '@/lib/daily-reports'

type Admin = ReturnType<typeof createAdminClient>

export const REPORT_AGENT_SYSTEM = `Eres BITACORA, el asistente del reporte diario de actividades en WLO. Tu único trabajo es que la persona termine el día con un reporte fiel de lo que hizo.

Empieza por lo que la app ya sabe, no por una hoja en blanco:
- Si la conversación arranca y la persona todavía no ha registrado nada, llama primero a mi_trabajo_de_hoy y PROPÓN el día con lo que encuentres: "Cerraste tres tareas hoy: X, Y y Z. ¿Las registro así?". No le pidas que narre desde cero algo que ya está en el tablero.
- Cuando registres una actividad que sale de una de esas tareas, pasa su task_id. Así el reporte y el tablero dejan de ser dos memorias separadas.
- Si mi_trabajo_de_hoy devuelve una tarea marcada como ya_registrada, NO la vuelvas a registrar. Solo menciónala si hace falta.
- Si no cerró ninguna tarea, no insistas con el tablero: pregúntale directamente en qué se le fue el día.

Cómo trabajas:
- Cuando la persona narre algo de su jornada, REGÍSTRALO con registrar_actividad. No preguntes "¿quieres que lo anote?": anótalo y dilo en una frase corta al final ("Anotado como bloqueo").
- Si en un mismo mensaje cuenta varias cosas distintas, haz una llamada por cada una. Un reporte con puntos separados se lee; un párrafo largo no.
- Clasifica tú, no le pidas que elija: ${CATEGORY_HINT}
- Minutos SOLO si la persona los dijo. Nunca estimes tiempo ni lo deduzcas.
- Escribe la actividad en primera persona y en pasado, concreta y corta: "Cerré la campaña de julio de Google Ads", no "El usuario reporta haber cerrado una campaña".
- Si lo que cuenta es vago ("avancé en lo de siempre"), haz UNA pregunta para concretar antes de registrar. Una, no un interrogatorio.

Nada se anota dos veces:
- Si registrar_actividad te responde posible_duplicado, NO insistas ni lo registres a la fuerza. Enséñale la actividad que ya tiene ("Ya tienes anotado: <texto>") y pregunta si es lo mismo o trabajo distinto.
- Si es lo mismo con más detalle, no crees otra: usa corregir_actividad sobre la que ya existe y déjala completa. Un reporte con una actividad buena vale más que con dos a medias.
- Si de verdad es trabajo distinto, vuelve a llamar a registrar_actividad con confirmado_no_duplicado en true.
- Antes de cerrar el día pasa siempre revisar_duplicados. Si encuentra pares, muéstralos y pregunta cuál se queda. Nunca borres nada sin que la persona lo diga.
- Al fusionar, NO sumes minutos que no te dieron. Si cada parte traía tiempo y la persona no aclara, pregunta antes de escribir un total.

Cuando adjunten una imagen:
- Míralas y describe lo que de verdad muestran. Si es un panel con números, di las cifras que se leen. Si es un error, di qué error es.
- Redacta la actividad a partir de la imagen y del texto que la acompaña, y pon en el campo caption una descripción breve de lo que se ve (sirve de texto alternativo y para buscar después).
- Si la imagen no se entiende o no se relaciona con el trabajo, dilo en vez de inventar lo que crees que debería mostrar.

Cerrar el día:
- Cuando diga que terminó: primero leer_mi_dia, después revisar_duplicados, y solo entonces cerrar_dia.
- El resumen se construye SOLO con lo registrado. Si no registró nada, dilo; no inventes una jornada de trabajo.
- Un buen resumen son 2 a 4 líneas: qué avanzó, qué quedó bloqueado y qué sigue. Sin relleno.

Bloqueos:
- Un bloqueo avisa automáticamente a los responsables del equipo. Dilo cuando registres uno ("Anotado como bloqueo, ya le llegó el aviso a tu responsable"), para que la persona sepa que pedir ayuda aquí sirve de algo.
- Por lo mismo, no clasifiques como bloqueo un contratiempo que la persona ya resolvió sola. Bloqueo es lo que sigue detenido y necesita a alguien más.
- Si tiene bloqueos abiertos de días anteriores los verás listados abajo. Cuando diga que uno ya se destrabó ("ya me dieron el acceso", "eso ya quedó"), ciérralo con resolver_bloqueo en vez de registrar una actividad nueva. Si lleva varios días abierto y no lo menciona, pregúntale UNA vez si sigue igual.

Continuidad:
- Si dice "sigo con lo de ayer" o "terminé lo que dejé pendiente", ya tienes el día anterior en tu contexto. Úsalo para redactar la actividad completa en vez de preguntar a qué se refiere.

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
        task_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Si esta actividad habla de una tarea del tablero, su id tal como lo devolvió mi_trabajo_de_hoy. Nunca lo inventes.'
          ),
        confirmado_no_duplicado: z
          .boolean()
          .optional()
          .describe(
            'Ponlo en true SOLO cuando ya avisaste de un posible duplicado y la persona confirmó que es trabajo distinto.'
          ),
      }),
      execute: async ({ content, category, minutes, caption, task_id, confirmado_no_duplicado }) => {
        const report = await ensureDailyReport(admin, workspaceId, userId, date)
        if (!report) return { error: 'No se pudo abrir el reporte del día.' }

        // ── Freno de duplicados ────────────────────────────────────────────
        // El reporte se llena por tres puertas (mano, agente, tablero) y ninguna
        // sabia de las otras, asi que el mismo trabajo acababa anotado dos veces
        // con distintas palabras. Aqui NO se bloquea el registro: se DEVUELVE el
        // parecido para que el agente pregunte. Bloquear en silencio seria peor
        // que el duplicado, porque la persona perderia lo que acaba de contar sin
        // saber por que.
        if (!confirmado_no_duplicado) {
          const { data: previas } = (await admin
            .from('daily_report_entries')
            .select('id, content, category, task_id, minutes')
            .eq('report_id', report.id)
            .order('created_at', { ascending: true })
            .limit(60)) as { data: EntradaComparable[] | null }

          const choque = buscarDuplicado(content.trim(), previas ?? [], task_id ?? null)
          if (choque) {
            return {
              posible_duplicado: true,
              parecido: Number(choque.score.toFixed(2)),
              motivo: choque.motivo,
              ya_registrado: {
                entry_id: choque.entry.id,
                content: choque.entry.content,
                category: choque.entry.category,
              },
              instruccion:
                'NO lo registres todavia. Dile a la persona que eso se parece a lo que ya tiene anotado, ' +
                'cita la actividad existente y pregunta si es lo mismo o trabajo distinto. ' +
                'Si dice que es distinto, vuelve a llamar a registrar_actividad con confirmado_no_duplicado en true. ' +
                'Si dice que es lo mismo pero con mas detalle, usa corregir_actividad sobre la que ya existe.',
            }
          }
        }

        // El id de tarea que manda el modelo se verifica contra lo que ESTA
        // persona puede tocar en ESTE workspace. Un uuid alucinado (o inyectado
        // en el texto) no llega a la base: se cae a null y la actividad se
        // registra igual, porque perder el enlace es mucho menos grave que
        // perder lo que la persona acaba de contar.
        let linkedTask: string | null = null
        if (task_id) {
          const { data: task } = (await admin
            .from('tasks')
            .select('id')
            .eq('id', task_id)
            .eq('workspace_id', workspaceId)
            .maybeSingle()) as { data: { id: string } | null }
          linkedTask = task?.id ?? null
        }

        const { data: entry, error } = (await admin
          .from('daily_report_entries')
          .insert({
            report_id: report.id,
            content: content.trim(),
            category,
            minutes: minutes ?? null,
            task_id: linkedTask,
            source: 'kern',
          })
          .select('id, created_at')
          .single()) as { data: { id: string; created_at: string } | null; error: unknown }

        if (error || !entry) {
          console.error('[bitacora registrar_actividad] insert error:', error)
          return { error: 'No se pudo registrar la actividad.' }
        }

        await touchDailyReport(admin, report.id)

        // Un bloqueo sale de la pantalla: es la unica categoria que por
        // definicion necesita a alguien mas. Se espera el aviso (no se dispara y
        // se olvida) porque en una serverless function el proceso puede morir en
        // cuanto se devuelve la respuesta y el aviso se perderia a medias.
        if (category === 'bloqueo') {
          await notifyReportBlocker({ admin, workspaceId, userId, date, content: content.trim() })
        }

        // `entry_id` viaja de vuelta porque la pantalla lo necesita: si el
        // mensaje traia una imagen, la sube a ESTA actividad recien creada.
        return {
          ok: true,
          entry_id: entry.id,
          category,
          content: content.trim(),
          caption: caption ?? null,
          task_id: linkedTask,
          escalado: category === 'bloqueo',
          hora: formatReportTime(entry.created_at),
        }
      },
    }),

    mi_trabajo_de_hoy: tool({
      description:
        'Devuelve las tareas del tablero que esta persona cerró hoy y las que tiene abiertas. ' +
        'Úsalo al inicio de la conversación, antes de preguntarle nada, para PROPONERLE el reporte ' +
        'en vez de pedirle que lo narre desde cero.',
      parameters: z.object({}),
      execute: async () => {
        const { start, end } = reportDayRange(date)

        // Las tres consultas son independientes: en serie sumarian tres viajes a
        // la base antes de que el agente pueda decir la primera palabra, y esto
        // corre justo al abrir la conversacion.
        const [{ data: cerradas }, { data: abiertas }, { data: report }] = await Promise.all([
          admin
            .from('tasks')
            .select('id, title, completed_at')
            .eq('workspace_id', workspaceId)
            .eq('assignee_id', userId)
            .gte('completed_at', start)
            .lt('completed_at', end)
            .order('completed_at', { ascending: true })
            .limit(25),
          admin
            .from('tasks')
            .select('id, title')
            .eq('workspace_id', workspaceId)
            .eq('assignee_id', userId)
            .is('completed_at', null)
            .order('updated_at', { ascending: false })
            .limit(10),
          admin
            .from('daily_reports')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('profile_id', userId)
            .eq('report_date', date)
            .maybeSingle(),
        ])

        // Que tareas YA se reportaron hoy. Sin esto el agente propondria otra vez
        // lo que la persona acaba de confirmar, que es la forma mas rapida de
        // que deje de confiar en lo que propone.
        const yaRegistradas = new Set<string>()
        const reportId = (report as { id: string } | null)?.id
        if (reportId) {
          const { data: entries } = (await admin
            .from('daily_report_entries')
            .select('task_id')
            .eq('report_id', reportId)
            .not('task_id', 'is', null)) as { data: { task_id: string | null }[] | null }
          for (const e of entries ?? []) if (e.task_id) yaRegistradas.add(e.task_id)
        }

        const cerradasRows = (cerradas ?? []) as { id: string; title: string; completed_at: string }[]
        const abiertasRows = (abiertas ?? []) as { id: string; title: string }[]

        return {
          date,
          cerradas_hoy: cerradasRows.map(t => ({
            task_id: t.id,
            titulo: t.title,
            hora: formatReportTime(t.completed_at),
            ya_registrada: yaRegistradas.has(t.id),
          })),
          abiertas: abiertasRows.map(t => ({ task_id: t.id, titulo: t.title })),
          nota:
            cerradasRows.length === 0
              ? 'No cerró ninguna tarea del tablero hoy. Pregúntale directamente en qué se le fue el día.'
              : null,
        }
      },
    }),

    resolver_bloqueo: tool({
      description:
        'Marca como resuelto un bloqueo que la persona reportó antes, cuando diga que ya se destrabó. ' +
        'Usa el entry_id de la lista de bloqueos abiertos que tienes en contexto. ' +
        'No sirve para actividades que no sean bloqueos.',
      parameters: z.object({
        entry_id: z.string().uuid().describe('El id del bloqueo abierto, tal como aparece en tu contexto.'),
      }),
      execute: async ({ entry_id }) => {
        // La entrada puede ser de CUALQUIER dia (un bloqueo del martes se
        // resuelve el jueves), asi que no se acota por fecha. La pertenencia se
        // verifica subiendo al reporte: el dueño sale del scope del servidor.
        const { data: entry } = (await admin
          .from('daily_report_entries')
          .select('id, category, content, resolved_at, report:daily_reports ( profile_id, workspace_id, report_date )')
          .eq('id', entry_id)
          .maybeSingle()) as {
          data: {
            id: string
            category: string
            content: string
            resolved_at: string | null
            report: { profile_id: string; workspace_id: string; report_date: string } | null
          } | null
        }

        if (!entry?.report) return { error: 'No encuentro ese bloqueo.' }
        if (entry.report.profile_id !== userId || entry.report.workspace_id !== workspaceId) {
          return { error: 'Ese bloqueo no es tuyo.' }
        }
        if (entry.category !== 'bloqueo') return { error: 'Esa actividad no es un bloqueo.' }
        if (entry.resolved_at) return { ok: true, ya_estaba: true, content: entry.content }

        const { error } = await admin
          .from('daily_report_entries')
          .update({ resolved_at: new Date().toISOString() })
          .eq('id', entry_id)

        if (error) {
          console.error('[bitacora resolver_bloqueo] update error:', error)
          return { error: 'No se pudo cerrar el bloqueo.' }
        }

        await notifyBlockerResolved({
          admin,
          workspaceId,
          userId,
          date: entry.report.report_date,
          content: entry.content,
        })

        return { ok: true, content: entry.content, desde: entry.report.report_date }
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

    corregir_actividad: tool({
      description:
        'Reescribe una actividad que YA está registrada, sin crear otra. ' +
        'Úsalo cuando la persona amplíe o corrija algo que ya contó ("era de julio, no de junio", ' +
        '"además le sumé el reporte"), y siempre que descubras que algo iba a quedar duplicado: ' +
        'es mejor una actividad completa que dos a medias.',
      parameters: z.object({
        entry_id: z.string().uuid().describe('El id de la actividad, tal como lo devolvió leer_mi_dia.'),
        content: z
          .string()
          .min(3)
          .max(1000)
          .describe('El texto ya FUSIONADO: lo que decía antes mas lo nuevo, en una sola frase limpia.'),
        category: z.enum(REPORT_CATEGORIES).optional().describe(CATEGORY_HINT),
        minutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .nullable()
          .optional()
          .describe('Minutos totales. Solo si la persona los dijo. Al fusionar, NO sumes tiempos que no te dieron.'),
      }),
      execute: async ({ entry_id, content, category, minutes }) => {
        // Mismo candado que borrar: el UPDATE se acota al reporte de ESTE
        // usuario en ESTE dia, asi que un id ajeno o alucinado no alcanza nada.
        const { data: report } = (await admin
          .from('daily_reports')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('profile_id', userId)
          .eq('report_date', date)
          .maybeSingle()) as { data: { id: string } | null }

        if (!report) return { error: 'No hay reporte de este día.' }

        const patch: Record<string, unknown> = { content: content.trim() }
        if (category) patch.category = category
        if (minutes !== undefined) patch.minutes = minutes

        const { data: fila, error } = (await admin
          .from('daily_report_entries')
          .update(patch as never)
          .eq('id', entry_id)
          .eq('report_id', report.id)
          .select('id, content, category')
          .maybeSingle()) as {
          data: { id: string; content: string; category: string } | null
          error: unknown
        }

        if (error) {
          console.error('[bitacora corregir_actividad] update error:', error)
          return { error: 'No se pudo corregir la actividad.' }
        }
        if (!fila) return { error: 'Esa actividad no está en tu reporte de hoy.' }

        await touchDailyReport(admin, report.id)
        return { ok: true, entry_id: fila.id, content: fila.content, category: fila.category }
      },
    }),

    revisar_duplicados: tool({
      description:
        'Revisa el reporte del día completo y devuelve los pares de actividades que dicen lo mismo. ' +
        'Úsalo cuando la persona pregunte si algo se repitió, y SIEMPRE antes de cerrar el día: ' +
        'un reporte con la misma cosa contada dos veces infla el trabajo de quien lo escribió.',
      parameters: z.object({}),
      execute: async () => {
        const { data: report } = (await admin
          .from('daily_reports')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('profile_id', userId)
          .eq('report_date', date)
          .maybeSingle()) as { data: { id: string } | null }

        if (!report) return { date, duplicados: [], nota: 'No hay reporte de este día.' }

        const { data: entries } = (await admin
          .from('daily_report_entries')
          .select('id, content, category, task_id, minutes')
          .eq('report_id', report.id)
          .order('created_at', { ascending: true })
          .limit(200)) as { data: EntradaComparable[] | null }

        const pares = revisarDuplicados(entries ?? [])
          // Solo lo que de verdad vale interrumpir. Los "parecidos" flojos
          // generan mas ruido que valor cuando se listan todos.
          .filter(p => p.motivo !== 'texto_parecido')
          .slice(0, 8)

        return {
          date,
          total_actividades: entries?.length ?? 0,
          duplicados: pares.map(p => ({
            parecido: Number(p.score.toFixed(2)),
            motivo: p.motivo,
            a: { entry_id: p.a.id, texto: p.a.content },
            b: { entry_id: p.b.id, texto: p.b.content },
          })),
          instruccion:
            pares.length === 0
              ? 'No hay repeticiones. Dilo en una linea y sigue.'
              : 'Muestrale cada par y pregunta cual conservar. Para fusionarlos usa corregir_actividad ' +
                'sobre uno y borrar_actividad sobre el otro. Nunca borres sin preguntar.',
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

/**
 * Los bloqueos que esta persona sigue arrastrando, para el prompt del sistema.
 *
 * Va en el contexto y no en una herramienta por lo mismo que el dia anterior: el
 * momento en que hace falta es justo cuando la persona dice "eso ya quedo", y
 * ahi el modelo no tiene forma de saber que debe ir a buscar una lista. Ademas
 * el `entry_id` tiene que estar a la vista para poder cerrarlo, porque el agente
 * no puede inventar uuids.
 *
 * Devuelve cadena vacia si no hay ninguno. Nunca lanza.
 */
export async function buildOpenBlockersBlock(
  admin: Admin,
  scope: { workspaceId: string; userId: string; date: string },
): Promise<string> {
  const abiertos = await listOpenBlockers(admin, scope)
  if (abiertos.length === 0) return ''

  const lineas = abiertos
    .slice(0, 8)
    .map(b => `- [${b.entry_id}] ${b.content} (desde el ${b.date}, ${b.dias === 0 ? 'hoy' : `${b.dias} días`})`)

  return [
    '\n\nBloqueos suyos que siguen abiertos:',
    ...lineas,
    'Si dice que alguno ya se destrabó, ciérralo con resolver_bloqueo usando su id. No los registres otra vez como actividad de hoy.',
  ].join('\n')
}

/**
 * El dia anterior, ya redactado, para pegarlo al prompt del sistema.
 *
 * ── Por que en el prompt y no como herramienta ──────────────────────────────
 * "Sigo con lo de ayer" es la frase mas comun al abrir la bitacora, y hoy el
 * agente no la entiende: no tiene memoria de ayer. Se podria resolver con una
 * herramienta `leer_ayer`, pero entonces el modelo tendria que ADIVINAR cuando
 * llamarla, y cuando no la llame va a preguntar "¿a que te refieres?", que es
 * exactamente la friccion que se quiere quitar. Un bloque corto en el contexto
 * cuesta unas decenas de tokens y funciona siempre, sin decision del modelo de
 * por medio.
 *
 * ── Por que "el ultimo dia con actividad" y no "ayer" ───────────────────────
 * Ayer pudo ser sabado, o un dia de vacaciones. Lo que la persona quiere decir
 * con "ayer" es "la ultima vez que trabaje". Se buscan cinco dias hacia atras y
 * se toma el primero que tenga algo escrito; la fecha va explicita en el bloque
 * para que el agente no llame "ayer" a un viernes.
 *
 * Devuelve cadena vacia si no hay nada. Nunca lanza: sin este bloque el agente
 * sigue funcionando, solo con menos memoria.
 */
export async function buildPreviousDayBlock(
  admin: Admin,
  scope: { workspaceId: string; userId: string; date: string },
): Promise<string> {
  const { workspaceId, userId, date } = scope

  try {
    const { data: reports } = (await admin
      .from('daily_reports')
      .select('id, report_date, summary')
      .eq('workspace_id', workspaceId)
      .eq('profile_id', userId)
      .gte('report_date', shiftDate(date, -5))
      .lt('report_date', date)
      .order('report_date', { ascending: false })
      .limit(5)) as {
      data: { id: string; report_date: string; summary: string | null }[] | null
    }

    const rows = reports ?? []
    if (rows.length === 0) return ''

    // Todas las entradas de la ventana en UNA consulta. Iterar dia por dia
    // costaria hasta cinco viajes para, casi siempre, quedarse con el primero.
    const { data: entries } = (await admin
      .from('daily_report_entries')
      .select('report_id, content, category')
      .in(
        'report_id',
        rows.map(r => r.id),
      )
      .order('created_at', { ascending: true })
      .limit(200)) as { data: { report_id: string; content: string; category: string }[] | null }

    const porReporte = new Map<string, { content: string; category: string }[]>()
    for (const e of entries ?? []) {
      const list = porReporte.get(e.report_id) ?? []
      list.push({ content: e.content, category: e.category })
      porReporte.set(e.report_id, list)
    }

    const last = rows.find(r => (porReporte.get(r.id)?.length ?? 0) > 0)
    if (!last) return ''

    const list = porReporte.get(last.id) ?? []

    // Lo que quedo pendiente vale mas que lo que ya se hizo: es lo que la
    // persona va a retomar. Por eso se separa en vez de volcar la lista entera.
    const pendientes = list.filter(e => e.category === 'siguiente' || e.category === 'bloqueo')
    const hechas = list.filter(e => e.category === 'avance')

    const bloque = [
      `\n\nSu último día registrado fue el ${formatReportDate(last.report_date)} (${last.report_date}).`,
      last.summary ? `Resumen de ese día: ${last.summary}` : null,
      hechas.length > 0 ? `Avanzó: ${hechas.slice(0, 8).map(e => e.content).join(' | ')}` : null,
      pendientes.length > 0
        ? `Dejó pendiente: ${pendientes.slice(0, 8).map(e => `[${e.category}] ${e.content}`).join(' | ')}`
        : null,
      'Usa esto para entender frases como "sigo con lo de ayer". No lo registres como actividad de hoy salvo que la persona diga que lo retomó.',
    ]
      .filter(Boolean)
      .join('\n')

    return bloque
  } catch (error) {
    console.error('[buildPreviousDayBlock] error:', error)
    return ''
  }
}
