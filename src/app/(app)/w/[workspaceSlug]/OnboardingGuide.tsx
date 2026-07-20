'use client'

/**
 * OnboardingGuide, guia de primeros pasos del workspace.
 *
 * Muestra un checklist con los pasos clave (crear equipo, proyecto, invitar,
 * primera nota) marcando como completados los que ya se hicieron, y un tour
 * corto de "cómo funciona" con enlaces a cada área. Se puede cerrar; queda una
 * pastilla "Guía de inicio" para reabrirla. Estado persistido en localStorage.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Check,
  ChevronDown,
  X,
  Sparkles,
  UsersRound,
  FolderKanban,
  FileText,
  PenTool,
  Target,
  Compass,
  Ticket,
  Settings,
  type LucideIcon,
} from 'lucide-react'

interface OnboardingSteps {
  teams: boolean
  projects: boolean
  members: boolean
  notes: boolean
}

interface OnboardingGuideProps {
  workspaceSlug: string
  workspaceId: string
  userId: string
  steps: OnboardingSteps
  isAdmin?: boolean
}

const TOUR: Array<{ icon: LucideIcon; title: string; desc: string; path: (b: string, uid: string) => string }> = [
  { icon: UsersRound, title: 'Equipos', desc: 'Cada equipo agrupa proyectos y tareas por área.', path: (b) => `${b}/teams/new` },
  { icon: FolderKanban, title: 'Proyectos y tableros', desc: 'Organiza el trabajo en tableros Scrum o Kanban.', path: (b) => `${b}` },
  { icon: FileText, title: 'Notas y departamentos', desc: 'Base de conocimiento tipo Confluence por departamento.', path: (b) => `${b}/notes` },
  { icon: PenTool, title: 'Pizarras', desc: 'Lienzos visuales para ideas, flujos y diagramas.', path: (b) => `${b}/whiteboards` },
  { icon: Target, title: 'Metas', desc: 'Define objetivos y da seguimiento al progreso.', path: (b) => `${b}/goals` },
  { icon: Compass, title: 'Marketplace', desc: 'Oportunidades internas y tu CV de colaborador.', path: (b, uid) => `${b}/cv/${uid}` },
]

export function OnboardingGuide({ workspaceSlug, workspaceId, userId, steps, isAdmin = false }: OnboardingGuideProps) {
  const base = `/w/${workspaceSlug}`
  const storageKey = `wlo-onboarding-${workspaceId}`

  const doneCount = Object.values(steps).filter(Boolean).length
  const totalSteps = 4
  const allDone = doneCount >= totalSteps

  // Estado: null hasta hidratar desde localStorage para evitar parpadeo.
  const [open, setOpen] = useState<boolean | null>(null)
  const [showTour, setShowTour] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(storageKey)
    } catch {
      // localStorage no disponible
    }
    if (stored === 'dismissed') setOpen(false)
    else if (stored === 'open') setOpen(true)
    else setOpen(!allDone) // primera vez: abierta salvo que ya esté todo hecho
  }, [storageKey, allDone])

  function persist(next: 'open' | 'dismissed') {
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      // Ignorar si no se puede persistir
    }
  }

  function dismiss() {
    setOpen(false)
    persist('dismissed')
  }

  function reopen() {
    setOpen(true)
    persist('open')
  }

  if (open === null) return null

  const checklist: Array<{ key: keyof OnboardingSteps; label: string; cta: string; href: string }> = [
    // Crear equipos es exclusivo del admin; para el resto, el paso apunta a la
    // vista del workspace (esperan a que el admin les asigne un equipo).
    isAdmin
      ? { key: 'teams', label: 'Crea tu primer equipo', cta: 'Crear equipo', href: `${base}/teams/new` }
      : { key: 'teams', label: 'Espera a que un admin te asigne un equipo', cta: 'Ver workspace', href: base },
    { key: 'projects', label: 'Crea un proyecto y su tablero', cta: 'Ir a equipos', href: base },
    { key: 'members', label: 'Invita a tu equipo', cta: 'Invitar', href: `${base}/settings/invites` },
    { key: 'notes', label: 'Escribe tu primera nota', cta: 'Nueva nota', href: `${base}/notes` },
  ]

  // Pastilla para reabrir cuando está cerrada
  if (!open) {
    return (
      <button
        onClick={reopen}
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground shadow-soft transition-colors hover:text-foreground hover:border-primary/40"
      >
        <Sparkles size={14} className="text-primary" />
        Guía de inicio
        {!allDone && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {doneCount}/{totalSteps}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 shadow-soft">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-6 pt-6">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {allDone ? 'Todo listo para trabajar' : 'Bienvenido a WLO'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {allDone
                ? 'Completaste los primeros pasos. Puedes reabrir esta guía cuando quieras.'
                : 'Sigue estos pasos para dejar tu espacio listo en minutos.'}
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Cerrar guía"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progreso */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(doneCount / totalSteps) * 100}%` }}
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {doneCount}/{totalSteps}
          </span>
        </div>
      </div>

      {/* Checklist */}
      <div className="px-6 py-4">
        <ul className="divide-y divide-border/60">
          {checklist.map((item) => {
            const done = steps[item.key]
            return (
              <li key={item.key} className="flex items-center gap-3 py-2.5">
                <span
                  className={
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ' +
                    (done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background')
                  }
                >
                  {done && <Check size={12} />}
                </span>
                <span
                  className={
                    'flex-1 text-sm ' +
                    (done ? 'text-muted-foreground line-through' : 'text-foreground')
                  }
                >
                  {item.label}
                </span>
                {!done && (
                  <Link
                    href={item.href}
                    className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {item.cta}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Tour: cómo funciona */}
      <div className="border-t border-border/60">
        <button
          onClick={() => setShowTour((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          <span>¿Cómo funciona WLO?</span>
          <ChevronDown size={16} className={'transition-transform ' + (showTour ? 'rotate-180' : '')} />
        </button>
        {showTour && (
          <div className="grid grid-cols-1 gap-2 px-6 pb-5 sm:grid-cols-2">
            {TOUR.map((t) => (
              <Link
                key={t.title}
                href={t.path(base, userId)}
                className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <t.icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
              </Link>
            ))}
            <Link
              href={`${base}/settings`}
              className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Settings size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Configuración</p>
                <p className="text-xs text-muted-foreground">Miembros, equipos, departamentos e invitaciones.</p>
              </div>
            </Link>
            <Link
              href={`${base}/settings/invites`}
              className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Ticket size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Invitaciones</p>
                <p className="text-xs text-muted-foreground">Genera códigos para sumar a tu equipo.</p>
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
