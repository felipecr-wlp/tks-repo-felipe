/**
 * Motor de automatizaciones (Circuito 3.B). "Cuando pase X, haz Y" sin codigo.
 *
 * Se invoca en los puntos de escritura de tareas (POST/PATCH de /api/tasks/**)
 * y en el cron de vencimientos. Carga las reglas activas del proyecto que
 * coinciden con el evento, evalua condiciones simples y ejecuta acciones.
 *
 * Diseno anti-loop: las acciones que mutan la tarea (asignar, mover de estado
 * o sprint) escriben DIRECTO con el admin client, NUNCA re-entran al motor.
 * Asi una regla no puede dispararse a si misma en cascada. Todo es best effort:
 * una regla que falla se registra y no tumba el flujo principal ni las demas.
 */
import { notify, NotificationTypes } from '@/lib/activity'
import { autoWatch } from '@/lib/watchers'

export type AutomationTrigger = 'status_changed' | 'assigned' | 'task_created' | 'due'

export type AutomationActionType =
  | 'assign' | 'move_status' | 'move_sprint' | 'notify' | 'chat_post' | 'emailer_enroll'
  | 'emailer_send_campaign'

export interface AutomationAction {
  type: AutomationActionType
  /** assign: a quien asignar. */
  assignee_id?: string | null
  /** move_status: estado destino. */
  status_id?: string | null
  /** move_sprint: sprint destino (null = sacar del sprint). */
  sprint_id?: string | null
  /** notify: destinatario. 'assignee' = el asignado actual de la tarea. */
  recipient_id?: string
  /** chat_post: texto a publicar. Se sustituye {tarea} por el titulo. */
  body?: string
  /** emailer_enroll: secuencia del Emailer de WLI. */
  sequence_id?: string | null
  /**
   * emailer_enroll: a quien enrolar. Puede ser una direccion fija o el token
   * `{email_tarea}`, que toma la PRIMERA direccion que aparezca en el titulo o
   * la descripcion de la tarea. Si el token no encuentra nada, no se enrola a
   * nadie: adivinar el destinatario de un correo de marketing no es una opcion.
   */
  email?: string
  /** emailer_send_campaign: nombre de la campana (default: titulo de la tarea). */
  campaign_title?: string | null
  /** emailer_send_campaign: asunto del correo. */
  campaign_subject?: string | null
  /** emailer_send_campaign: HTML de la campana que WLI va a publicar. */
  campaign_html?: string | null
  /** emailer_send_campaign: ID de la base (lista) a la que se envia. */
  campaign_list_id?: string | null
  /** emailer_send_campaign: si esta marcado, WLI publica y envia la campana de
   * inmediato. Sin marcar (default), WLI la crea en borrador sin enviar nada. */
  campaign_send?: boolean | null
}

export interface AutomationCondition {
  field: 'priority' | 'assignee_id' | 'status_id'
  op: 'eq' | 'neq'
  value: string | null
}

export interface AutomationTaskSnapshot {
  id: string
  project_id: string
  workspace_id: string
  title: string
  status_id: string | null
  assignee_id: string | null
  priority: string
  due_date: string | null
  sprint_id?: string | null
}

interface AutomationRow {
  id: string
  name: string
  trigger: AutomationTrigger
  trigger_config: { to_status_id?: string; to_assignee_id?: string } | null
  conditions: AutomationCondition[] | null
  actions: AutomationAction[] | null
  created_by: string | null
}

// ── Coincidencia del disparador (mas alla del tipo de evento) ───────────────
function triggerMatches(
  event: AutomationTrigger,
  config: AutomationRow['trigger_config'],
  task: AutomationTaskSnapshot,
): boolean {
  const cfg = config ?? {}
  if (event === 'status_changed' && cfg.to_status_id) {
    return task.status_id === cfg.to_status_id
  }
  if (event === 'assigned' && cfg.to_assignee_id) {
    return task.assignee_id === cfg.to_assignee_id
  }
  return true
}

// ── Condiciones (todas deben cumplirse; vacio = pasa) ───────────────────────
function conditionsPass(
  conditions: AutomationCondition[] | null,
  task: AutomationTaskSnapshot,
): boolean {
  const list = Array.isArray(conditions) ? conditions : []
  for (const c of list) {
    if (!c || !c.field) continue
    const actual =
      c.field === 'priority' ? task.priority :
      c.field === 'assignee_id' ? task.assignee_id :
      c.field === 'status_id' ? task.status_id : null
    const expected = c.value ?? null
    const equal = actual === expected
    if (c.op === 'neq' ? equal : !equal) return false
  }
  return true
}

// ── Destinatario de una accion de correo ────────────────────────────────────
const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

/**
 * Devuelve la direccion a la que enrolar, o null si no hay una CIERTA.
 *
 * Acepta dos formas: una direccion fija escrita en la regla, o el token
 * `{email_tarea}` que la saca del titulo o la descripcion de la tarea (el caso
 * real: tareas de seguimiento a un prospecto que llevan su correo escrito).
 *
 * Devolver null cuando no encuentra nada es la parte importante. La alternativa
 * seria caer al correo del asignado, y entonces mover una tarea de columna
 * meteria al propio equipo en una secuencia de marketing.
 */
async function resolverEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  configurado: string,
  task: AutomationTaskSnapshot,
): Promise<string | null> {
  const valor = (configurado ?? '').trim()
  if (!valor) return null

  if (!/\{email_tarea\}/i.test(valor)) {
    return RE_EMAIL.test(valor) ? valor.toLowerCase() : null
  }

  const enTitulo = task.title.match(RE_EMAIL)
  if (enTitulo) return enTitulo[0].toLowerCase()

  // La descripcion no viene en el snapshot: se pide solo si hizo falta.
  try {
    const { data } = (await admin
      .from('tasks')
      .select('description')
      .eq('id', task.id)
      .maybeSingle()) as { data: { description: string | null } | null }
    const enDescripcion = (data?.description ?? '').match(RE_EMAIL)
    return enDescripcion ? enDescripcion[0].toLowerCase() : null
  } catch {
    return null
  }
}

// ── Ejecucion de acciones de una regla ──────────────────────────────────────
async function runActions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  rule: AutomationRow,
  task: AutomationTaskSnapshot,
  actorId: string | null,
): Promise<void> {
  const actions = Array.isArray(rule.actions) ? rule.actions : []
  const nowIso = new Date().toISOString()

  for (const action of actions) {
    try {
      switch (action.type) {
        // ── Asignar la tarea a alguien ──────────────────────────────────────
        case 'assign': {
          const to = action.assignee_id ?? null
          if (!to || to === task.assignee_id) break
          await admin.from('tasks')
            .update({ assignee_id: to, updated_at: nowIso })
            .eq('id', task.id)
          task.assignee_id = to // reflejar para acciones/reglas posteriores
          autoWatch(admin, task.id, task.project_id, to).catch(console.error)
          if (to !== actorId) {
            notify({
              recipient_id: to,
              subject_id:   actorId ?? to,
              type:         NotificationTypes.TASK_ASSIGNED,
              object_type:  'task',
              object_id:    task.id,
              object_title: task.title,
              workspace_id: task.workspace_id,
            }).catch(console.error)
          }
          break
        }

        // ── Mover a otro estado (columna) ───────────────────────────────────
        case 'move_status': {
          const to = action.status_id ?? null
          if (!to || to === task.status_id) break
          // Defensa: el estado debe pertenecer a ESTE proyecto.
          const { data: st } = await admin.from('task_statuses')
            .select('id').eq('id', to).eq('project_id', task.project_id).maybeSingle()
          if (!st) break
          await admin.from('tasks')
            .update({ status_id: to, updated_at: nowIso })
            .eq('id', task.id)
          task.status_id = to
          break
        }

        // ── Mover a un sprint (o sacarlo si sprint_id null) ─────────────────
        case 'move_sprint': {
          const to = action.sprint_id ?? null
          if (to === (task.sprint_id ?? null)) break
          if (to) {
            const { data: sp } = await admin.from('sprints')
              .select('id').eq('id', to).maybeSingle()
            if (!sp) break
          }
          await admin.from('tasks')
            .update({ sprint_id: to, updated_at: nowIso })
            .eq('id', task.id)
          task.sprint_id = to
          break
        }

        // ── Avisar a alguien en su Bandeja ──────────────────────────────────
        case 'notify': {
          const raw = action.recipient_id
          const to = raw === 'assignee' ? task.assignee_id : (raw ?? null)
          if (!to) break
          notify({
            recipient_id: to,
            subject_id:   actorId ?? to,
            type:         NotificationTypes.AUTOMATION,
            object_type:  'task',
            object_id:    task.id,
            object_title: task.title,
            workspace_id: task.workspace_id,
          }).catch(console.error)
          break
        }

        // ── Publicar un mensaje en el chat del proyecto ─────────────────────
        case 'chat_post': {
          const author = actorId ?? rule.created_by
          if (!author) break // author_id es NOT NULL; sin autor no se puede
          const text = (action.body ?? '').replace(/\{tarea\}/gi, task.title).trim()
          if (!text) break
          await admin.from('project_messages').insert({
            project_id:   task.project_id,
            workspace_id: task.workspace_id,
            author_id:    author,
            body:         text.slice(0, 4000),
          })
          break
        }

        // ── Enrolar a alguien en una secuencia del Emailer de WLI ───────────
        // Es la primera accion que sale de WLO. Todo lo demas de este motor
        // escribe en la propia base; esta le habla a otra app y le manda correo
        // a una persona real, asi que es la unica con dos candados: el
        // complemento tiene que estar instalado en el workspace, y el
        // destinatario tiene que ser explicito.
        case 'emailer_enroll': {
          const secuencia = action.sequence_id ?? null
          if (!secuencia) break

          const destino = await resolverEmail(admin, action.email ?? '', task)
          if (!destino) break // sin direccion cierta no se manda nada

          const { callConnector } = await import('@/lib/connectors/outbound')
          const r = await callConnector({
            app: 'wli',
            action: 'emailer/enroll_contact',
            payload: {
              sequence_id: secuencia,
              email: destino,
              attributes: {
                origen: 'automatizacion wlo',
                tarea: task.title,
                tarea_id: task.id,
              },
            },
            admin,
            workspaceId: task.workspace_id,
          })
          if (!r.ok) console.error('[automations] emailer_enroll', rule.id, r.error)
          break
        }

        // ── Crear una campana en el Emailer de WLI ──────────────────────────
        // Segunda accion que sale de WLO. Manda el HTML de una campana a WLI
        // para que la arme y devuelva el reporte (estado, base y envios). La
        // base es opcional: si la regla no la fija, WLI crea la campana sin
        // lista y se elige despues. Por defecto WLI la deja en borrador SIN
        // enviar correo; solo si la regla marca `campaign_send` la publica y la
        // manda a la lista real. Riesgo alto a proposito: enviar dispara correo
        // a una lista real, por eso exige HTML explicito y no adivina nada.
        case 'emailer_send_campaign': {
          const html = (action.campaign_html ?? '').trim()
          if (!html) break
          const listId = (action.campaign_list_id ?? '').trim()

          const { callConnector } = await import('@/lib/connectors/outbound')
          const r = await callConnector({
            app: 'wli',
            action: 'emailer/create_campaign',
            payload: {
              title: (action.campaign_title ?? '').trim().slice(0, 160) || task.title.slice(0, 160),
              subject: (action.campaign_subject ?? '').trim().slice(0, 300) || undefined,
              html,
              ...(listId ? { list_id: listId } : {}),
              send: action.campaign_send === true,
              workspace_id: task.workspace_id,
              task_id: task.id,
              task_title: task.title,
            },
            admin,
            workspaceId: task.workspace_id,
          })

          const data = (r.data ?? {}) as {
            campaign_id?: unknown; status?: unknown; published_at?: unknown
            list_id?: unknown; list_name?: unknown; sent_count?: unknown
          }
          const reporte = {
            at: nowIso,
            ok: r.ok,
            campaign_id: data.campaign_id ?? null,
            status: data.status ?? null,
            published_at: data.published_at ?? null,
            list_id: data.list_id ?? listId,
            list_name: data.list_name ?? null,
            sent_count: data.sent_count ?? null,
            error: r.ok ? null : (r.error ?? 'sin detalle'),
          }
          await admin.from('automations')
            .update({ last_campaign_report: reporte })
            .eq('id', rule.id)
          if (!r.ok) console.error('[automations] emailer_send_campaign', rule.id, r.error)
          break
        }
      }
    } catch (e) {
      console.error('[automations] accion fallo', rule.id, action.type, e)
    }
  }
}

/**
 * Corre las reglas activas del proyecto que coinciden con el evento dado.
 * Best effort: nunca lanza.
 */
export async function runAutomations(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any
  event: AutomationTrigger
  task: AutomationTaskSnapshot
  actorId: string | null
}): Promise<void> {
  const { admin, event, task, actorId } = opts
  try {
    const { data: rules } = await admin
      .from('automations')
      .select('id, name, trigger, trigger_config, conditions, actions, created_by')
      .eq('project_id', task.project_id)
      .eq('trigger', event)
      .eq('is_active', true)
      .limit(50) as { data: AutomationRow[] | null }

    for (const rule of rules ?? []) {
      try {
        if (!triggerMatches(event, rule.trigger_config, task)) continue
        if (!conditionsPass(rule.conditions, task)) continue
        await runActions(admin, rule, task, actorId)
      } catch (e) {
        console.error('[automations] regla fallo', rule.id, e)
      }
    }
  } catch (e) {
    console.error('[runAutomations] Error:', e)
  }
}

// ── Validacion de payloads (compartida por la API) ──────────────────────────
export const AUTOMATION_TRIGGERS: AutomationTrigger[] =
  ['status_changed', 'assigned', 'task_created', 'due']
export const AUTOMATION_ACTION_TYPES: AutomationActionType[] =
  ['assign', 'move_status', 'move_sprint', 'notify', 'chat_post', 'emailer_enroll', 'emailer_send_campaign']
