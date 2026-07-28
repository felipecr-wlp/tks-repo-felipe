'use client'

/**
 * Formulario para unirse al workspace usando el código del URL.
 * Hace lookup del invite al montar para mostrar el nombre del workspace
 * y saber si requiere password.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n/LanguageProvider'

interface JoinByCodeFormProps {
  code: string
}

interface InviteInfo {
  workspace_name: string
  workspace_slug: string
  org_name: string | null
  role: string
  has_password: boolean
}

export function JoinByCodeForm({ code }: JoinByCodeFormProps) {
  const router = useRouter()
  const t = useT()
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/invites/${encodeURIComponent(code)}`)
      .then(async res => {
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error ?? t('join.invalidInvite'))
        } else {
          setInfo(data)
        }
      })
      .catch(() => !cancelled && setError(t('join.networkError')))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [code, t])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('join.joinError'))

      toast.success(data.already_member ? t('join.alreadyMember') : t('join.joined'))
      router.push(`/w/${data.workspace_slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
        {t('join.loading')}
      </div>
    )
  }

  if (error || !info) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 space-y-3">
        <p className="text-sm text-destructive font-medium">{error ?? t('join.invalidInvite')}</p>
        <button
          onClick={() => router.push('/')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('join.backHome')} →
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleJoin} className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('join.willJoin')}</p>
        <h2 className="text-lg font-semibold text-foreground">{info.workspace_name}</h2>
        {info.org_name && (
          <p className="text-xs text-muted-foreground">{t('join.inPrefix')} {info.org_name}</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          {t('form.roleLabel')} <span className="font-medium text-foreground">{info.role}</span>
        </p>
      </div>

      {info.has_password && (
        <div className="space-y-1.5">
          <label htmlFor="pwd" className="text-sm font-medium text-foreground">
            {t('join.passwordLabel')}
          </label>
          <input
            id="pwd"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
            disabled={submitting}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <>
            <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            {t('join.joining')}
          </>
        ) : (
          `${t('join.submit')} →`
        )}
      </button>
    </form>
  )
}
