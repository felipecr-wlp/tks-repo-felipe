'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  workspaceId: string
  workspaceSlug: string
}

export function NewFlowButton({ workspaceId, workspaceSlug }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleCreate() {
    setLoading(true)
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          title: 'Nuevo Flujo',
          visibility: 'workspace',
        }),
      })

      if (!res.ok) throw new Error('Error al crear')

      const flow: { id: string } = await res.json()
      router.push(`/w/${workspaceSlug}/flows/${flow.id}`)
    } catch {
      toast.error('Error al crear el flujo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
    >
      <Plus className="w-4 h-4" />
      {loading ? 'Creando...' : 'Nuevo Flujo'}
    </button>
  )
}
