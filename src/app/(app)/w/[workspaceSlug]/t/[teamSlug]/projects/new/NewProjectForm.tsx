'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ClipboardList } from 'lucide-react'
import { PROJECT_ICONS, DEFAULT_PROJECT_ICON, ProjectIcon } from '@/lib/project-icons'
import { PROJECT_TEMPLATES } from '@/lib/project-templates'
import { useT } from '@/lib/i18n/LanguageProvider'

const schema = z.object({
  name: z.string().min(2, 'form.minChars').max(80).trim(),
  description: z.string().max(500).trim().optional(),
  icon: z.string().max(24).optional(),
})
type FormData = z.infer<typeof schema>

interface NewProjectFormProps {
  teamId: string
  workspaceSlug: string
  teamSlug: string
}

export function NewProjectForm({ teamId, workspaceSlug, teamSlug }: NewProjectFormProps) {
  const router = useRouter()
  const t = useT()
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIcon, setSelectedIcon] = useState(DEFAULT_PROJECT_ICON)
  const [template, setTemplate] = useState<string | null>(null)

  function pickTemplate(key: string | null, icon?: string) {
    setTemplate(key)
    if (icon) setSelectedIcon(icon)
  }

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', icon: DEFAULT_PROJECT_ICON },
  })

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, icon: selectedIcon, team_id: teamId, template: template ?? undefined }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('newProject.createError'))
      toast.success(t('newProject.created'))
      router.push(`/w/${workspaceSlug}/t/${teamSlug}/p/${result.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm">
      {/* Plantilla */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('newProject.template')}</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* En blanco */}
          <button
            type="button"
            onClick={() => pickTemplate(null, DEFAULT_PROJECT_ICON)}
            aria-pressed={template === null}
            className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
              template === null ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
            }`}
          >
            <ClipboardList size={18} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium text-foreground">{t('newProject.blank')}</span>
              <span className="block text-xs text-muted-foreground">{t('newProject.blankDesc')}</span>
            </span>
          </button>

          {PROJECT_TEMPLATES.map(tpl => (
            <button
              key={tpl.key}
              type="button"
              onClick={() => pickTemplate(tpl.key, tpl.icon)}
              aria-pressed={template === tpl.key}
              className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                template === tpl.key ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
              }`}
            >
              <ProjectIcon icon={tpl.icon} size={18} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium text-foreground">{tpl.label}</span>
                <span className="block text-xs text-muted-foreground">{tpl.blurb}</span>
              </span>
            </button>
          ))}
        </div>
        {template && (
          <p className="text-xs text-muted-foreground">
            {t('newProject.templateNote')}
          </p>
        )}
      </div>

      {/* Icono */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('newProject.icon')}</label>
        <div className="flex flex-wrap gap-2">
          {PROJECT_ICONS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedIcon(key)}
              title={label}
              aria-label={label}
              aria-pressed={selectedIcon === key}
              className={`w-9 h-9 flex items-center justify-center rounded-lg border-2 transition-all hover:scale-110 ${
                selectedIcon === key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>

      {/* Nombre */}
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          {t('newProject.nameLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          id="name"
          {...register('name')}
          placeholder={t('newProject.namePlaceholder')}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {errors.name && <p className="text-xs text-destructive">{t(errors.name.message ?? '')}</p>}
      </div>

      {/* Descripción */}
      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium text-foreground">
          {t('form.description')} <span className="text-muted-foreground text-xs">{t('form.optional')}</span>
        </label>
        <textarea
          id="description"
          {...register('description')}
          placeholder={t('newProject.descPlaceholder')}
          rows={3}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
        />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isLoading}
          className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />{t('form.creating')}</>
          ) : t('newProject.submit')}
        </button>
      </div>
    </form>
  )
}
