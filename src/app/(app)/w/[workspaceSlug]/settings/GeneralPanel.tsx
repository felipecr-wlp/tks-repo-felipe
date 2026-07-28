'use client'

/**
 * GeneralPanel, edita nombre y descripcion del workspace.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n/LanguageProvider'

interface GeneralPanelProps {
  workspaceId: string
  workspaceSlug: string
  initialName: string
  initialDescription: string | null
}

export function GeneralPanel({
  workspaceId,
  workspaceSlug,
  initialName,
  initialDescription,
}: GeneralPanelProps) {
  const t = useT()
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)

  const dirty = name.trim() !== initialName || (description.trim() || '') !== (initialDescription ?? '')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) {
      toast.error(t('settings.nameMinChars'))
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('settings.saveError'))
      toast.success(t('settings.saved'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="bg-card border border-border rounded-xl p-5 space-y-4 max-w-xl">
      <div className="space-y-1.5">
        <label htmlFor="ws-name" className="text-xs font-medium text-foreground">
          {t('settings.wsName')}
        </label>
        <input
          id="ws-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
          disabled={saving}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ws-desc" className="text-xs font-medium text-foreground">
          {t('settings.wsDescription')}
        </label>
        <textarea
          id="ws-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t('settings.wsDescPlaceholder')}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background resize-y"
          disabled={saving}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">{t('settings.wsSlug')}</label>
        <code className="block text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          {workspaceSlug}
        </code>
      </div>

      <div className="pt-1">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.saveChanges')}
        </button>
      </div>
    </form>
  )
}
