'use client'

import { useEffect, useState, useRef, Component, type ReactNode } from 'react'

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

interface WidgetData {
  id: string
  app_id: string
  enabled: boolean
  base_url: string
  widget: { id: string; name: string; component: string; slot: string } | null
}

function WidgetIframe({ widget, workspaceSlug }: { widget: WidgetData; workspaceSlug: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'wlo-resize' && e.data?.height) setHeight(e.data.height)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // No URL: try loading from plugin filesystem
  if (!widget.base_url) return <DynamicPluginWidget appId={widget.app_id} name={widget.widget?.name || widget.app_id} />

  return (
    <iframe
      ref={ref}
      src={`${widget.base_url}?workspace_slug=${workspaceSlug}&app_id=${widget.app_id}`}
      className="w-full border-0 rounded-xl bg-card"
      style={{ height: `${height}px`, minHeight: '120px' }}
      title={widget.widget?.name || widget.app_id}
    />
  )
}

const loadedComponents = new Map<string, React.ComponentType<any>>()

function DynamicPluginWidget({ appId, name }: { appId: string; name: string }) {
  const [Comp, setComp] = useState<React.ComponentType<any> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (loadedComponents.has(appId)) { setComp(loadedComponents.get(appId)!); return }
    fetch(`/api/widgets/component/${appId}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.text() })
      .then(code => {
        const mods: Record<string, any> = { react: require('react'), 'react-dom': require('react-dom') }
        const req = (n: string) => mods[n] || (() => { throw new Error(`Module not found: ${n}`) })()
        const fn = new Function('module', 'exports', 'require', code)
        const mod = { exports: {} as any }
        fn(mod, mod.exports, req)
        const C = mod.exports.default || mod.exports
        if (typeof C === 'function') { loadedComponents.set(appId, C); setComp(() => C) }
        else setErr(`No export for ${appId}`)
      })
      .catch(e => setErr(e.message))
  }, [appId])

  if (err) return <div className="border rounded-xl p-4 text-xs text-muted-foreground">{name}: {err}</div>
  if (!Comp) return <div className="border rounded-xl p-4 animate-pulse"><div className="h-4 bg-muted rounded w-24" /></div>
  return <Comp />
}

interface Props {
  workspaceId: string
  workspaceSlug: string
  slot: 'dashboard' | 'sidebar' | 'header'
}

export function WidgetSlot({ workspaceId, workspaceSlug, slot }: Props) {
  const [widgets, setWidgets] = useState<WidgetData[]>([])
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
          <WidgetIframe widget={w} workspaceSlug={workspaceSlug} />
        </WidgetErrorBoundary>
      ))}
    </div>
  )
}
