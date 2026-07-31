'use client'

import { useEffect, useState } from 'react'
import { WIDGET_COMPONENTS } from './samples'
import type { WidgetInstall, WidgetManifest } from './registry'

interface Props {
  workspaceId: string
  slot: 'dashboard' | 'sidebar' | 'header'
}

export function WidgetSlot({ workspaceId, slot }: Props) {
  const [widgets, setWidgets] = useState<WidgetInstall[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/widgets?workspace_id=${workspaceId}&slot=${slot}`)
      .then(r => r.json())
      .then(d => setWidgets(d.widgets || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workspaceId, slot])

  if (loading) return null
  if (!widgets.length) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {widgets.filter(w => w.enabled && w.widget).map(w => {
        const Component = WIDGET_COMPONENTS[w.widget!.component]
        if (!Component) return null
        return <Component key={w.id} />
      })}
    </div>
  )
}
