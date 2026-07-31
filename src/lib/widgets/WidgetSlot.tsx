'use client'

import { useEffect, useState, useMemo, Component, type ReactNode, createElement } from 'react'
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

const loadedComponents = new Map<string, React.ComponentType<any>>()

function DynamicWidget({ appId }: { appId: string }) {
  const [Comp, setComp] = useState<React.ComponentType<any> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (loadedComponents.has(appId)) {
      setComp(loadedComponents.get(appId)!); return
    }
    fetch(`/api/widgets/component/${appId}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.text() })
      .then(code => {
        try {
          const fn = new Function('exports', 'require', code)
          const mod = { exports: {} as any }
          fn(mod.exports, (name: string) => require(name))
          const C = mod.exports.default || mod.exports
          if (typeof C === 'function') {
            loadedComponents.set(appId, C)
            setComp(() => C)
          } else {
            setErr(`No default export found for ${appId}`)
          }
        } catch (e: any) {
          setErr(`${appId}: ${e.message}`)
        }
      })
      .catch(e => setErr(e.message))
  }, [appId])

  if (err) return <div className="border rounded-xl p-4 text-xs text-muted-foreground">{err}</div>
  if (!Comp) return <div className="border rounded-xl p-4 animate-pulse"><div className="h-4 bg-muted rounded w-24" /></div>
  return <Comp />
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
      {widgets.filter(w => w.enabled).map(w => (
        <WidgetErrorBoundary key={w.id} name={w.widget?.name || w.app_id}>
          <DynamicWidget appId={w.app_id} />
        </WidgetErrorBoundary>
      ))}
    </div>
  )
}
