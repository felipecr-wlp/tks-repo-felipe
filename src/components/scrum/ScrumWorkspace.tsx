'use client'

/**
 * ScrumWorkspace, capa ágil sobre el task engine de WLO.
 *
 * Cuatro vistas sobre las MISMAS tareas (no duplica datos):
 *   · Tablero  : sprint activo por columnas To-Do / En progreso / Hecho.
 *   · Backlog  : tareas sin sprint, se estiman y se mandan a un sprint.
 *   · Daily    : sprint activo agrupado por persona (la Cédula Daily Scrum).
 *   · Dashboard: KPIs del sprint (velocity, avance, on-time, estimación, mix).
 *
 * Las mutaciones reusan la API existente (PATCH /api/tasks/[id] extendido con
 * la capa scrum) + /api/sprints. Tras cada cambio se hace router.refresh().
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { usePresence, type Viewer } from '@/hooks/usePresence'
// recharts se carga aparte (ssr: false) para no incluirlo en el bundle inicial
// de este componente cliente de ~2100 lineas: solo baja al abrir el Dashboard.
const ScrumChart = dynamic(() => import('./ScrumCharts'), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full rounded-lg bg-muted/30 animate-pulse" />,
})
import {
  Inbox, Loader2, CheckCircle2, Circle,
  ChevronsUp, ChevronUp, ChevronDown, Equal, Minus,
  Timer, Columns3, Target, Flame, UserX, X, Search,
  Users, Flag, ArrowDownUp, AlertTriangle, Rocket,
  Gauge, TrendingUp, CalendarClock, Layers, PieChart as PieIcon,
  Play, ClipboardList, ArrowUpRight, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import {
  STORY_POINTS, SCRUM_COLUMNS,
  type ScrumTask, type ScrumSprint, type ScrumMember, type ScrumStatus,
} from './types'
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel'

type View = 'board' | 'backlog' | 'standup' | 'dashboard'
type Methodology = 'scrum' | 'kanban'

interface Props {
  teamId: string
  workspaceId: string
  teamName: string
  methodology: Methodology
  wipLimits?: Record<string, number | null> | null
  sprints: ScrumSprint[]
  tasks: ScrumTask[]
  statuses: ScrumStatus[]
  members: ScrumMember[]
  currentUserId: string
  soloProject?: { name: string; href: string } | null
}

const AREA_COLORS = ['#FED500', '#6366f1', '#10b981', '#f97316', '#ec4899', '#06b6d4', '#a855f7', '#84cc16']

// Paleta estable para distinguir proyectos en el tablero del equipo (chip + carril).
// El tablero agrega tareas de varios proyectos; el color ancla "de qué proyecto es"
// cada tarjeta sin tener que abrirla.
const PROJECT_COLORS = ['#6366f1', '#10b981', '#f97316', '#ec4899', '#06b6d4', '#a855f7', '#84cc16', '#ef4444', '#14b8a6', '#eab308']

// Identidad visual por columna: icono + acentos de color. Da lectura instantánea
// del flujo sin leer etiquetas (bandeja = espera, spinner = en curso, check = hecho).
const COLUMN_META: Record<string, {
  Icon: LucideIcon; header: string; bar: string; overBg: string; overRing: string; hintRing: string
}> = {
  todo:        { Icon: Inbox,       header: 'text-slate-500',   bar: 'bg-slate-300',   overBg: 'bg-slate-500/10',   overRing: 'ring-slate-400/50',   hintRing: 'ring-slate-300/60' },
  in_progress: { Icon: Loader2,      header: 'text-blue-500',    bar: 'bg-blue-400',    overBg: 'bg-blue-500/10',    overRing: 'ring-blue-400/50',    hintRing: 'ring-blue-300/60' },
  done:        { Icon: CheckCircle2, header: 'text-emerald-500', bar: 'bg-emerald-400', overBg: 'bg-emerald-500/10', overRing: 'ring-emerald-400/50', hintRing: 'ring-emerald-300/60' },
}
const COLUMN_FALLBACK = { Icon: Circle, header: 'text-muted-foreground', bar: 'bg-border', overBg: 'bg-primary/10', overRing: 'ring-primary/40', hintRing: 'ring-border' }
const colMeta = (cat: string) => COLUMN_META[cat] ?? COLUMN_FALLBACK

// Prioridad como escala de chevrones (estilo Linear), sin texto.
const PRIORITY_META: Record<string, { Icon: LucideIcon; className: string; label: string }> = {
  urgent: { Icon: ChevronsUp,  className: 'text-red-500',        label: 'Urgente' },
  high:   { Icon: ChevronUp,   className: 'text-orange-500',     label: 'Alta' },
  medium: { Icon: Equal,       className: 'text-yellow-500',     label: 'Media' },
  low:    { Icon: ChevronDown, className: 'text-sky-500',        label: 'Baja' },
  none:   { Icon: Minus,       className: 'text-muted-foreground', label: 'Sin prioridad' },
}
const prioMeta = (p: string) => PRIORITY_META[p] ?? PRIORITY_META.none
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }

// Orden dentro de columna y agrupación en carriles (swimlanes). Todo cliente.
type SortKey = 'manual' | 'priority' | 'due' | 'points'
type GroupKey = 'none' | 'assignee' | 'priority' | 'project'

// Rango de fechas del sprint en formato compacto ("14 jul - 28 jul"). Devuelve
// null si el sprint no tiene fechas para no pintar un separador huérfano.
function formatSprintRange(start: string | null, end: string | null): string | null {
  const fmt = (d: string) => new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
  if (start && end) return `${fmt(start)} - ${fmt(end)}`
  if (start) return `desde ${fmt(start)}`
  if (end) return `hasta ${fmt(end)}`
  return null
}

// Días que faltan para el fin del sprint (redondeado hacia arriba). Negativo si
// ya venció. null si no hay fecha de fin.
function daysUntil(end: string | null): number | null {
  if (!end) return null
  const target = new Date(end); target.setHours(23, 59, 59, 999)
  return Math.ceil((target.getTime() - Date.now()) / 86400000)
}

function sortTasks(list: ScrumTask[], by: SortKey): ScrumTask[] {
  if (by === 'manual') return list
  const arr = [...list]
  if (by === 'priority') arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4))
  else if (by === 'due') arr.sort((a, b) => (a.due_date ? new Date(a.due_date).getTime() : Infinity) - (b.due_date ? new Date(b.due_date).getTime() : Infinity))
  else if (by === 'points') arr.sort((a, b) => (b.story_points ?? -1) - (a.story_points ?? -1))
  return arr
}

export function ScrumWorkspace({
  teamId, workspaceId, teamName, methodology: methodologyProp, wipLimits = null, sprints, tasks, statuses, members, currentUserId,
  soloProject = null,
}: Props) {
  const router = useRouter()
  const [view, setView] = useState<View>('board')
  const [busy, setBusy] = useState(false)

  // Metodología del equipo (Scrum = sprints, Kanban = flujo continuo). Se cambia
  // solo por admin. Optimista: el cambio se refleja al instante y revierte si el
  // servidor lo rechaza. Cambiar a Kanban no toca datos: solo cambia la lente.
  const [methodology, setMethodology] = useState<Methodology>(methodologyProp)
  useEffect(() => { setMethodology(methodologyProp) }, [methodologyProp])
  const isKanban = methodology === 'kanban'

  // Limites WIP por columna, configurables por el admin y persistidos en el
  // equipo. Ausente/null en una categoria = usar el limite sano derivado (solo
  // aplica a "en curso"). Optimista: se refleja al instante y revierte si falla.
  const [wipCfg, setWipCfg] = useState<Record<string, number | null>>(wipLimits ?? {})
  useEffect(() => { setWipCfg(wipLimits ?? {}) }, [wipLimits])
  async function saveWip(next: Record<string, number | null>) {
    const prev = wipCfg
    setWipCfg(next)
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wip_limits: next }),
      })
      if (!res.ok) throw new Error()
      toast.success('Límites WIP actualizados')
    } catch {
      setWipCfg(prev)
      toast.error('No se pudieron guardar los límites WIP')
    }
  }

  // Colaboración en vivo: si otro miembro mueve tareas o edita sprints, el
  // tablero se actualiza solo para todos.
  useRealtimeRefresh({
    channel: `scrum-${teamId}`,
    tables: [
      // tasks no tiene team_id: se filtra por workspace (denormalizado para RLS).
      { table: 'tasks',   filter: `workspace_id=eq.${workspaceId}` },
      { table: 'sprints', filter: `team_id=eq.${teamId}` },
    ],
  })

  // Presencia en vivo: quién está viendo el scrum del equipo ahora mismo.
  const me = members.find(m => m.id === currentUserId)
  const isAdmin = me?.role === 'admin'
  const viewers = usePresence({
    channel: `scrum-presence-${teamId}`,
    userId: currentUserId,
    name: me?.display_name ?? 'Miembro',
    avatarUrl: me?.avatar_url ?? null,
  })

  // Estado optimista: al mover/estimar una tarjeta el cambio se ve al instante,
  // sin esperar el round-trip. El realtime (router.refresh) reconcilia con la
  // verdad del servidor cuando llegan props nuevas; si el PATCH falla, revertimos.
  const [localTasks, setLocalTasks] = useState(tasks)
  useEffect(() => { setLocalTasks(tasks) }, [tasks])

  // Sprint seleccionado: activo > primero > ninguno
  const defaultSprint = useMemo(() => {
    return sprints.find(s => s.status === 'active')?.id ?? sprints[0]?.id ?? null
  }, [sprints])
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(defaultSprint)

  // Tarea abierta en el panel de detalle (deslizante). Reusa el mismo panel
  // que el tablero clasico de tareas, para que abrir una tarjeta del scrum se
  // sienta igual que abrirla en cualquier otra vista de WLO.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const openTask = openTaskId ? localTasks.find(t => t.id === openTaskId) ?? null : null
  const openTaskStatuses = useMemo(
    () => openTask ? statuses.filter(s => s.project_id === openTask.project_id) : [],
    [openTask, statuses],
  )

  const selectedSprint = sprints.find(s => s.id === selectedSprintId) ?? null
  const sprintTasks = useMemo(
    () => localTasks.filter(t => t.sprint_id === selectedSprintId),
    [localTasks, selectedSprintId]
  )
  const backlog = useMemo(() => localTasks.filter(t => t.sprint_id === null), [localTasks])

  // Resumen del sprint seleccionado para el encabezado premium: avance en
  // tareas, story points comprometidos vs completados, y cuántas van vencidas.
  // Se calcula aquí (donde vive el estado optimista) y se pasa a la barra.
  const sprintSummary = useMemo(() => {
    const total = sprintTasks.length
    const done = sprintTasks.filter(t => t.status?.category === 'done').length
    const committedSP = sprintTasks.reduce((a, t) => a + (t.story_points ?? 0), 0)
    const completedSP = sprintTasks
      .filter(t => t.status?.category === 'done')
      .reduce((a, t) => a + (t.story_points_done ?? t.story_points ?? 0), 0)
    const now = Date.now()
    const overdue = sprintTasks.filter(
      t => t.status?.category !== 'done' && !!t.due_date && new Date(t.due_date).getTime() < now,
    ).length
    // Avance por story points si hay estimación; si no, por conteo de tareas.
    const pct = committedSP > 0
      ? Math.round((completedSP / committedSP) * 100)
      : total > 0 ? Math.round((done / total) * 100) : 0
    return { total, done, committedSP, completedSP, overdue, pct }
  }, [sprintTasks])

  // Mapa proyecto -> categoría -> status_id (para mover entre columnas)
  const statusFor = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    for (const s of statuses) {
      if (!m.has(s.project_id)) m.set(s.project_id, new Map())
      const inner = m.get(s.project_id)!
      if (!inner.has(s.category)) inner.set(s.category, s.id)
    }
    return m
  }, [statuses])

  // ── Mutaciones ──────────────────────────────────────────────────────────
  // PATCH crudo (sin router.refresh): las vistas usan estado optimista y el
  // realtime reconcilia. Devuelve si el servidor aceptó el cambio.
  async function patchTaskRequest(taskId: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.ok
    } catch {
      return false
    }
  }

  function moveToCategory(task: ScrumTask, category: string) {
    const target = statusFor.get(task.project_id)?.get(category)
    if (!target) { toast.error('Ese proyecto no tiene un estado de esa columna'); return }
    if (task.status?.id === target) return
    const ref = statuses.find(s => s.id === target)
    // Optimista: pinta la tarjeta en la nueva columna de inmediato.
    setLocalTasks(prev => prev.map(t =>
      t.id === task.id
        ? { ...t, status: ref ? { id: ref.id, name: ref.name, color: ref.color, category: ref.category } : t.status }
        : t
    ))
    patchTaskRequest(task.id, { status_id: target }).then(ok => {
      if (!ok) { toast.error('No se pudo mover la tarjeta'); setLocalTasks(tasks) }
    })
  }

  function setPoints(task: ScrumTask, points: number | null) {
    const body: Record<string, unknown> = { story_points: points }
    const alsoDone = task.status?.category === 'done'
    // Si la tarea ya está hecha, reflejar el esfuerzo real también.
    if (alsoDone) body.story_points_done = points
    setLocalTasks(prev => prev.map(t =>
      t.id === task.id
        ? { ...t, story_points: points, story_points_done: alsoDone ? points : t.story_points_done }
        : t
    ))
    patchTaskRequest(task.id, body).then(ok => {
      if (!ok) { toast.error('No se pudo guardar la estimación'); setLocalTasks(tasks) }
    })
  }

  function assignToSprint(taskId: string, sprintId: string | null) {
    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, sprint_id: sprintId } : t))
    patchTaskRequest(taskId, { sprint_id: sprintId }).then(ok => {
      if (ok) toast.success(sprintId ? 'Enviada al sprint' : 'Devuelta al backlog')
      else { toast.error('No se pudo mover la tarea'); setLocalTasks(tasks) }
    })
  }

  async function createSprint(payload: { name: string; goal: string; start_date: string; end_date: string }) {
    setBusy(true)
    try {
      const res = await fetch('/api/sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, ...payload }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'No se pudo crear')
      }
      toast.success('Sprint creado')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al crear el sprint')
    } finally {
      setBusy(false)
    }
  }

  async function switchMethodology(next: Methodology) {
    if (next === methodology) return
    const prev = methodology
    // Optimista: cambia la lente de inmediato. Si el tablero está en Backlog y
    // pasamos a Kanban (que no tiene backlog), reencuadramos al Tablero.
    setMethodology(next)
    if (next === 'kanban' && view === 'backlog') setView('board')
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methodology: next }),
      })
      if (!res.ok) throw new Error('No se pudo cambiar la metodología')
      toast.success(next === 'kanban' ? 'Ahora en modo Kanban' : 'Ahora en modo Scrum')
      router.refresh()
    } catch (e) {
      setMethodology(prev)
      toast.error(e instanceof Error ? e.message : 'Error al cambiar la metodología')
    }
  }

  async function patchSprint(sprintId: string, body: Record<string, unknown>, okMsg?: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/sprints/${sprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('No se pudo actualizar')
      if (okMsg) toast.success(okMsg)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  // Cierre de sprint con carry-over: las tareas incompletas se van al backlog o
  // a otro sprint (carryTo). Las hechas se quedan como registro de lo logrado.
  async function closeSprint(sprintId: string, carryTo: string | null) {
    setBusy(true)
    try {
      const res = await fetch(`/api/sprints/${sprintId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carry_to: carryTo }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'No se pudo cerrar el sprint')
      }
      const data: { carried: number; done: number } = await res.json()
      const dest = carryTo ? 'al siguiente sprint' : 'al backlog'
      toast.success(
        data.carried > 0
          ? `Sprint cerrado. ${data.carried} ${data.carried === 1 ? 'tarea movida' : 'tareas movidas'} ${dest}.`
          : 'Sprint cerrado.'
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cerrar el sprint')
    } finally {
      setBusy(false)
    }
  }

  // Reconciliar el estado optimista cuando el panel edita una tarea, para que la
  // tarjeta del tablero refleje el cambio sin esperar al realtime.
  function onTaskUpdated(u: { id: string; title: string; priority: string; due_date: string | null; status: ScrumStatus | { id: string; name: string; color: string | null; category: string } | null; assignee: { id: string; display_name: string; avatar_url: string | null } | null }) {
    setLocalTasks(prev => prev.map(t => t.id === u.id
      ? {
          ...t,
          title: u.title,
          priority: u.priority,
          due_date: u.due_date,
          status: u.status ? { id: u.status.id, name: u.status.name, color: u.status.color, category: u.status.category } : t.status,
          assignee: u.assignee ? { id: u.assignee.id, display_name: u.assignee.display_name, avatar_url: u.assignee.avatar_url } : null,
        }
      : t))
  }

  return (
    <div className="flex flex-col h-full">
      {openTask && (
        <TaskDetailPanel
          taskId={openTask.id}
          statuses={openTaskStatuses}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setOpenTaskId(null)}
          onUpdated={onTaskUpdated}
          onDeleted={(id) => { setLocalTasks(prev => prev.filter(t => t.id !== id)); setOpenTaskId(null) }}
        />
      )}
      <SprintBar
        teamName={teamName}
        methodology={methodology}
        isAdmin={isAdmin}
        onSwitchMethodology={switchMethodology}
        sprints={sprints}
        selected={selectedSprint}
        summary={sprintSummary}
        onSelect={setSelectedSprintId}
        onCreate={createSprint}
        onSetStatus={(st) => selectedSprint && patchSprint(selectedSprint.id, { status: st }, 'Estado actualizado')}
        onCloseSprint={(carryTo) => selectedSprint && closeSprint(selectedSprint.id, carryTo)}
        view={view}
        onView={setView}
        busy={busy}
        viewers={viewers}
      />

      <div className="flex-1 overflow-auto px-6 py-5">
        {isKanban ? (
          view === 'board' ? (
            <BoardView tasks={localTasks} onMove={moveToCategory} onPoints={setPoints} onOpen={setOpenTaskId} statusFor={statusFor} members={members} teamId={teamId} kanban soloProject={soloProject} wipCfg={wipCfg} canConfigureWip={isAdmin} onSaveWip={saveWip} />
          ) : view === 'standup' ? (
            <StandupView sprint={null} tasks={localTasks} members={members} onOpen={setOpenTaskId} />
          ) : (
            <KanbanDashboard tasks={localTasks} members={members} />
          )
        ) : !selectedSprint && view !== 'backlog' ? (
          <EmptyState />
        ) : view === 'board' ? (
          selectedSprint && sprintTasks.length === 0 ? (
            <SprintBoardEmpty
              sprint={selectedSprint}
              backlogCount={backlog.length}
              onGoBacklog={() => setView('backlog')}
              onActivate={() => patchSprint(selectedSprint.id, { status: 'active' }, 'Sprint iniciado')}
              busy={busy}
            />
          ) : (
            <BoardView tasks={sprintTasks} onMove={moveToCategory} onPoints={setPoints} onOpen={setOpenTaskId} statusFor={statusFor} members={members} teamId={teamId} soloProject={soloProject} />
          )
        ) : view === 'backlog' ? (
          <BacklogView
            backlog={backlog}
            sprints={sprints}
            onPoints={setPoints}
            onAssign={assignToSprint}
            onOpen={setOpenTaskId}
          />
        ) : view === 'standup' ? (
          <StandupView sprint={selectedSprint!} tasks={sprintTasks} members={members} onOpen={setOpenTaskId} />
        ) : (
          <DashboardView sprint={selectedSprint!} sprintTasks={sprintTasks} allSprints={sprints} allTasks={localTasks} members={members} />
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Barra superior: selector de sprint + tabs + crear sprint                   */
/* ════════════════════════════════════════════════════════════════════════ */
type SprintSummary = { total: number; done: number; committedSP: number; completedSP: number; overdue: number; pct: number }

function SprintBar({
  teamName, methodology, isAdmin, onSwitchMethodology,
  sprints, selected, summary, onSelect, onCreate, onSetStatus, onCloseSprint, view, onView, busy, viewers,
}: {
  teamName: string
  methodology: Methodology
  isAdmin: boolean
  onSwitchMethodology: (m: Methodology) => void
  sprints: ScrumSprint[]
  selected: ScrumSprint | null
  summary: SprintSummary
  onSelect: (id: string) => void
  onCreate: (p: { name: string; goal: string; start_date: string; end_date: string }) => void
  onSetStatus: (s: 'planning' | 'active' | 'completed') => void
  onCloseSprint: (carryTo: string | null) => void
  view: View
  onView: (v: View) => void
  busy: boolean
  viewers: Viewer[]
}) {
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [showClose, setShowClose] = useState(false)

  const isKanban = methodology === 'kanban'

  // El Backlog y el concepto de sprint solo aplican a Scrum. En Kanban el trabajo
  // fluye continuo, así que ese tab desaparece.
  const tabs: { key: View; label: string }[] = isKanban
    ? [
        { key: 'board', label: 'Tablero' },
        { key: 'standup', label: 'Por persona' },
        { key: 'dashboard', label: 'Dashboard' },
      ]
    : [
        { key: 'board', label: 'Tablero' },
        { key: 'standup', label: 'Daily' },
        { key: 'backlog', label: 'Backlog' },
        { key: 'dashboard', label: 'Dashboard' },
      ]

  return (
    <div className="px-6 pb-3 border-b border-border">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            {isKanban ? <Columns3 className="w-4 h-4 text-blue-500" /> : <Timer className="w-4 h-4 text-primary" />}
            {isKanban ? 'Kanban' : 'Scrum'}
            <span className="text-muted-foreground font-normal text-sm">· {teamName}</span>
          </h1>

          {/* Metodología (solo admin del equipo). Toggle tipo segmento: un clic
              cambia la lente sin tocar datos, las mismas tareas se ven como
              sprints o como flujo continuo. Los demás ven una etiqueta fija. */}
          {isAdmin ? (
            <div className="flex items-center gap-0.5 bg-muted rounded-full p-0.5" role="group" title="Metodología del equipo">
              {([['scrum', 'Scrum', Timer], ['kanban', 'Kanban', Columns3]] as const).map(([val, lbl, MIcon]) => (
                <button
                  key={val}
                  onClick={() => onSwitchMethodology(val)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    methodology === val
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <MIcon className="w-3 h-3" /> {lbl}
                </button>
              ))}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-muted text-muted-foreground">
              {isKanban ? <Columns3 className="w-3 h-3" /> : <Timer className="w-3 h-3" />}
              {isKanban ? 'Kanban' : 'Scrum'}
            </span>
          )}

          {!isKanban && sprints.length > 0 && (
            <select
              value={selected?.id ?? ''}
              onChange={e => onSelect(e.target.value)}
              className="text-sm bg-muted/50 border border-border rounded-md px-2 py-1.5 text-foreground"
            >
              {sprints.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.status === 'active' ? '(activo)' : s.status === 'completed' ? '(cerrado)' : '(plan)'}
                </option>
              ))}
            </select>
          )}
          {!isKanban && sprints.length === 0 && (
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              + Crear el primer sprint
            </button>
          )}
          {!isKanban && selected && (
            <select
              value={selected.status}
              onChange={e => {
                const next = e.target.value as 'planning' | 'active' | 'completed'
                // Cerrar un sprint activo o en plan pasa por el modal de carry-over
                // (para decidir el destino de las tareas incompletas). Los demas
                // cambios de estado son un PATCH directo.
                if (next === 'completed' && selected.status !== 'completed') setShowClose(true)
                else onSetStatus(next)
              }}
              disabled={busy}
              className={cn(
                'text-xs rounded-full px-2 py-1 font-medium border',
                selected.status === 'active' && 'bg-green-100 text-green-700 border-green-200',
                selected.status === 'planning' && 'bg-yellow-100 text-yellow-700 border-yellow-200',
                selected.status === 'completed' && 'bg-gray-100 text-gray-600 border-gray-200',
              )}
            >
              <option value="planning">Planeación</option>
              <option value="active">Activo</option>
              <option value="completed">Cerrado</option>
            </select>
          )}
          {viewers.length > 0 && <PresenceStrip viewers={viewers} />}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => onView(t.key)}
                className={cn(
                  'px-2.5 py-1 rounded text-xs transition-colors',
                  view === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!isKanban && (
            <button
              onClick={() => setShowNew(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              + Sprint
            </button>
          )}
        </div>
      </div>

      {!isKanban && selected && (
        <SprintHeaderCard sprint={selected} summary={summary} />
      )}

      {showNew && (
        <div className="mt-3 p-3 border border-border rounded-lg bg-card grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Nombre del sprint (ej. Semana 27 Paid Media)"
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background md:col-span-2"
          />
          <input
            value={goal} onChange={e => setGoal(e.target.value)}
            placeholder="Meta del sprint (opcional)"
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background md:col-span-2"
          />
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Inicio
            <input type="date" value={start} onChange={e => setStart(e.target.value)}
              className="text-sm border border-border rounded-md px-2 py-1.5 bg-background" />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Fin
            <input type="date" value={end} onChange={e => setEnd(e.target.value)}
              className="text-sm border border-border rounded-md px-2 py-1.5 bg-background" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
            <button
              disabled={busy || !name.trim()}
              onClick={() => {
                onCreate({ name: name.trim(), goal: goal.trim(), start_date: start, end_date: end })
                setName(''); setGoal(''); setStart(''); setEnd(''); setShowNew(false)
              }}
              className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
            >
              Crear sprint
            </button>
          </div>
        </div>
      )}

      {showClose && selected && (
        <CloseSprintModal
          sprint={selected}
          incomplete={Math.max(summary.total - summary.done, 0)}
          candidates={sprints.filter(s => s.id !== selected.id && s.status !== 'completed')}
          busy={busy}
          onCancel={() => setShowClose(false)}
          onConfirm={(carryTo) => { onCloseSprint(carryTo); setShowClose(false) }}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Modal de cierre de sprint con carry-over: elige el destino de las tareas    */
/* incompletas (backlog u otro sprint abierto). Las hechas se quedan.          */
/* ════════════════════════════════════════════════════════════════════════ */
function CloseSprintModal({
  sprint, incomplete, candidates, busy, onCancel, onConfirm,
}: {
  sprint: ScrumSprint
  incomplete: number
  candidates: ScrumSprint[]
  busy: boolean
  onCancel: () => void
  onConfirm: (carryTo: string | null) => void
}) {
  const [dest, setDest] = useState<string>('backlog')
  const carryTo = dest === 'backlog' ? null : dest

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md bg-card border border-border rounded-xl shadow-xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <Timer className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Cerrar {sprint.name}</h2>
        </div>
        {incomplete > 0 ? (
          <p className="text-sm text-muted-foreground mb-4">
            Hay {incomplete} {incomplete === 1 ? 'tarea sin terminar' : 'tareas sin terminar'}. ¿A dónde las mueves? Las tareas hechas se quedan en el sprint como registro.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-4">
            No quedan tareas sin terminar. El sprint se cerrará.
          </p>
        )}

        {incomplete > 0 && (
          <label className="text-xs font-medium text-muted-foreground flex flex-col gap-1 mb-4">
            Mover tareas incompletas a
            <select
              value={dest}
              onChange={e => setDest(e.target.value)}
              className="text-sm border border-border rounded-md px-2 py-2 bg-background text-foreground"
            >
              <option value="backlog">Backlog (quitar del sprint)</option>
              {candidates.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.status === 'active' ? '(activo)' : '(plan)'}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground rounded-md"
          >
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={() => onConfirm(carryTo)}
            className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            Cerrar sprint
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Encabezado premium del sprint: meta, rango de fechas, barra de avance con   */
/* gradiente y lectura compacta (hechas, story points, vencidas).             */
/* ════════════════════════════════════════════════════════════════════════ */
function SprintHeaderCard({ sprint, summary }: { sprint: ScrumSprint; summary: SprintSummary }) {
  const isActive = sprint.status === 'active'
  const range = formatSprintRange(sprint.start_date, sprint.end_date)
  const left = daysUntil(sprint.end_date)
  // "Termina pronto" si faltan 0..3 días y el sprint sigue en curso.
  const endingSoon = isActive && left != null && left >= 0 && left <= 3
  const ended = left != null && left < 0
  const { pct, done, total, committedSP, completedSP, overdue } = summary
  const complete = pct >= 100

  return (
    <div
      className={cn(
        'mt-2.5 rounded-xl border bg-card px-4 py-3 transition-all hover:shadow-sm',
        isActive
          ? 'border-primary/30 ring-1 ring-primary/20 bg-gradient-to-r from-primary/[0.06] to-transparent'
          : 'border-border hover:border-primary/30',
      )}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-center gap-2">
          {isActive
            ? <Flame className="w-4 h-4 text-primary shrink-0" aria-label="Sprint activo" />
            : <Timer className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className="text-sm font-semibold text-foreground truncate">{sprint.name}</span>
          {range && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
              <CalendarClock className="w-3.5 h-3.5" /> {range}
            </span>
          )}
          {endingSoon && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-600 px-1.5 py-0.5 text-[10px] font-medium shrink-0">
              <CalendarClock className="w-3 h-3" /> {left === 0 ? 'Termina hoy' : `${left} d restantes`}
            </span>
          )}
          {ended && !complete && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-medium shrink-0">
              <AlertTriangle className="w-3 h-3" /> Vencido
            </span>
          )}
        </div>

        {/* Lectura compacta: hechas / total, story points y vencidas. */}
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CheckCircle2 className={cn('w-3.5 h-3.5', done > 0 ? 'text-emerald-500' : 'text-muted-foreground')} />
            <span className="tabular-nums font-medium text-foreground">{done}</span>/{total} hechas
          </span>
          {committedSP > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Gauge className="w-3.5 h-3.5 text-primary" />
              <span className="tabular-nums font-medium text-foreground">{completedSP}</span>/{committedSP} SP
            </span>
          )}
          {overdue > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5 font-medium">
              <AlertTriangle className="w-3 h-3" /> {overdue} vencida{overdue === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {/* Barra de avance con gradiente (lenguaje visual compartido con Goals). */}
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', complete ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary to-emerald-500')}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className={cn('text-xs font-semibold tabular-nums shrink-0', complete ? 'text-emerald-600' : 'text-foreground')}>{pct}%</span>
      </div>

      {sprint.goal && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
          <Target className="w-3.5 h-3.5 shrink-0" /> {sprint.goal}
        </p>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Tablero: columnas por categoría                                            */
/* ════════════════════════════════════════════════════════════════════════ */
function BoardView({
  tasks, onMove, onPoints, onOpen, statusFor, members, teamId, kanban, soloProject = null,
  wipCfg = {}, canConfigureWip = false, onSaveWip,
}: {
  tasks: ScrumTask[]
  onMove: (t: ScrumTask, cat: string) => void
  onPoints: (t: ScrumTask, p: number | null) => void
  onOpen: (id: string) => void
  statusFor: Map<string, Map<string, string>>
  members: ScrumMember[]
  teamId: string
  kanban?: boolean
  soloProject?: { name: string; href: string } | null
  wipCfg?: Record<string, number | null>
  canConfigureWip?: boolean
  onSaveWip?: (next: Record<string, number | null>) => void
}) {
  // Drag-and-drop nativo: arrastrar entre columnas es el gesto que la gente
  // espera de un tablero. Los botones de icono mueven la tarjeta como respaldo
  // táctil/a11y (bandeja a la fila, spinner a en curso, check a hecho).
  const [dragId, setDragId] = useState<string | null>(null)
  // Resalte de drop acotado por carril: `${laneId}:${category}`, para no
  // iluminar la misma categoría en todos los carriles a la vez.
  const [overKey, setOverKey] = useState<string | null>(null)
  const [wipOpen, setWipOpen] = useState(false)

  // ── Barra de control (más gobernable): filtra el tablero por texto, persona,
  // vencidas y sin dueño; agrupa en carriles; ordena dentro de cada columna.
  // Todo en cliente, sin tocar la BD. ───────────────────────────────────────
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [pickProject, setPickProject] = useState<Set<string>>(new Set())
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupKey>('none')
  const [sortBy, setSortBy] = useState<SortKey>('manual')

  // Persistencia de preferencias por equipo (no los filtros efímeros como el
  // texto o la selección de personas; sí la forma de ver el tablero).
  const prefsKey = `wlo-scrum-board-${teamId}`
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefsKey)
      if (!raw) return
      const p = JSON.parse(raw)
      if (p.groupBy) setGroupBy(p.groupBy)
      if (p.sortBy) setSortBy(p.sortBy)
      if (typeof p.onlyOverdue === 'boolean') setOnlyOverdue(p.onlyOverdue)
      if (typeof p.onlyUnassigned === 'boolean') setOnlyUnassigned(p.onlyUnassigned)
    } catch { /* localStorage no disponible: usar defaults */ }
  }, [prefsKey])
  useEffect(() => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify({ groupBy, sortBy, onlyOverdue, onlyUnassigned }))
    } catch { /* ignore */ }
  }, [prefsKey, groupBy, sortBy, onlyOverdue, onlyUnassigned])

  const now = Date.now()
  const isOverdue = (t: ScrumTask) =>
    t.status?.category !== 'done' && !!t.due_date && new Date(t.due_date).getTime() < now

  // Solo mostramos como filtro a quien realmente tiene tareas en el tablero.
  const assignees = useMemo(() => {
    const seen = new Map<string, ScrumMember>()
    for (const t of tasks) {
      if (t.assignee && !seen.has(t.assignee.id)) {
        const m = members.find(x => x.id === t.assignee!.id)
        seen.set(t.assignee.id, m ?? { ...t.assignee, role: 'member' })
      }
    }
    return [...seen.values()]
  }, [tasks, members])

  // Proyectos presentes en el tablero (el equipo agrega varios). Color estable
  // por proyecto para leer "de dónde viene" cada tarjeta y para agrupar/filtrar.
  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tasks) if (!seen.has(t.project_id)) seen.set(t.project_id, t.project_name)
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, name }))
  }, [tasks])
  const projectColor = useMemo(() => {
    const m = new Map<string, string>()
    projects.forEach((p, i) => m.set(p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]))
    return m
  }, [projects])
  const multiProject = projects.length > 1

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks.filter(t => {
      if (onlyUnassigned && t.assignee) return false
      if (pick.size > 0 && (!t.assignee || !pick.has(t.assignee.id))) return false
      if (pickProject.size > 0 && !pickProject.has(t.project_id)) return false
      if (onlyOverdue && !isOverdue(t)) return false
      if (q && !`${t.title} ${t.area ?? ''} ${t.project_name}`.toLowerCase().includes(q)) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, query, pick, pickProject, onlyOverdue, onlyUnassigned])

  const dragTask = dragId ? visible.find(t => t.id === dragId) ?? null : null
  // Limite sano derivado (2 por miembro) como respaldo cuando no hay config.
  const derivedWip = Math.max(members.length * 2, 3)
  // Limite efectivo por columna: el configurado gana; si no, solo "en curso"
  // usa el derivado (las demas columnas no tienen tope salvo que se configure).
  const effWip = (cat: string): number | null => {
    const v = wipCfg[cat]
    if (typeof v === 'number') return v
    return cat === 'in_progress' ? derivedWip : null
  }
  const wipLimit = effWip('in_progress') as number
  const filtering = query.trim() !== '' || pick.size > 0 || pickProject.size > 0 || onlyOverdue || onlyUnassigned

  // Resumen de salud del tablero: lectura rápida de qué tan sano está el flujo.
  const health = useMemo(() => {
    const atRisk = visible.filter(isOverdue).length
    const unestimated = visible.filter(t => t.story_points == null).length
    const inProgress = visible.filter(t => (t.status?.category ?? 'todo') === 'in_progress').length
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return { total: visible.length, atRisk, unestimated, inProgress }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // Carriles (swimlanes): agrupan el tablero horizontalmente. Cada carril
  // vuelve a renderizar las 3 columnas estándar con su subconjunto de tareas.
  const lanes = useMemo(() => {
    if (groupBy === 'none') return [{ id: '__all', label: '', items: visible }]
    if (groupBy === 'assignee') {
      const out: { id: string; label: string; avatar: string | null; items: ScrumTask[] }[] = []
      for (const m of members) {
        const items = visible.filter(t => t.assignee?.id === m.id)
        if (items.length) out.push({ id: m.id, label: m.display_name, avatar: m.avatar_url, items })
      }
      const un = visible.filter(t => !t.assignee)
      if (un.length) out.push({ id: '__unassigned', label: 'Sin asignar', avatar: null, items: un })
      return out
    }
    if (groupBy === 'project') {
      return projects
        .map(p => ({ id: p.id, label: p.name, items: visible.filter(t => t.project_id === p.id) }))
        .filter(l => l.items.length)
    }
    // priority
    const order: { key: string; label: string }[] = [
      { key: 'urgent', label: 'Urgente' }, { key: 'high', label: 'Alta' },
      { key: 'medium', label: 'Media' }, { key: 'low', label: 'Baja' }, { key: 'none', label: 'Sin prioridad' },
    ]
    return order
      .map(o => ({ id: o.key, label: o.label, items: visible.filter(t => (t.priority || 'none') === o.key) }))
      .filter(l => l.items.length)
  }, [groupBy, visible, members, projects])

  function canDropHere(cat: string): boolean {
    if (!dragTask) return false
    if ((dragTask.status?.category ?? 'todo') === cat) return false
    return !!statusFor.get(dragTask.project_id)?.has(cat)
  }

  function handleDrop(cat: string) {
    const t = dragId ? visible.find(x => x.id === dragId) : null
    setDragId(null); setOverKey(null)
    if (!t) return
    if ((t.status?.category ?? 'todo') === cat) return
    if (!statusFor.get(t.project_id)?.has(cat)) { toast.error('Ese proyecto no tiene un estado de esa columna'); return }
    onMove(t, cat)
  }

  function togglePick(id: string) {
    setPick(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function togglePickProject(id: string) {
    setPickProject(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // Render de las 3 columnas para un carril dado. Se comparte entre el modo
  // sin agrupar (un solo carril) y el modo con carriles.
  function renderColumns(laneId: string, laneTasks: ScrumTask[]) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SCRUM_COLUMNS.map(col => {
          const cm = colMeta(col.category)
          const ColIcon = cm.Icon
          const colTasks = sortTasks(
            laneTasks.filter(t => (t.status?.category ?? 'todo') === col.category),
            sortBy,
          )
          const pts = colTasks.reduce((a, t) => a + (t.story_points ?? 0), 0)
          const droppable = canDropHere(col.category)
          const thisKey = `${laneId}:${col.category}`
          const isOver = overKey === thisKey && droppable
          // Alerta de WIP: solo tiene sentido sin carriles (el límite es del
          // equipo, no por persona). En Kanban la columna "en curso" no debería
          // rebasar el límite sano (2 por persona); si lo hace, se atasca.
          const colLimit = effWip(col.category)
          const wipWarn = kanban && groupBy === 'none' && colLimit != null && colTasks.length > colLimit
          return (
            <div
              key={col.category}
              onDragOver={e => { if (droppable) { e.preventDefault(); setOverKey(thisKey) } }}
              onDragLeave={() => setOverKey(k => (k === thisKey ? null : k))}
              onDrop={e => { e.preventDefault(); handleDrop(col.category) }}
              className={cn(
                'rounded-xl p-3 transition-colors',
                isOver ? cn(cm.overBg, 'ring-2', cm.overRing) : 'bg-muted/30',
                dragTask && droppable && !isOver && cn('ring-1 ring-dashed', cm.hintRing),
              )}
            >
              <div className="mb-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className={cn('text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5', cm.header)}>
                    <ColIcon className={cn('w-3.5 h-3.5', col.category === 'in_progress' && 'animate-spin [animation-duration:3s]')} />
                    {col.label}
                    {wipWarn && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" aria-label={`WIP alto: ${colTasks.length} (límite ${colLimit})`} />}
                  </h3>
                  {kanban ? (
                    // Kanban se rige por límite WIP (conteo), no por story points.
                    // Muestra el tope en cualquier columna que tenga uno efectivo.
                    colLimit != null ? (
                      <span className={cn(
                        'text-[11px] tabular-nums px-1.5 py-0.5 rounded-full font-medium',
                        colTasks.length > colLimit ? 'bg-orange-100 text-orange-700' : 'bg-blue-500/10 text-blue-600',
                      )}>
                        {colTasks.length} / {colLimit} WIP
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground tabular-nums">{colTasks.length}</span>
                    )
                  ) : (
                    // Scrum se rige por story points comprometidos.
                    <span className="text-[11px] text-muted-foreground tabular-nums">{colTasks.length} · {pts} SP</span>
                  )}
                </div>
                <div className={cn('h-0.5 rounded-full mt-1.5', kanban && col.category === 'in_progress' ? 'bg-blue-400' : cm.bar)} />
              </div>
              <div className="space-y-2">
                {colTasks.map(t => {
                  const pm = prioMeta(t.priority)
                  const PrioIcon = pm.Icon
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => { setDragId(null); setOverKey(null) }}
                      className={cn(
                        'bg-card border border-border rounded-lg p-2.5 shadow-sm cursor-grab active:cursor-grabbing',
                        'transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-ring/60',
                        dragId === t.id && 'opacity-40',
                      )}
                    >
                      {multiProject && groupBy !== 'project' && (
                        <div className="flex items-center gap-1 mb-1.5" title={`Proyecto: ${t.project_name}`}>
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: projectColor.get(t.project_id) ?? '#94a3b8' }} />
                          <span className="text-[10px] font-medium text-muted-foreground truncate">{t.project_name}</span>
                        </div>
                      )}
                      <div className="flex items-start gap-1.5 mb-2">
                        <PrioIcon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', pm.className)} aria-label={`Prioridad: ${pm.label}`} />
                        <button
                          type="button"
                          onClick={() => onOpen(t.id)}
                          className="text-sm text-foreground leading-snug flex-1 text-left hover:text-primary hover:underline underline-offset-2 decoration-primary/40 transition-colors"
                          title="Abrir tarea"
                        >
                          {t.title}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Avatar a={t.assignee} />
                          {t.area && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground truncate max-w-[84px]">{t.area}</span>}
                          {t.due_date && <DueBadge due={t.due_date} done={t.status?.category === 'done'} />}
                        </div>
                        <PointsSelect value={t.story_points} onChange={p => onPoints(t, p)} />
                      </div>
                      <div className="flex items-center gap-1 mt-2">
                        <span className="text-[10px] text-muted-foreground mr-0.5">Mover</span>
                        {SCRUM_COLUMNS.filter(c => c.category !== col.category).map(c => {
                          const canMove = statusFor.get(t.project_id)?.has(c.category)
                          const target = colMeta(c.category)
                          const TIcon = target.Icon
                          return (
                            <button
                              key={c.category}
                              disabled={!canMove}
                              onClick={() => onMove(t, c.category)}
                              title={canMove ? `Mover a ${c.label}` : 'Sin estado equivalente'}
                              className="leading-none p-1 rounded-md border border-border hover:border-ring hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <TIcon className={cn('w-3.5 h-3.5', target.header)} />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {colTasks.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-1 py-3 text-center">
                    {isOver ? 'Suelta aquí' : droppable ? 'Suelta aquí' : filtering ? 'Nada con estos filtros' : 'Vacío'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (tasks.length === 0) return (
    <p className="text-sm text-muted-foreground">
      {kanban
        ? 'Todavía no hay tareas en el equipo. Crea tareas en los proyectos y aparecerán aquí en el flujo.'
        : 'Este sprint no tiene tareas todavía. Mándalas desde el Backlog.'}
    </p>
  )

  const GROUPS: [GroupKey, string, LucideIcon | null][] = [
    ['none', 'Ninguno', null], ['assignee', 'Persona', Users], ['priority', 'Prioridad', Flag],
  ]
  // Agrupar por proyecto solo aporta si el tablero mezcla varios proyectos.
  if (multiProject) GROUPS.push(['project', 'Proyecto', Layers])

  return (
    <div className="space-y-4">
      {/* Banner de modo: distingue Scrum de Kanban de un vistazo */}
      {kanban ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
          <Columns3 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-700">Flujo continuo (Kanban)</p>
            <p className="text-[11px] text-muted-foreground">
              Sin sprints: las tareas fluyen de izquierda a derecha. Vigila el límite WIP para no saturar &quot;En curso&quot;.
            </p>
          </div>
          {canConfigureWip && (
            <div className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setWipOpen(o => !o)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 px-2 py-1 rounded-md hover:bg-blue-500/10 transition-colors"
                aria-haspopup="dialog"
                aria-expanded={wipOpen}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" /> Límites WIP
              </button>
              {wipOpen && (
                <WipConfigMenu
                  current={wipCfg}
                  onClose={() => setWipOpen(false)}
                  onSave={next => { onSaveWip?.(next); setWipOpen(false) }}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <Timer className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">Sprint activo (Scrum)</p>
            <p className="text-[11px] text-muted-foreground">
              Alcance fijo por sprint: mide avance en story points y cierra al terminar la iteración.
            </p>
          </div>
        </div>
      )}

      {/* Puente de contexto: si el equipo tiene UN solo proyecto, esta Planeación
          y el tablero del proyecto se ven casi iguales. Aclaramos la diferencia
          para que no se lea como redundante: aquí planeas {sprint|flujo} del
          equipo; el proyecto guarda sus estados detallados. */}
      {!multiProject && soloProject && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-0.5">
          <span>
            {kanban
              ? 'Planeación del equipo: gestiona el flujo continuo.'
              : 'Planeación del equipo: organiza el trabajo en sprints.'}{' '}
            El detalle por estados vive en el tablero del proyecto.
          </span>
          <Link
            href={soloProject.href}
            className="inline-flex items-center gap-0.5 font-medium text-foreground hover:text-primary transition-colors"
          >
            {soloProject.name}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* Barra de control */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Búsqueda */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar tarea, área…"
            className="text-[11px] pl-7 pr-2 py-1.5 rounded-md border border-border bg-background text-foreground w-44 focus:w-56 transition-all focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {assignees.length > 0 && (
          <div className="flex items-center gap-1">
            {assignees.map(m => {
              const on = pick.has(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => togglePick(m.id)}
                  title={m.display_name}
                  aria-label={`Filtrar por ${m.display_name}`}
                  aria-pressed={on}
                  className={cn(
                    'rounded-full transition-transform',
                    on ? 'ring-2 ring-primary scale-110' : 'opacity-50 hover:opacity-100',
                  )}
                >
                  <Avatar a={m} />
                </button>
              )
            })}
          </div>
        )}
        {multiProject && (
          <div className="flex items-center gap-1 flex-wrap">
            {projects.map(p => {
              const on = pickProject.has(p.id)
              const color = projectColor.get(p.id) ?? '#94a3b8'
              return (
                <button
                  key={p.id}
                  onClick={() => togglePickProject(p.id)}
                  title={`Ver solo ${p.name}`}
                  aria-label={`Ver solo ${p.name}`}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-colors max-w-[150px]',
                    on ? 'border-transparent text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                  style={on ? { backgroundColor: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}` } : undefined}
                >
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <span className="truncate">{p.name}</span>
                </button>
              )
            })}
          </div>
        )}
        <button
          onClick={() => setOnlyOverdue(v => !v)}
          aria-label="Filtrar tareas vencidas"
          aria-pressed={onlyOverdue}
          className={cn(
            'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-colors',
            onlyOverdue ? 'bg-orange-100 text-orange-700 border-orange-200' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <Flame className="w-3 h-3" /> Vencidas
        </button>
        <button
          onClick={() => setOnlyUnassigned(v => !v)}
          aria-label="Filtrar tareas sin asignar"
          aria-pressed={onlyUnassigned}
          className={cn(
            'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-colors',
            onlyUnassigned ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <UserX className="w-3 h-3" /> Sin asignar
        </button>
        {filtering && (
          <button
            onClick={() => { setQuery(''); setPick(new Set()); setPickProject(new Set()); setOnlyOverdue(false); setOnlyUnassigned(false) }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" /> Limpiar
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {/* Agrupar en carriles */}
          <div className="inline-flex items-center gap-0.5 bg-muted rounded-md p-0.5" role="group" title="Agrupar en carriles">
            {GROUPS.map(([val, lbl, GIcon]) => (
              <button
                key={val}
                onClick={() => setGroupBy(val)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors',
                  groupBy === val ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {GIcon && <GIcon className="w-3 h-3" />} {lbl}
              </button>
            ))}
          </div>
          {/* Orden dentro de columna */}
          <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ArrowDownUp className="w-3 h-3" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="text-[11px] border border-border rounded-md px-1.5 py-1 bg-background text-foreground"
            >
              <option value="manual">Natural</option>
              <option value="priority">Prioridad</option>
              <option value="due">Fecha límite</option>
              <option value="points">Story points</option>
            </select>
          </div>
        </div>
      </div>

      {/* Resumen de salud */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground">
          <Columns3 className="w-3 h-3" /> {health.total} visibles
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/10 text-blue-600">
          <Timer className="w-3 h-3" /> {health.inProgress} en curso
        </span>
        <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full', health.atRisk > 0 ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground')}>
          <Flame className="w-3 h-3" /> {health.atRisk} en riesgo
        </span>
        {kanban ? (
          <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full', health.inProgress > wipLimit ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground')}>
            <Columns3 className="w-3 h-3" /> WIP {health.inProgress}/{wipLimit}
          </span>
        ) : (
          <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full', health.unestimated > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground')}>
            <Minus className="w-3 h-3" /> {health.unestimated} sin estimar
          </span>
        )}
      </div>

      {/* Tablero: uno o varios carriles */}
      {groupBy === 'none'
        ? renderColumns('__all', visible)
        : (
          <div className="space-y-5">
            {lanes.map(lane => (
              <div key={lane.id}>
                <div className="flex items-center gap-2 mb-2">
                  {groupBy === 'assignee'
                    ? <Avatar a={{ id: lane.id, display_name: lane.label, avatar_url: (lane as { avatar: string | null }).avatar ?? null }} />
                    : groupBy === 'project'
                      ? <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: projectColor.get(lane.id) ?? '#94a3b8' }} />
                      : <Flag className="w-3.5 h-3.5 text-muted-foreground" />}
                  <span className="text-xs font-semibold text-foreground">{lane.label}</span>
                  <span className="text-[10px] text-muted-foreground">{lane.items.length}</span>
                </div>
                {renderColumns(lane.id, lane.items)}
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Configurador de límites WIP por columna (Kanban, solo admin)               */
/* ════════════════════════════════════════════════════════════════════════ */
function WipConfigMenu({
  current, onClose, onSave,
}: {
  current: Record<string, number | null>
  onClose: () => void
  onSave: (next: Record<string, number | null>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const toStr = (v: number | null | undefined) => (typeof v === 'number' ? String(v) : '')
  const [draft, setDraft] = useState<Record<string, string>>({
    todo:        toStr(current.todo),
    in_progress: toStr(current.in_progress),
    done:        toStr(current.done),
  })

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function commit() {
    const parseOne = (s: string): number | null => {
      const n = parseInt(s, 10)
      if (!Number.isFinite(n)) return null
      return Math.min(99, Math.max(1, n))
    }
    onSave({
      todo:        parseOne(draft.todo),
      in_progress: parseOne(draft.in_progress),
      done:        parseOne(draft.done),
    })
  }

  return (
    <div
      ref={ref}
      role="dialog"
      className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl border border-border bg-popover shadow-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-foreground">Límites WIP por columna</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Máximo de tarjetas por columna. Vacío = automático (2 por miembro en &quot;En progreso&quot;).
      </p>
      <div className="space-y-2">
        {SCRUM_COLUMNS.map(col => (
          <div key={col.category} className="flex items-center justify-between gap-2">
            <label htmlFor={`wip-${col.category}`} className="text-xs text-foreground">{col.label}</label>
            <input
              id={`wip-${col.category}`}
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              placeholder="Auto"
              value={draft[col.category] ?? ''}
              onChange={e => setDraft(d => ({ ...d, [col.category]: e.target.value }))}
              className="w-16 text-xs tabular-nums px-2 py-1 rounded-md border border-border bg-background text-right focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 mt-3">
        <button
          type="button"
          onClick={() => setDraft({ todo: '', in_progress: '', done: '' })}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Restablecer
        </button>
        <button
          type="button"
          onClick={commit}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Backlog: estimar + mandar a sprint                                         */
/* ════════════════════════════════════════════════════════════════════════ */
function BacklogView({
  backlog, sprints, onPoints, onAssign, onOpen,
}: {
  backlog: ScrumTask[]
  sprints: ScrumSprint[]
  onPoints: (t: ScrumTask, p: number | null) => void
  onAssign: (taskId: string, sprintId: string | null) => void
  onOpen: (id: string) => void
}) {
  const openSprints = sprints.filter(s => s.status !== 'completed')
  const now = Date.now()

  // Buscador cliente: el backlog crece y encontrar una tarea a ojo es lento.
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return backlog
    return backlog.filter(t => `${t.title} ${t.area ?? ''} ${t.project_name}`.toLowerCase().includes(q))
  }, [backlog, query])

  // Resumen del backlog: total, estimadas y puntos comprometidos de un vistazo.
  const totalPts = backlog.reduce((a, t) => a + (t.story_points ?? 0), 0)
  const estimated = backlog.filter(t => t.story_points != null).length
  const unestimated = backlog.length - estimated

  if (backlog.length === 0) {
    return (
      <div className="border-2 border-dashed border-border rounded-xl p-12 text-center max-w-lg mx-auto mt-8">
        <Inbox className="w-9 h-9 mx-auto mb-3 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground mb-1">Backlog vacío</h3>
        <p className="text-sm text-muted-foreground">Todas las tareas del equipo están en algún sprint.</p>
      </div>
    )
  }

  // Agrupar por área (orden estable por nombre) para lectura por frente de trabajo.
  const groups = new Map<string, ScrumTask[]>()
  for (const t of filtered) {
    const k = t.area || 'Sin área'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }
  const areaEntries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Banda de contexto: qué es el backlog + salud de estimación */}
      <div className="rounded-xl border border-border bg-gradient-to-r from-primary/[0.07] to-transparent px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/15 text-primary">
            <Inbox className="w-4 h-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground leading-none">Backlog del equipo</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Estima en story points (Fibonacci) y manda cada tarea a un sprint.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card border border-border font-medium text-foreground">
            <Layers className="w-3.5 h-3.5 text-violet-500" /> {backlog.length} tareas
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card border border-border font-medium text-foreground">
            <Gauge className="w-3.5 h-3.5 text-primary" /> {totalPts} SP
          </span>
          <span className={cn(
            'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium',
            unestimated > 0 ? 'bg-amber-500/10 border-amber-500/30 text-amber-600' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
          )}>
            {unestimated > 0 ? <Minus className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {unestimated > 0 ? `${unestimated} sin estimar` : 'Todo estimado'}
          </span>
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar en el backlog…"
              className="w-48 text-xs pl-8 pr-2.5 py-1.5 rounded-full border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground rounded-xl bg-muted/30 border border-dashed border-border">
          <Search className="w-6 h-6 opacity-40" />
          Ninguna tarea coincide con la búsqueda.
        </div>
      )}

      {areaEntries.map(([area, items], ai) => {
        const accent = AREA_COLORS[ai % AREA_COLORS.length]
        const areaPts = items.reduce((a, t) => a + (t.story_points ?? 0), 0)
        return (
          <div key={area}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{area}</h3>
              <span className="text-[11px] text-muted-foreground tabular-nums">{items.length} · {areaPts} SP</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-2">
              {items.map(t => {
                const pm = prioMeta(t.priority)
                const PrioIcon = pm.Icon
                const overdue = !!t.due_date && !(t.status?.category === 'done') && new Date(t.due_date).getTime() < now
                return (
                  <div
                    key={t.id}
                    className="group flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-2.5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-ring/60"
                    style={{ borderLeft: `3px solid ${accent}` }}
                  >
                    <PrioIcon className={cn('w-4 h-4 shrink-0', pm.className)} aria-label={`Prioridad: ${pm.label}`} />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        className="block w-full text-left text-sm text-foreground truncate hover:text-primary hover:underline underline-offset-2 decoration-primary/40 transition-colors"
                        title="Abrir tarea"
                      >
                        {t.title}
                      </button>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground truncate">{t.project_name}</span>
                        {t.due_date && <DueBadge due={t.due_date} done={t.status?.category === 'done'} />}
                        {overdue && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600">
                            <Flame className="w-3 h-3" /> vencida
                          </span>
                        )}
                      </div>
                    </div>
                    <Avatar a={t.assignee} />
                    <PointsSelect value={t.story_points} onChange={p => onPoints(t, p)} />
                    <select
                      value=""
                      onChange={e => e.target.value && onAssign(t.id, e.target.value)}
                      className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background text-foreground font-medium hover:border-ring focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                      title="Enviar a un sprint"
                    >
                      <option value="">Enviar a…</option>
                      {openSprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Daily standup: sprint activo agrupado por persona                          */
/* ════════════════════════════════════════════════════════════════════════ */
function StandupView({
  sprint, tasks, members, onOpen,
}: {
  sprint: ScrumSprint | null
  tasks: ScrumTask[]
  members: ScrumMember[]
  onOpen: (id: string) => void
}) {
  // bucket por persona + sin asignar
  const byPerson = new Map<string, ScrumTask[]>()
  for (const m of members) byPerson.set(m.id, [])
  const unassigned: ScrumTask[] = []
  for (const t of tasks) {
    if (t.assignee && byPerson.has(t.assignee.id)) byPerson.get(t.assignee.id)!.push(t)
    else if (t.assignee) { if (!byPerson.has(t.assignee.id)) byPerson.set(t.assignee.id, []); byPerson.get(t.assignee.id)!.push(t) }
    else unassigned.push(t)
  }

  const rows = members.map(m => ({ member: m, items: byPerson.get(m.id) ?? [] }))
    .filter(r => r.items.length > 0)

  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{sprint ? `El sprint ${sprint.name} no tiene tareas.` : 'No hay tareas asignadas todavía.'}</p>

  return (
    <div className="space-y-4 max-w-4xl">
      {rows.map(({ member, items }) => <PersonStandup key={member.id} name={member.display_name} avatar={member.avatar_url} items={items} onOpen={onOpen} />)}
      {unassigned.length > 0 && <PersonStandup name="Sin asignar" avatar={null} items={unassigned} onOpen={onOpen} />}
    </div>
  )
}

function PersonStandup({ name, avatar, items, onOpen }: { name: string; avatar: string | null; items: ScrumTask[]; onOpen: (id: string) => void }) {
  const committed = items.reduce((a, t) => a + (t.story_points ?? 0), 0)
  const done = items.filter(t => t.status?.category === 'done')
  const donePts = done.reduce((a, t) => a + (t.story_points_done ?? t.story_points ?? 0), 0)
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Avatar a={{ id: name, display_name: name, avatar_url: avatar }} />
          <span className="text-sm font-medium text-foreground">{name}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">{done.length}/{items.length} hechas · {donePts}/{committed} SP</span>
      </div>
      <div className="space-y-0.5">
        {items.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className="w-full flex items-center gap-2 text-sm text-left rounded-md px-1.5 py-1 -mx-1.5 hover:bg-muted transition-colors"
            title="Abrir tarea"
          >
            <CategoryDot category={t.status?.category} />
            <span className={cn('flex-1 truncate', t.status?.category === 'done' && 'text-muted-foreground line-through')}>{t.title}</span>
            {t.story_points != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{t.story_points}</span>}
            {t.due_date && <DueBadge due={t.due_date} done={t.status?.category === 'done'} />}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Dashboard: KPIs del sprint                                                  */
/* ════════════════════════════════════════════════════════════════════════ */
function DashboardView({
  sprint, sprintTasks, allSprints, allTasks, members,
}: {
  sprint: ScrumSprint
  sprintTasks: ScrumTask[]
  allSprints: ScrumSprint[]
  allTasks: ScrumTask[]
  members: ScrumMember[]
}) {
  const k = useMemo(() => computeKpis(sprint, sprintTasks, allSprints, allTasks), [sprint, sprintTasks, allSprints, allTasks])

  const areaData = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of sprintTasks) {
      const key = t.area || 'Sin área'
      m.set(key, (m.get(key) ?? 0) + (t.story_points ?? 1))
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }))
  }, [sprintTasks])

  const personData = useMemo(() => {
    const m = new Map<string, { committed: number; done: number }>()
    for (const t of sprintTasks) {
      const key = t.assignee?.display_name ?? 'Sin asignar'
      const cur = m.get(key) ?? { committed: 0, done: 0 }
      cur.committed += t.story_points ?? 0
      if (t.status?.category === 'done') cur.done += t.story_points_done ?? t.story_points ?? 0
      m.set(key, cur)
    }
    return [...m.entries()].map(([name, v]) => ({ name: name.split(' ')[0], ...v }))
  }, [sprintTasks])

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Banda de contexto: deja claro que este es el panel de SPRINT (Scrum). */}
      <div className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 to-transparent px-4 py-2.5">
        <Timer className="w-4 h-4 text-primary flex-shrink-0" />
        <p className="text-xs text-foreground">
          <span className="font-semibold text-primary">Panel de sprint</span>
          <span className="text-muted-foreground"> · {sprint.name}. Mide velocity, avance y precisión de estimación por iteración.</span>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Score icon={Target} accent="blue" label="Avance" value={`${k.progressPct}%`} sub={`${k.doneCount}/${k.totalCount} tareas`} />
        <Score icon={Gauge} accent="violet" label="Story points" value={`${k.completedSP}/${k.committedSP}`} sub="completados / comprometidos" />
        <Score icon={CalendarClock} accent="green" label="On-time delivery" value={k.onTimePct == null ? 'n/d' : `${k.onTimePct}%`} sub={`${k.onTimeCount}/${k.dueDoneCount} con fecha`} />
        <Score icon={AlertTriangle} accent="rose" label="En riesgo" value={`${k.atRisk}`} sub="vencidas sin cerrar" tone={k.atRisk > 0 ? 'warn' : 'ok'} />
        <Score icon={TrendingUp} accent="green" label="Velocity (prom.)" value={k.velocity == null ? 'n/d' : `${k.velocity}`} sub="SP / sprint cerrado" />
        <Score icon={Target} accent="blue" label="Precisión estimación" value={k.estAccuracy == null ? 'n/d' : `${k.estAccuracy}%`} sub="real vs estimado" />
        <Score icon={Users} accent="slate" label="Capacidad" value={`${members.length}`} sub="personas en el equipo" />
        <Score icon={Minus} accent="amber" label="Sin estimar" value={`${k.unestimated}`} sub="tareas sin story points" tone={k.unestimated > 0 ? 'warn' : 'ok'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Mix por área (story points)" icon={PieIcon}>
          {areaData.length === 0 ? <Empty hint="Este sprint aún no tiene tareas asignadas." /> : (
            <ScrumChart variant="areaPie" data={areaData} height={240} />
          )}
        </ChartCard>
        <ChartCard title="Carga por persona (SP)" icon={Users}>
          {personData.length === 0 ? <Empty hint="Este sprint aún no tiene tareas asignadas." /> : (
            <ScrumChart variant="personSP" data={personData} height={240} />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Dashboard Kanban: métricas de FLUJO (no de sprint)                         */
/* ════════════════════════════════════════════════════════════════════════ */
function KanbanDashboard({ tasks, members }: { tasks: ScrumTask[]; members: ScrumMember[] }) {
  const k = useMemo(() => {
    const byCat = (cat: string) => tasks.filter(t => (t.status?.category ?? 'todo') === cat)
    const notStarted = byCat('todo').length
    const inProgress = byCat('in_progress').length
    const done = byCat('done').length
    const total = tasks.length
    // WIP = trabajo en curso. Es la métrica reina de Kanban: si sube, el flujo
    // se atasca. La comparamos contra un límite sano sugerido (2 por persona).
    const wipLimit = Math.max(members.length * 2, 3)
    const overdue = tasks.filter(t => t.status?.category !== 'done' && t.due_date && new Date(t.due_date) < new Date()).length
    const unassigned = tasks.filter(t => !t.assignee && t.status?.category !== 'done').length
    const throughputPct = total ? Math.round((done / total) * 100) : 0
    return { notStarted, inProgress, done, total, wipLimit, overdue, unassigned, throughputPct }
  }, [tasks, members])

  // Distribución por columna (barras) = foto del flujo ahora mismo.
  const flowData = useMemo(() => (
    SCRUM_COLUMNS.map(c => ({
      name: c.label,
      value: tasks.filter(t => (t.status?.category ?? 'todo') === c.category).length,
    }))
  ), [tasks])

  const areaData = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks) {
      const key = t.area || 'Sin área'
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }))
  }, [tasks])

  const personData = useMemo(() => {
    const m = new Map<string, { activas: number; hechas: number }>()
    for (const t of tasks) {
      const key = t.assignee?.display_name ?? 'Sin asignar'
      const cur = m.get(key) ?? { activas: 0, hechas: 0 }
      if (t.status?.category === 'done') cur.hechas += 1
      else cur.activas += 1
      m.set(key, cur)
    }
    return [...m.entries()].map(([name, v]) => ({ name: name.split(' ')[0], ...v }))
  }, [tasks])

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Banda de contexto: deja claro que este es el panel de FLUJO (Kanban). */}
      <div className="flex items-center gap-2.5 rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-500/10 to-transparent px-4 py-2.5">
        <Columns3 className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <p className="text-xs text-foreground">
          <span className="font-semibold text-blue-700">Panel de flujo</span>
          <span className="text-muted-foreground"> · salud del trabajo continuo, sin sprints. La métrica clave es el WIP.</span>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Score icon={Loader2} accent="blue" label="En curso (WIP)" value={`${k.inProgress}`} sub={`límite sano ${k.wipLimit}`} tone={k.inProgress > k.wipLimit ? 'warn' : 'ok'} />
        <Score icon={CheckCircle2} accent="green" label="Completadas" value={`${k.done}`} sub={`${k.throughputPct}% del total`} />
        <Score icon={Inbox} accent="slate" label="Por hacer" value={`${k.notStarted}`} sub="esperando en la fila" />
        <Score icon={Layers} accent="violet" label="Total en flujo" value={`${k.total}`} sub="tareas del equipo" />
        <Score icon={AlertTriangle} accent="rose" label="Vencidas sin cerrar" value={`${k.overdue}`} sub="cuellos de botella" tone={k.overdue > 0 ? 'warn' : 'ok'} />
        <Score icon={UserX} accent="amber" label="Sin asignar" value={`${k.unassigned}`} sub="activas sin dueño" tone={k.unassigned > 0 ? 'warn' : 'ok'} />
        <Score icon={Users} accent="slate" label="Capacidad" value={`${members.length}`} sub="personas en el equipo" />
        <Score icon={Target} accent="green" label="Ratio de cierre" value={`${k.throughputPct}%`} sub="hechas / totales" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Distribución por columna" icon={Columns3}>
          {k.total === 0 ? <Empty hint="Este equipo aún no tiene tareas." /> : (
            <ScrumChart variant="flowBars" data={flowData} height={220} />
          )}
        </ChartCard>
        <ChartCard title="Carga por persona (tareas)" icon={Users}>
          {personData.length === 0 ? <Empty hint="Este equipo aún no tiene tareas." /> : (
            <ScrumChart variant="personTasks" data={personData} height={220} />
          )}
        </ChartCard>
        <ChartCard title="Mix por área (tareas)" icon={PieIcon} span2>
          {areaData.length === 0 ? <Empty hint="Aún no hay tareas con área asignada." /> : (
            <ScrumChart variant="areaPie" data={areaData} height={240} />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function computeKpis(sprint: ScrumSprint, sprintTasks: ScrumTask[], allSprints: ScrumSprint[], allTasks: ScrumTask[]) {
  const totalCount = sprintTasks.length
  const doneTasks = sprintTasks.filter(t => t.status?.category === 'done')
  const doneCount = doneTasks.length
  const progressPct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0

  const committedSP = sprintTasks.reduce((a, t) => a + (t.story_points ?? 0), 0)
  const completedSP = doneTasks.reduce((a, t) => a + (t.story_points_done ?? t.story_points ?? 0), 0)

  // On-time: de las hechas con fecha, las cerradas a tiempo (updated_at <= fin del día due)
  const dueDone = doneTasks.filter(t => t.due_date)
  const onTimeCount = dueDone.filter(t => {
    const due = new Date(t.due_date!); due.setHours(23, 59, 59, 999)
    return new Date(t.updated_at) <= due
  }).length
  const dueDoneCount = dueDone.length
  const onTimePct = dueDoneCount ? Math.round((onTimeCount / dueDoneCount) * 100) : null

  // En riesgo: no hechas, con fecha vencida
  const now = new Date()
  const atRisk = sprintTasks.filter(t => t.status?.category !== 'done' && t.due_date && new Date(t.due_date) < now).length

  const unestimated = sprintTasks.filter(t => t.story_points == null).length

  // Velocity: promedio de SP completados en sprints cerrados
  const completedSprints = allSprints.filter(s => s.status === 'completed')
  let velocity: number | null = null
  if (completedSprints.length) {
    const totals = completedSprints.map(s =>
      allTasks.filter(t => t.sprint_id === s.id && t.status?.category === 'done')
        .reduce((a, t) => a + (t.story_points_done ?? t.story_points ?? 0), 0)
    )
    velocity = Math.round(totals.reduce((a, b) => a + b, 0) / completedSprints.length)
  }

  // Precisión de estimación: prom de (done/estimado) en tareas con ambos
  const withBoth = doneTasks.filter(t => t.story_points && t.story_points_done)
  let estAccuracy: number | null = null
  if (withBoth.length) {
    const ratios = withBoth.map(t => {
      const r = t.story_points_done! / t.story_points!
      // Cercanía a 1.0 (penaliza tanto sobre como sub estimación)
      return 1 - Math.min(Math.abs(r - 1), 1)
    })
    estAccuracy = Math.round((ratios.reduce((a, b) => a + b, 0) / withBoth.length) * 100)
  }

  return {
    totalCount, doneCount, progressPct, committedSP, completedSP,
    onTimePct, onTimeCount, dueDoneCount, atRisk, unestimated, velocity, estAccuracy,
  }
}

/* ── Átomos UI ──────────────────────────────────────────────────────────── */
// Tira de presencia: los avatares de los OTROS miembros viendo el scrum ahora.
// Punto verde con pulso = señal de "en vivo". Máx 4 + contador "+N".
function PresenceStrip({ viewers }: { viewers: Viewer[] }) {
  const shown = viewers.slice(0, 4)
  const extra = viewers.length - shown.length
  return (
    <div className="flex items-center gap-1.5" title={`${viewers.length} viendo ahora: ${viewers.map(v => v.name).join(', ')}`}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <div className="flex -space-x-1.5">
        {shown.map(v => (
          v.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={v.userId} src={v.avatarUrl} alt={v.name} title={v.name}
              className="w-5 h-5 rounded-full object-cover ring-2 ring-background" />
          ) : (
            <span key={v.userId} title={v.name}
              className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-medium ring-2 ring-background">
              {v.name.charAt(0).toUpperCase()}
            </span>
          )
        ))}
      </div>
      {extra > 0 && <span className="text-[10px] text-muted-foreground">+{extra}</span>}
    </div>
  )
}

type Accent = 'blue' | 'green' | 'amber' | 'violet' | 'rose' | 'slate'
const ACCENT: Record<Accent, { chip: string; hover: string }> = {
  blue:   { chip: 'bg-blue-500/10 text-blue-600',       hover: 'hover:border-blue-500/40' },
  green:  { chip: 'bg-emerald-500/10 text-emerald-600', hover: 'hover:border-emerald-500/40' },
  amber:  { chip: 'bg-amber-500/10 text-amber-600',     hover: 'hover:border-amber-500/40' },
  violet: { chip: 'bg-violet-500/10 text-violet-600',   hover: 'hover:border-violet-500/40' },
  rose:   { chip: 'bg-rose-500/10 text-rose-600',       hover: 'hover:border-rose-500/40' },
  slate:  { chip: 'bg-muted text-muted-foreground',     hover: 'hover:border-border' },
}

// Tarjeta de métrica moderna: chip de icono con color de acento, número grande
// tabular y sublínea. En estado de alerta (tone warn) toda la tarjeta se tiñe
// de naranja para que el ojo caiga primero en lo que necesita atención.
function Score({
  label, value, sub, tone, icon: Icon, accent = 'slate',
}: {
  label: string; value: string; sub: string
  tone?: 'ok' | 'warn'; icon?: LucideIcon; accent?: Accent
}) {
  const warn = tone === 'warn'
  const a = ACCENT[accent]
  return (
    <div className={cn(
      'group bg-card border border-border rounded-xl p-3.5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
      warn ? 'border-orange-400/30 hover:border-orange-400/60' : a.hover,
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">{label}</p>
        {Icon && (
          <span className={cn(
            'flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 transition-transform group-hover:scale-110',
            warn ? 'bg-orange-500/10 text-orange-500' : a.chip,
          )}>
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <p className={cn('text-[26px] leading-none font-bold mt-2.5 tabular-nums tracking-tight', warn ? 'text-orange-500' : 'text-foreground')}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">{sub}</p>
    </div>
  )
}

// Contenedor de gráfica con encabezado (icono + título) consistente.
function ChartCard({ title, icon: Icon, span2, children }: {
  title: string; icon: LucideIcon; span2?: boolean; children: ReactNode
}) {
  return (
    <div className={cn('bg-card border border-border rounded-xl p-4 transition-shadow hover:shadow-sm', span2 && 'md:col-span-2')}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h3>
      {children}
    </div>
  )
}

function PointsSelect({ value, onChange }: { value: number | null; onChange: (p: number | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      title="Story points"
      className="text-[11px] border border-border rounded-md px-1 py-0.5 bg-background text-foreground"
    >
      <option value="">SP</option>
      {STORY_POINTS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  )
}

function Avatar({ a }: { a: { id: string; display_name: string; avatar_url: string | null } | null }) {
  if (!a) return <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] text-muted-foreground">?</span>
  if (a.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a.avatar_url} alt={a.display_name} className="w-5 h-5 rounded-full object-cover" />
  }
  return (
    <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-medium">
      {a.display_name.charAt(0).toUpperCase()}
    </span>
  )
}

function CategoryDot({ category }: { category?: string }) {
  const color = category === 'done' ? 'bg-green-500' : category === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'
  return <span className={cn('w-2 h-2 rounded-full flex-shrink-0', color)} />
}

function DueBadge({ due, done }: { due: string; done: boolean }) {
  const overdue = !done && new Date(due) < new Date()
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', overdue ? 'bg-orange-100 text-orange-600' : 'bg-muted text-muted-foreground')}>
      {new Date(due).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="border-2 border-dashed border-border rounded-xl p-12 text-center max-w-lg mx-auto mt-8">
      <Rocket className="w-9 h-9 mx-auto mb-3 text-muted-foreground" />
      <h3 className="text-sm font-medium text-foreground mb-1">Aún no hay sprints</h3>
      <p className="text-sm text-muted-foreground">Crea el primer sprint con el botón &quot;+ Sprint&quot; para empezar a planear el trabajo del equipo.</p>
    </div>
  )
}

// Estado vacío de una gráfica. `hint` explica POR QUÉ está vacía (sin tareas, sin
// story points, sin área) para que no se lea como "cargando" o "roto": los datos
// del scrum llegan por SSR, así que aquí un vacío SIEMPRE es "no hay datos", nunca
// "todavía cargando" (la carga fría la cubre el loading.tsx de la ruta).
function Empty({ hint }: { hint?: string }) {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-muted-foreground rounded-lg bg-muted/30 border border-dashed border-border">
      <PieIcon className="w-6 h-6 opacity-40" />
      <span className="font-medium text-foreground/70">Sin datos para graficar</span>
      {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
    </div>
  )
}

/* Estado del tablero cuando el sprint seleccionado no tiene tareas. En vez de
   tres columnas muertas (que se leen como "roto"), damos el siguiente paso claro:
   iniciar el sprint si sigue en plan, y/o traer tareas desde el backlog. */
function SprintBoardEmpty({
  sprint, backlogCount, onGoBacklog, onActivate, busy,
}: {
  sprint: ScrumSprint
  backlogCount: number
  onGoBacklog: () => void
  onActivate: () => void
  busy: boolean
}) {
  const isActive = sprint.status === 'active'
  return (
    <div className="border-2 border-dashed border-border rounded-xl p-12 text-center max-w-lg mx-auto mt-8">
      <ClipboardList className="w-9 h-9 mx-auto mb-3 text-muted-foreground" />
      <h3 className="text-sm font-medium text-foreground mb-1">
        {isActive ? 'El sprint está activo, pero sin tareas todavía' : 'El sprint aún no ha empezado'}
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        {backlogCount > 0
          ? `Tienes ${backlogCount} ${backlogCount === 1 ? 'tarea' : 'tareas'} en el backlog. Envíalas a este sprint para verlas en el tablero.`
          : 'Crea tareas en el proyecto y luego envíalas a este sprint desde el Backlog.'}
      </p>
      <div className="flex items-center justify-center gap-2">
        {!isActive && (
          <button
            onClick={onActivate}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            <Play className="w-3.5 h-3.5" /> Iniciar sprint
          </button>
        )}
        {backlogCount > 0 && (
          <button
            onClick={onGoBacklog}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-foreground text-xs font-medium rounded-lg hover:bg-muted transition-colors"
          >
            <Inbox className="w-3.5 h-3.5" /> Ver Backlog
          </button>
        )}
      </div>
    </div>
  )
}
