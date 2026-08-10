'use client'

/**
 * Panel de Automatizaciones del proyecto (Circuito 3.C).
 *
 * Editor visual de reglas "cuando pase X, haz Y" con selects (sin JSON a la
 * vista). Lista las reglas existentes con un resumen legible, permite
 * activar/desactivar y eliminar, y trae un constructor para crear reglas
 * nuevas: disparador + (condicion implicita del disparador) + una o varias
 * acciones. Habla con /api/projects/[projectId]/automations.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Zap, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'

type TriggerKind = 'status_changed' | 'assigned' | 'task_created' | 'due'
type ActionKind =
  | 'assign' | 'move_status' | 'move_sprint' | 'notify' | 'chat_post' | 'emailer_enroll'
  | 'emailer_send_campaign'

interface Action {
  type: ActionKind
  assignee_id?: string | null
  status_id?: string | null
  sprint_id?: string | null
  recipient_id?: string
  body?: string
  sequence_id?: string | null
  email?: string
  campaign_title?: string | null
  campaign_subject?: string | null
  campaign_html?: string | null
  campaign_list_id?: string | null
}

interface Secuencia { id: string; name: string }

interface CampaignReport {
  at?: string
  ok?: boolean
  campaign_id?: string | null
  status?: string | null
  published_at?: string | null
  list_id?: string | null
  list_name?: string | null
  sent_count?: number | null
  error?: string | null
}

interface Rule {
  id: string
  name: string
  trigger: TriggerKind
  trigger_config: { to_status_id?: string; to_assignee_id?: string }
  conditions: unknown[]
  actions: Action[]
  is_active: boolean
  last_campaign_report?: CampaignReport | null
  created_at: string
}

interface Status { id: string; name: string; category: string }
interface Member { id: string; display_name: string | null; avatar_url: string | null }
interface Sprint { id: string; name: string; status: string }

interface Props {
  projectId: string
  /** Necesario para pedirle a WLI las secuencias del Emailer de ESTE espacio. */
  workspaceId: string
  statuses: Status[]
  members: Member[]
  sprints: Sprint[]
  initialRules: Rule[]
}

const TRIGGER_LABELS: Record<TriggerKind, string> = {
  status_changed: 'Cuando cambia de estado',
  assigned:       'Cuando se asigna',
  task_created:   'Cuando se crea la tarea',
  due:            'Cuando se vence',
}

const ACTION_LABELS: Record<ActionKind, string> = {
  assign:      'Asignar a',
  move_status: 'Mover a estado',
  move_sprint: 'Mover a sprint',
  notify:      'Avisar a',
  chat_post:   'Publicar en el chat',
  emailer_enroll: 'Enrolar en secuencia (WLI)',
  emailer_send_campaign: 'Publicar campaña (WLI)',
}

export function AutomationsPanel({ projectId, workspaceId, statuses, members, sprints, initialRules }: Props) {
  const [rules, setRules] = useState<Rule[]>(initialRules)
  const [creating, setCreating] = useState(false)

  const statusName = (id?: string | null) => statuses.find(s => s.id === id)?.name ?? '-'
  const memberName = (id?: string | null) => members.find(m => m.id === id)?.display_name ?? 'alguien'
  const sprintName = (id?: string | null) => sprints.find(s => s.id === id)?.name ?? '-'

  function formatoFecha(iso?: string | null): string {
    if (!iso) return 'fecha desconocida'
    try {
      return new Date(iso).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    } catch {
      return 'fecha desconocida'
    }
  }

  function actionSummary(a: Action): string {
    switch (a.type) {
      case 'assign':      return `asignar a ${memberName(a.assignee_id)}`
      case 'move_status': return `mover a "${statusName(a.status_id)}"`
      case 'move_sprint': return `mover al sprint "${sprintName(a.sprint_id)}"`
      case 'notify':      return `avisar a ${a.recipient_id === 'assignee' ? 'el asignado' : memberName(a.recipient_id)}`
      case 'chat_post':   return `publicar en el chat`
      case 'emailer_enroll': return `enrolar ${a.email === '{email_tarea}' ? 'el correo de la tarea' : a.email} en una secuencia del Emailer`
      case 'emailer_send_campaign': return `publicar la campaña «${a.campaign_title?.trim() || a.campaign_subject?.trim() || 'sin título'}» en el Emailer (base ${a.campaign_list_id})`
      default:            return a.type
    }
  }

  function triggerSummary(r: Rule): string {
    if (r.trigger === 'status_changed' && r.trigger_config?.to_status_id) {
      return `Cuando pasa a "${statusName(r.trigger_config.to_status_id)}"`
    }
    if (r.trigger === 'assigned' && r.trigger_config?.to_assignee_id) {
      return `Cuando se asigna a ${memberName(r.trigger_config.to_assignee_id)}`
    }
    return TRIGGER_LABELS[r.trigger]
  }

  async function toggleActive(rule: Rule) {
    const next = !rule.is_active
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, is_active: next } : r))
    try {
      const res = await fetch(`/api/projects/${projectId}/automations/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setRules(rs => rs.map(r => r.id === rule.id ? { ...r, is_active: !next } : r))
      toast.error('No se pudo actualizar la regla')
    }
  }

  async function remove(rule: Rule) {
    const prev = rules
    setRules(rs => rs.filter(r => r.id !== rule.id))
    try {
      const res = await fetch(`/api/projects/${projectId}/automations/${rule.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Regla eliminada')
    } catch {
      setRules(prev)
      toast.error('No se pudo eliminar la regla')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Automatizaciones</h2>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva regla
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Reglas que se disparan solas: cuando pasa algo en una tarea, el sistema ejecuta las acciones que definas.
      </p>

      {creating && (
        <RuleBuilder
          projectId={projectId}
          workspaceId={workspaceId}
          statuses={statuses}
          members={members}
          sprints={sprints}
          onCancel={() => setCreating(false)}
          onCreated={(rule) => { setRules(rs => [...rs, rule]); setCreating(false) }}
        />
      )}

      {rules.length === 0 && !creating ? (
        <EmptyState
          className="mt-4"
          icon={<Zap className="w-5 h-5" />}
          title="Aún no hay reglas"
          description="Ejemplo: al mover a «En revisión», asignar a QA y avisar en el chat."
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {rules.map(rule => (
            <li
              key={rule.id}
              className={cn(
                'rounded-xl border border-border bg-card p-3 flex items-start justify-between gap-3',
                !rule.is_active && 'opacity-60'
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
                  {!rule.is_active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">pausada</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground/80">{triggerSummary(rule)}</span>
                  {' → '}
                  {(rule.actions ?? []).map(actionSummary).join(', ') || 'sin acciones'}
                </p>
                {rule.last_campaign_report && (
                  <p className={cn(
                    'text-[11px] mt-1',
                    rule.last_campaign_report.ok ? 'text-muted-foreground' : 'text-amber-600'
                  )}>
                    {rule.last_campaign_report.ok
                      ? `Último envío publicado el ${formatoFecha(rule.last_campaign_report.published_at)} a «${rule.last_campaign_report.list_name ?? rule.last_campaign_report.list_id}» (${rule.last_campaign_report.sent_count ?? 0} envíos)`
                      : `Último intento de envío falló: ${rule.last_campaign_report.error ?? 'error desconocido'}`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => toggleActive(rule)}
                  title={rule.is_active ? 'Pausar' : 'Activar'}
                  className={cn(
                    'relative w-8 h-4 rounded-full transition-colors',
                    rule.is_active ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                    rule.is_active ? 'left-[18px]' : 'left-0.5'
                  )} />
                </button>
                <button
                  onClick={() => remove(rule)}
                  title="Eliminar"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-muted transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Constructor de una regla nueva ──────────────────────────────────────────
function RuleBuilder({
  projectId, workspaceId, statuses, members, sprints, onCancel, onCreated,
}: {
  projectId: string
  workspaceId: string
  statuses: Status[]
  members: Member[]
  sprints: Sprint[]
  onCancel: () => void
  onCreated: (rule: Rule) => void
}) {
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<TriggerKind>('status_changed')
  const [toStatusId, setToStatusId] = useState('')
  const [toAssigneeId, setToAssigneeId] = useState('')
  const [actions, setActions] = useState<Action[]>([{ type: 'assign', assignee_id: '' }])
  const [saving, setSaving] = useState(false)

  // Secuencias del Emailer de WLI. Se piden la PRIMERA vez que alguien elige la
  // accion de correo, no al abrir el panel: la mayoria de las reglas no tocan
  // WLI y no tiene sentido cobrarle a todas una llamada a otra app.
  const [secuencias, setSecuencias] = useState<Secuencia[] | null>(null)
  const [errorSecuencias, setErrorSecuencias] = useState<string | null>(null)

  async function cargarSecuencias() {
    if (secuencias !== null || errorSecuencias) return
    try {
      const res = await fetch(`/api/connectors/wli/sequences?workspace_id=${workspaceId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorSecuencias(data.error ?? 'No se pudieron leer las secuencias de WLI')
        return
      }
      setSecuencias(data.sequences ?? [])
    } catch {
      setErrorSecuencias('No se pudo contactar a WLI')
    }
  }

  const selectCls = 'w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring'

  function updateAction(i: number, patch: Partial<Action>) {
    setActions(as => as.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }
  function setActionType(i: number, type: ActionKind) {
    const base: Action = { type }
    if (type === 'notify') base.recipient_id = 'assignee'
    if (type === 'emailer_enroll') {
      // Por omision, el correo sale de la tarea. Es el caso util (tareas de
      // seguimiento a un prospecto) y evita que alguien deje el campo vacio
      // pensando que el sistema ya sabe a quien escribirle.
      base.email = '{email_tarea}'
      void cargarSecuencias()
    }
    setActions(as => as.map((a, idx) => idx === i ? base : a))
  }

  // Valida y limpia una accion antes de enviar; devuelve null si esta incompleta.
  function cleanAction(a: Action): Action | null {
    switch (a.type) {
      case 'assign':      return a.assignee_id ? { type: 'assign', assignee_id: a.assignee_id } : null
      case 'move_status': return a.status_id ? { type: 'move_status', status_id: a.status_id } : null
      case 'move_sprint': return a.sprint_id ? { type: 'move_sprint', sprint_id: a.sprint_id } : null
      case 'notify':      return a.recipient_id ? { type: 'notify', recipient_id: a.recipient_id } : null
      case 'chat_post':   return a.body && a.body.trim() ? { type: 'chat_post', body: a.body.trim() } : null
      // Las dos partes son obligatorias: sin secuencia no hay a donde enrolar, y
      // sin destinatario no hay a quien. Ninguna se rellena sola.
      case 'emailer_enroll':
        return a.sequence_id && a.email && a.email.trim()
          ? { type: 'emailer_enroll', sequence_id: a.sequence_id, email: a.email.trim() }
          : null
      // HTML y base son obligatorios: publicar sin saber a quien no existe, y la
      // campana sin contenido no se puede armar. El titulo cae al de la tarea.
      case 'emailer_send_campaign':
        return a.campaign_html && a.campaign_html.trim() && a.campaign_list_id && a.campaign_list_id.trim()
          ? {
              type: 'emailer_send_campaign',
              campaign_title: a.campaign_title?.trim(),
              campaign_subject: a.campaign_subject?.trim(),
              campaign_html: a.campaign_html,
              campaign_list_id: a.campaign_list_id.trim(),
            }
          : null
      default:            return null
    }
  }

  async function save() {
    const cleaned = actions.map(cleanAction).filter((a): a is Action => a !== null)
    if (cleaned.length === 0) {
      toast.error('Completa al menos una acción')
      return
    }
    const trigger_config: { to_status_id?: string; to_assignee_id?: string } = {}
    if (trigger === 'status_changed' && toStatusId) trigger_config.to_status_id = toStatusId
    if (trigger === 'assigned' && toAssigneeId) trigger_config.to_assignee_id = toAssigneeId

    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Regla',
          trigger,
          trigger_config,
          actions: cleaned,
        }),
      })
      if (!res.ok) throw new Error()
      const rule = await res.json() as Rule
      toast.success('Regla creada')
      onCreated(rule)
    } catch {
      toast.error('No se pudo crear la regla')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Nombre de la regla (ej. Pasar a QA)"
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {/* Disparador */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Cuando…</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={trigger} onChange={e => setTrigger(e.target.value as TriggerKind)} className={selectCls}>
            {(Object.keys(TRIGGER_LABELS) as TriggerKind[]).map(t => (
              <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
            ))}
          </select>
          {trigger === 'status_changed' && (
            <select value={toStatusId} onChange={e => setToStatusId(e.target.value)} className={selectCls}>
              <option value="">…cualquier estado</option>
              {statuses.map(s => <option key={s.id} value={s.id}>{`a "${s.name}"`}</option>)}
            </select>
          )}
          {trigger === 'assigned' && (
            <select value={toAssigneeId} onChange={e => setToAssigneeId(e.target.value)} className={selectCls}>
              <option value="">…cualquier persona</option>
              {members.map(m => <option key={m.id} value={m.id}>{`a ${m.display_name ?? 'alguien'}`}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Acciones */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Haz…</label>
        <div className="space-y-2">
          {actions.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select value={a.type} onChange={e => setActionType(i, e.target.value as ActionKind)} className={selectCls}>
                  {(Object.keys(ACTION_LABELS) as ActionKind[]).map(t => (
                    <option key={t} value={t}>{ACTION_LABELS[t]}</option>
                  ))}
                </select>
                {a.type === 'assign' && (
                  <select value={a.assignee_id ?? ''} onChange={e => updateAction(i, { assignee_id: e.target.value })} className={selectCls}>
                    <option value="">Elige persona…</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name ?? 'Sin nombre'}</option>)}
                  </select>
                )}
                {a.type === 'move_status' && (
                  <select value={a.status_id ?? ''} onChange={e => updateAction(i, { status_id: e.target.value })} className={selectCls}>
                    <option value="">Elige estado…</option>
                    {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {a.type === 'move_sprint' && (
                  <select value={a.sprint_id ?? ''} onChange={e => updateAction(i, { sprint_id: e.target.value })} className={selectCls}>
                    <option value="">Elige sprint…</option>
                    {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {a.type === 'notify' && (
                  <select value={a.recipient_id ?? 'assignee'} onChange={e => updateAction(i, { recipient_id: e.target.value })} className={selectCls}>
                    <option value="assignee">El asignado de la tarea</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name ?? 'Sin nombre'}</option>)}
                  </select>
                )}
                {a.type === 'chat_post' && (
                  <input
                    value={a.body ?? ''}
                    onChange={e => updateAction(i, { body: e.target.value })}
                    placeholder='Mensaje (usa {tarea} para el título)'
                    className={selectCls}
                  />
                )}
                {a.type === 'emailer_enroll' && (
                  errorSecuencias ? (
                    <p className="text-[11px] text-amber-600 self-center">{errorSecuencias}</p>
                  ) : secuencias === null ? (
                    <p className="text-[11px] text-muted-foreground self-center">Leyendo secuencias de WLI…</p>
                  ) : secuencias.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground self-center">
                      No hay secuencias activas en el Emailer.
                    </p>
                  ) : (
                    <>
                      <select
                        value={a.sequence_id ?? ''}
                        onChange={e => updateAction(i, { sequence_id: e.target.value })}
                        className={selectCls}
                      >
                        <option value="">Elige secuencia…</option>
                        {secuencias.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input
                        value={a.email ?? ''}
                        onChange={e => updateAction(i, { email: e.target.value })}
                        placeholder='{email_tarea} o un correo fijo'
                        className={cn(selectCls, 'sm:col-span-2')}
                      />
                    </>
                  )
                )}
                {a.type === 'emailer_send_campaign' && (
                  <>
                    <input
                      value={a.campaign_title ?? ''}
                      onChange={e => updateAction(i, { campaign_title: e.target.value })}
                      placeholder="Nombre de la campaña"
                      className={selectCls}
                    />
                    <input
                      value={a.campaign_subject ?? ''}
                      onChange={e => updateAction(i, { campaign_subject: e.target.value })}
                      placeholder="Asunto del correo"
                      className={selectCls}
                    />
                    <textarea
                      value={a.campaign_html ?? ''}
                      onChange={e => updateAction(i, { campaign_html: e.target.value })}
                      placeholder="HTML de la campaña. Ej. <p>Hola {nombre}, …</p>"
                      className={cn(selectCls, 'sm:col-span-2 min-h-[110px] resize-y font-mono')}
                    />
                    <input
                      value={a.campaign_list_id ?? ''}
                      onChange={e => updateAction(i, { campaign_list_id: e.target.value })}
                      placeholder="ID de la base (lista) a la que se envía"
                      className={cn(selectCls, 'sm:col-span-2')}
                    />
                  </>
                )}
              </div>
              {actions.length > 1 && (
                <button
                  onClick={() => setActions(as => as.filter((_, idx) => idx !== i))}
                  title="Quitar acción"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-muted transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {actions.some(a => a.type === 'emailer_enroll') && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{'{email_tarea}'}</span> toma la primera dirección
            que aparezca en el título o la descripción de la tarea. Si no encuentra ninguna, no enrola a nadie.
            Quien se dio de baja del Emailer nunca se vuelve a enrolar, aunque la regla lo pida.
          </p>
        )}
        {actions.some(a => a.type === 'emailer_send_campaign') && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Publicar dispara el correo.</span> WLO le manda este HTML a
            WLI, que arma la campaña y la envía a toda la base indicada. El resultado (cuándo se publicó, a qué base y
            cuántos envíos) aparece debajo de la regla al volver a este panel.
          </p>
        )}
        {actions.length < 5 && (
          <button
            onClick={() => setActions(as => [...as, { type: 'notify', recipient_id: 'assignee' }])}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar acción
          </button>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Crear regla'}
        </button>
      </div>
    </div>
  )
}
