'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n/LanguageProvider'

const schema = z.object({
  name:        z.string().min(2, 'form.minChars').max(80).trim(),
  description: z.string().max(300).trim().optional(),
  space_id:    z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface Department {
  id: string
  name: string
  icon: string | null
  is_restricted: boolean
}

interface NewTeamFormProps {
  workspaceId: string
  workspaceSlug: string
  departments: Department[]
}

export function NewTeamForm({ workspaceId, workspaceSlug, departments }: NewTeamFormProps) {
  const router = useRouter()
  const t = useT()
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          space_id: data.space_id ? data.space_id : null,
          workspace_id: workspaceId,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('newTeam.createError'))
      toast.success(t('newTeam.created'))
      router.push(`/w/${workspaceSlug}/t/${result.slug}`)
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
          {t('newTeam.nameLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          id="name"
          {...register('name')}
          placeholder={t('newTeam.namePlaceholder')}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {errors.name && <p className="text-xs text-destructive">{t(errors.name.message ?? '')}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="space_id" className="text-sm font-medium text-foreground">
          {t('newTeam.deptLabel')} <span className="text-muted-foreground text-xs">{t('form.optional')}</span>
        </label>
        <select
          id="space_id"
          {...register('space_id')}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">{t('newTeam.noDept')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.is_restricted ? t('newTeam.restricted') : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {t('newTeam.restrictedHelp')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium text-foreground">
          {t('form.description')} <span className="text-muted-foreground text-xs">{t('form.optional')}</span>
        </label>
        <textarea
          id="description"
          {...register('description')}
          placeholder={t('newTeam.descPlaceholder')}
          rows={3}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => router.back()} disabled={isLoading}
          className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
          {isLoading ? (
            <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />{t('form.creating')}</>
          ) : t('newTeam.submit')}
        </button>
      </div>
    </form>
  )
}
