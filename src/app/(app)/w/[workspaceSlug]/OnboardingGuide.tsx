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
  GraduationCap,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'

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

const TOUR: Array<{ icon: LucideIcon; titleKey: string; descKey: string; path: (b: string, uid: string) => string }> = [
  { icon: UsersRound, titleKey: 'onb.tourTeamsTitle', descKey: 'onb.tourTeamsDesc', path: (b) => `${b}/teams/new` },
  { icon: FolderKanban, titleKey: 'onb.tourProjectsTitle', descKey: 'onb.tourProjectsDesc', path: (b) => `${b}` },
  { icon: FileText, titleKey: 'onb.tourNotesTitle', descKey: 'onb.tourNotesDesc', path: (b) => `${b}/notes` },
  { icon: PenTool, titleKey: 'onb.tourWhiteboardsTitle', descKey: 'onb.tourWhiteboardsDesc', path: (b) => `${b}/whiteboards` },
  { icon: Target, titleKey: 'onb.tourGoalsTitle', descKey: 'onb.tourGoalsDesc', path: (b) => `${b}/goals` },
  { icon: Compass, titleKey: 'onb.tourMarketplaceTitle', descKey: 'onb.tourMarketplaceDesc', path: (b, uid) => `${b}/cv/${uid}` },
]

export function OnboardingGuide({ workspaceSlug, workspaceId, userId, steps, isAdmin = false }: OnboardingGuideProps) {
  const t = useT()
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
      ? { key: 'teams', label: t('onb.stepTeamsAdmin'), cta: t('onb.stepTeamsAdminCta'), href: `${base}/teams/new` }
      : { key: 'teams', label: t('onb.stepTeamsMember'), cta: t('onb.stepTeamsMemberCta'), href: base },
    { key: 'projects', label: t('onb.stepProjects'), cta: t('onb.stepProjectsCta'), href: base },
    { key: 'members', label: t('onb.stepMembers'), cta: t('onb.stepMembersCta'), href: `${base}/settings/invites` },
    { key: 'notes', label: t('onb.stepNotes'), cta: t('onb.stepNotesCta'), href: `${base}/notes` },
  ]

  // Pastilla para reabrir cuando está cerrada
  if (!open) {
    return (
      <button
        onClick={reopen}
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground shadow-soft transition-colors hover:text-foreground hover:border-primary/40"
      >
        <Sparkles size={14} className="text-primary" />
        {t('onb.reopenPill')}
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
              {allDone ? t('onb.allDoneTitle') : t('onb.welcomeTitle')}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {allDone
                ? t('onb.allDoneSubtitle')
                : t('onb.welcomeSubtitle')}
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('onb.close')}
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
          <span>{t('onb.howItWorks')}</span>
          <ChevronDown size={16} className={'transition-transform ' + (showTour ? 'rotate-180' : '')} />
        </button>
        {showTour && (
          <div className="grid grid-cols-1 gap-2 px-6 pb-5 sm:grid-cols-2">
            {TOUR.map((item) => (
              <Link
                key={item.titleKey}
                href={item.path(base, userId)}
                className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <item.icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t(item.titleKey)}</p>
                  <p className="text-xs text-muted-foreground">{t(item.descKey)}</p>
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
                <p className="text-sm font-medium text-foreground">{t('onb.tourSettingsTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('onb.tourSettingsDesc')}</p>
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
                <p className="text-sm font-medium text-foreground">{t('onb.tourInvitesTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('onb.tourInvitesDesc')}</p>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* Enlace al curso completo */}
      <div className="border-t border-border/60 px-6 py-3">
        <Link
          href={`${base}/guia`}
          className="flex items-center justify-between gap-2 rounded-xl bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <GraduationCap size={16} className="text-primary" />
            {t('onb.fullCourse')}
          </span>
          <ArrowRight size={15} className="flex-shrink-0 text-primary" />
        </Link>
      </div>
    </div>
  )
}
