'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function FlowsPluginPage({ workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const router = useRouter()
  useEffect(() => { router.replace(`/w/${workspaceSlug}/flows`) }, [workspaceSlug, router])
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <p className="text-sm">Redirigiendo a Flows...</p>
    </div>
  )
}
