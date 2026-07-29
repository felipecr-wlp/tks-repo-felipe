'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
    <Button onClick={handleCreate} disabled={loading} size="sm">
      <Plus className="w-4 h-4 mr-1" />
      {loading ? 'Creando...' : 'Nuevo Flujo'}
    </Button>
  )
}
