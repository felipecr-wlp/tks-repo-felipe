'use client'

/**
 * Formulario de onboarding, Client Component
 * Permite crear una organización + workspace, o unirse con un código de invitación.
 */
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n/LanguageProvider'

// ── Schemas ─────────────────────────────────────────────────────────────────
type CreateData = { orgName: string; workspaceName: string }
type JoinData   = { code: string; password?: string }

interface OnboardingFormProps {
  userEmail: string
  userId: string
}

type Mode = 'choose' | 'create' | 'join'

export function OnboardingForm({ userEmail }: OnboardingFormProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('choose')

  if (mode === 'choose') {
    return <ChooseMode onSelect={setMode} />
  }
  if (mode === 'create') {
    return <CreateForm userEmail={userEmail} onBack={() => setMode('choose')} router={router} />
  }
  return <JoinForm onBack={() => setMode('choose')} router={router} />
}

// ── Choose mode ─────────────────────────────────────────────────────────────
function ChooseMode({ onSelect }: { onSelect: (m: Mode) => void }) {
  const t = useT()
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-3 shadow-sm">
      <button
        type="button"
        onClick={() => onSelect('create')}
        className="w-full text-left p-4 rounded-lg border border-border hover:border-primary hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('onbForm.createSpaceTitle')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onbForm.createSpaceDesc')}
            </p>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onSelect('join')}
        className="w-full text-left p-4 rounded-lg border border-border hover:border-primary hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('onbForm.joinTitle')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onbForm.joinDesc')}
            </p>
          </div>
        </div>
      </button>
    </div>
  )
}

// ── Create form ─────────────────────────────────────────────────────────────
function CreateForm({
  userEmail, onBack, router,
}: {
  userEmail: string
  onBack: () => void
  router: ReturnType<typeof useRouter>
}) {
  const t = useT()
  const [isLoading, setIsLoading] = useState(false)
  const emailDomain = userEmail.split('@')[1]?.split('.')[0] ?? ''
  const defaultOrgName = emailDomain
    ? emailDomain.charAt(0).toUpperCase() + emailDomain.slice(1)
    : ''

  const createSchema = useMemo(
    () => z.object({
      orgName: z.string().min(2, t('valid.min2')).max(80, t('valid.max80')).trim(),
      workspaceName: z.string().min(2, t('valid.min2')).max(80, t('valid.max80')).trim(),
    }),
    [t]
  )

  const { register, handleSubmit, formState: { errors } } = useForm<CreateData>({
    resolver: zodResolver(createSchema),
    defaultValues: { orgName: defaultOrgName, workspaceName: 'General' },
  })

  const onSubmit = async (data: CreateData) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('onbForm.createError'))
      if (result.lobby) {
        toast.success(t('onbForm.alreadyMember'))
        router.push('/lobby')
        return
      }
      toast.success(t('onbForm.spaceCreated'))
      router.push(`/w/${result.workspaceSlug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      setIsLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm"
    >
      <BackButton onClick={onBack} disabled={isLoading} />

      <div className="space-y-1.5">
        <label htmlFor="orgName" className="text-sm font-medium text-foreground">
          {t('onbForm.orgName')}
        </label>
        <input
          id="orgName"
          type="text"
          placeholder={t('onbForm.orgPlaceholder')}
          {...register('orgName')}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
          disabled={isLoading}
        />
        {errors.orgName && <p className="text-xs text-destructive">{errors.orgName.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="workspaceName" className="text-sm font-medium text-foreground">
          {t('onbForm.firstSpaceName')}
        </label>
        <input
          id="workspaceName"
          type="text"
          placeholder={t('onbForm.firstSpacePlaceholder')}
          {...register('workspaceName')}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
          disabled={isLoading}
        />
        {errors.workspaceName && <p className="text-xs text-destructive">{errors.workspaceName.message}</p>}
      </div>

      <div className="bg-muted/50 rounded-lg px-3 py-2.5 text-xs text-muted-foreground">
        {t('onbForm.accessWith')} <span className="font-medium text-foreground">{userEmail}</span>.
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? <Spinner /> : t('onbForm.createSpaceCta')}
      </button>
    </form>
  )
}

// ── Join form ───────────────────────────────────────────────────────────────
function JoinForm({
  onBack, router,
}: {
  onBack: () => void
  router: ReturnType<typeof useRouter>
}) {
  const t = useT()
  const [isLoading, setIsLoading] = useState(false)
  const [requiresPassword, setRequiresPassword] = useState(false)

  const joinSchema = useMemo(
    () => z.object({
      code: z.string().min(6, t('valid.invalidCode')).max(40).trim(),
      password: z.string().max(100).optional(),
    }),
    [t]
  )

  const { register, handleSubmit, formState: { errors } } = useForm<JoinData>({
    resolver: zodResolver(joinSchema),
  })

  const onSubmit = async (data: JoinData) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(data.code)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: data.password || undefined }),
      })
      const result = await res.json()

      if (res.status === 401 && result.requires_password) {
        setRequiresPassword(true)
        toast.error(t('onbForm.needsPassword'))
        setIsLoading(false)
        return
      }

      if (!res.ok) throw new Error(result.error ?? t('onbForm.joinError'))

      toast.success(result.already_member ? t('onbForm.wasMember') : t('onbForm.joined'))
      router.push(`/w/${result.workspace_slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      setIsLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm"
    >
      <BackButton onClick={onBack} disabled={isLoading} />

      <div className="space-y-1.5">
        <label htmlFor="code" className="text-sm font-medium text-foreground">
          {t('onbForm.inviteCode')}
        </label>
        <input
          id="code"
          type="text"
          placeholder={t('onbForm.codePlaceholder')}
          autoComplete="off"
          {...register('code')}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
          disabled={isLoading}
        />
        {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
        <p className="text-xs text-muted-foreground">
          {t('onbForm.codeHint')}
        </p>
      </div>

      {requiresPassword && (
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            {t('onbForm.password')}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="off"
            {...register('password')}
            className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
            disabled={isLoading}
          />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? <Spinner /> : t('onbForm.joinCta')}
      </button>
    </form>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {t('onbForm.back')}
    </button>
  )
}

function Spinner() {
  const t = useT()
  return (
    <>
      <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
      {t('onbForm.processing')}
    </>
  )
}
