import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PenTool } from 'lucide-react'

interface Props { params: { workspaceSlug: string; workspaceId: string } }

export async function FlowsList({ workspaceSlug, workspaceId }: { workspaceSlug: string; workspaceId: string }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  const { data: flows } = await admin
    .from('flows')
    .select('id, title, description, visibility, created_at, updated_at, created_by, author:profiles(display_name)')
    .eq('workspace_id', workspaceId)
    .eq('created_by', user.id)
    .order('updated_at', { ascending: false })
    .limit(100) as { data: Array<{
      id: string; title: string; description: string|null; visibility: string; updated_at: string;
      author: { display_name: string } | null
    }> | null; error: unknown }

  const { FlowCard } = await import('./FlowCard')
  const { NewFlowButton } = await import('./NewFlowButton')

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flows</h1>
          <p className="text-muted-foreground text-sm mt-1">Diagramas de flujo interactivos con nodos y contenido embebido</p>
        </div>
        <NewFlowButton workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      </div>
      {(!flows || flows.length === 0) ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">
          <PenTool className="w-12 h-12 opacity-20" />
          <p className="text-sm">No hay flujos todavia</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard key={flow.id} flowId={flow.id} title={flow.title} description={flow.description}
              visibility={flow.visibility} updatedAt={flow.updated_at}
              author={flow.author?.display_name ?? 'Desconocido'} workspaceSlug={workspaceSlug} />
          ))}
        </div>
      )}
    </div>
  )
}
