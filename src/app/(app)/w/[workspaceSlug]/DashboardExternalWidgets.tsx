import { createAdminClient } from '@/lib/supabase/server'
import { buildEmbedUrl, EMBED_SANDBOX } from '@/lib/connectors/embed'
import { EmbedFrame } from '@/components/connectors/EmbedFrame'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

/**
 * Widgets de herramientas externas en el dashboard del workspace.
 *
 * Solo muestra las que tienen `manifest->placement = 'dashboard'`. Cada una
 * se pinta en un iframe reducido (altura fija) dentro de una tarjeta con el
 * nombre de la herramienta y un link para abrirla en pantalla completa.
 */
export async function DashboardExternalWidgets({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const admin = createAdminClient()

  const { data: installs } = (await admin
    .from('connector_installs')
    .select('id, app_id')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)
    .contains('manifest', { placement: 'dashboard' })
    .limit(6)) as { data: { id: string; app_id: string }[] | null }

  if (!installs || installs.length === 0) return null

  const appIds = [...new Set(installs.map(i => i.app_id))]
  const { data: apps } = (await admin
    .from('connector_apps')
    .select('id, name, base_url, embed_path')
    .in('id', appIds)
    .eq('kind', 'embed')) as {
    data: { id: string; name: string; base_url: string; embed_path: string | null }[] | null
  }

  if (!apps || apps.length === 0) return null

  const widgets = installs.map(inst => {
    const app = apps.find(a => a.id === inst.app_id)
    if (!app) return null
    const url = buildEmbedUrl(app.base_url, app.embed_path, {
      workspaceId,
      installId: inst.id,
    })
    return { ...app, url }
  }).filter(Boolean) as { id: string; name: string; url: string | null }[]

  if (widgets.length === 0) return null

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Herramientas</h2>
        <span className="text-xs text-muted-foreground">{widgets.length}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map(w => (
          <div key={w.id} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-medium text-foreground truncate">{w.name}</span>
              <Link
                href={`/w/${workspaceSlug}/apps/${w.id}`}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ExternalLink size={12} /> Abrir
              </Link>
            </div>
            <div className="bg-white" style={{ height: 320 }}>
              {w.url ? (
                <EmbedFrame
                  src={w.url}
                  title={w.name}
                  sandbox={EMBED_SANDBOX}
                  className="w-full h-full border-0"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No se puede mostrar
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
