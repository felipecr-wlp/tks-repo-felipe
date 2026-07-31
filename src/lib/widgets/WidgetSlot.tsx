'use client'

import { useEffect, useState, Component, type ReactNode } from 'react'
import { WIDGET_COMPONENTS } from './samples'
import type { WidgetInstall } from './registry'

class WidgetErrorBoundary extends Component<{ children: ReactNode; name: string }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; name: string }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="border rounded-xl p-4 bg-destructive/5 border-destructive/20">
          <p className="text-xs text-muted-foreground">Error en widget: {this.props.name}</p>
        </div>
      )
    }
    return this.props.children
  }
}

interface Props {
  workspaceId: string
  slot: 'dashboard' | 'sidebar' | 'header'
}

export function WidgetSlot({ workspaceId, slot }: Props) {
  const [widgets, setWidgets] = useState<WidgetInstall[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/widgets?workspace_id=${workspaceId}&slot=${slot}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (!cancelled) setWidgets(d.widgets || []) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, slot])

  if (loading) return null
  if (error) return null
  if (!widgets.length) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
      {widgets.filter(w => w.enabled && w.widget).map(w => (
        <WidgetErrorBoundary key={w.id} name={w.widget!.name}>
          {(() => {
            const Component = WIDGET_COMPONENTS[w.widget!.component]
            if (!Component) return null
            return <Component />
          })()}
        </WidgetErrorBoundary>
      ))}
    </div>
  )
}
