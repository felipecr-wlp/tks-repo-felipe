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
  | 'assign' | 'move_status' | 'move_sprint' | 'notify' | 'chat_post'

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
  ['assign', 'move_status', 'move_sprint', 'notify', 'chat_post']
