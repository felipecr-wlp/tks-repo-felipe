'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export function NewWhiteboardButton({
  workspaceId, workspaceSlug,
}: { workspaceId: string; workspaceSlug: string }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function create() {
    setCreating(true)
    try {
      const res = await fetch('/api/whiteboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          title: 'Pizarra sin título',
          visibility: 'workspace',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      router.push(`/w/${workspaceSlug}/whiteboards/${data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear')
      setCreating(false)
    }
  }

  return (
    <button
      onClick={create}
      disabled={creating}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
    >
      {creating ? (
        <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      Nueva pizarra
    </button>
  )
}
