'use client'

/**
 * Titulo editable del proyecto (rename inline). Solo los managers pueden editar;
 * para el resto es texto plano. Guarda con PATCH /api/projects/[projectId] y
 * refresca la vista. Es una mejora aditiva y reversible: si no se es manager,
 * se comporta igual que el <h1> estatico anterior.
 */
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n/LanguageProvider'

export function ProjectNameEditor({
  projectId,
  initialName,
  canManage,
}: {
  projectId: string
  initialName: string
  canManage: boolean
}) {
  const { t: tr } = useI18n()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { setName(initialName) }, [initialName])
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  if (!canManage) {
    return <h1 className="text-sm font-semibold text-foreground truncate">{initialName}</h1>
  }

  async function save() {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      toast.error(tr('projectView.renameTooShort'))
      return
    }
    if (trimmed === initialName) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? tr('projectView.renameError'))
        setSaving(false)
        return
      }
      toast.success(tr('projectView.renameSaved'))
      setEditing(false)
      setSaving(false)
      router.refresh()
    } catch {
      toast.error(tr('projectView.renameError'))
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={name}
          disabled={saving}
          maxLength={80}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            if (e.key === 'Escape') { e.preventDefault(); setName(initialName); setEditing(false) }
          }}
          className="text-sm font-semibold text-foreground bg-background border border-primary/50 rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-primary/40 min-w-[160px]"
        />
        <button
          onClick={save}
          disabled={saving}
          className="p-1 rounded text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          title={tr('common.save')}
          aria-label={tr('common.save')}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setName(initialName); setEditing(false) }}
          disabled={saving}
          className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
          title={tr('common.cancel')}
          aria-label={tr('common.cancel')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    )
  }

  return (
    <span className="group/name inline-flex items-center gap-1 min-w-0">
      <h1
        className="text-sm font-semibold text-foreground truncate cursor-text hover:underline decoration-dotted underline-offset-4"
        onDoubleClick={() => setEditing(true)}
        title={tr('projectView.renameHint')}
      >
        {initialName}
      </h1>
      <button
        onClick={() => setEditing(true)}
        className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-70 hover:opacity-100 transition-all"
        title={tr('projectView.rename')}
        aria-label={tr('projectView.rename')}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}
