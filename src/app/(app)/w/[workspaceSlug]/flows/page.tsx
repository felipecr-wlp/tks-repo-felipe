import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PenTool, Plus, Lock, Globe, Users, Building2 } from 'lucide-react'

interface FlowsPageProps {
  params: { workspaceSlug: string }
}

const visibilityIcons: Record<string, React.ReactNode> = {
  private:   <Lock className="w-3 h-3" />,
  project:   <Building2 className="w-3 h-3" />,
  team:      <Users className="w-3 h-3" />,
  workspace: <Globe className="w-3 h-3" />,
}

const visibilityLabels: Record<string, string> = {
  private: 'Privado', workspace: 'Workspace', project: 'Proyecto', team: 'Equipo',
}

export default async function FlowsPage({ params }: FlowsPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  const { data: flows } = await admin
    .from('flows')
    .select(`
      id, title, visibility, created_at, updated_at, created_by,
      author:profiles ( display_name )
    `)
    .eq('workspace_id', workspace.id)
    .or(`visibility.neq.private,visibility.is.null,created_by.eq.${user.id}`)
    .order('updated_at', { ascending: false })
    .limit(100) as { data: Array<{
      id: string; title: string; visibility: string; updated_at: string;
      author: { display_name: string } | null
    }> | null; error: unknown }

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flows</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Diagramas de flujo interactivos con nodos y contenido embebido
          </p>
        </div>
      </div>

      {(!flows || flows.length === 0) ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">
          <PenTool className="w-12 h-12 opacity-20" />
          <p className="text-sm">No hay flujos todavia</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => (
            <Link
              key={flow.id}
              href={`/w/${params.workspaceSlug}/flows/${flow.id}`}
              className="group border rounded-xl p-4 hover:border-primary/30 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <PenTool className="w-5 h-5 text-primary/60" />
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {visibilityIcons[flow.visibility]}
                  {visibilityLabels[flow.visibility]}
                </span>
              </div>
              <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                {flow.title}
              </h3>
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <span>{flow.author?.display_name ?? 'Desconocido'}</span>
                <span>&middot;</span>
                <span>{new Date(flow.updated_at).toLocaleDateString('es-MX')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
