'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useMemo } from 'react'
import { useT } from '@/lib/i18n/LanguageProvider'

type FormData = { name: string }

export function NewWorkspaceForm({ orgId }: { orgId: string }) {
  const t = useT()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const schema = useMemo(
    () => z.object({ name: z.string().min(2, t('valid.min2')).max(80).trim() }),
    [t]
  )

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, org_id: orgId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('newws.createError'))
      toast.success(t('newws.created'))
      router.push(`/w/${result.slug}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          {t('settings.wsName')} <span className="text-destructive">*</span>
        </label>
        <input
          id="name"
          {...register('name')}
          placeholder={t('newws.namePlaceholder')}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        <p className="text-xs text-muted-foreground">
          {t('newws.nameHint')}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} disabled={isLoading}
          className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
          {isLoading
            ? <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />{t('newws.creating')}</>
            : t('newws.create')}
        </button>
      </div>
    </form>
  )
}
