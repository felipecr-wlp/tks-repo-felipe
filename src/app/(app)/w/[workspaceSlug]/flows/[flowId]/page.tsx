import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isUuid } from '@/lib/validation'
import FlowEditor from './FlowEditor'

interface FlowDetailProps {
  params: { workspaceSlug: string; flowId: string }
}

export default async function FlowDetailPage({ params }: FlowDetailProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  if (!isUuid(params.flowId)) redirect(`/w/${params.workspaceSlug}/flows`)

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

  const { data: flow } = await admin
    .from('flows')
    .select('*')
    .eq('id', params.flowId)
    .eq('workspace_id', workspace.id)
    .maybeSingle() as { data: {
      id: string
      title: string
      description: string | null
      nodes: unknown
      edges: unknown
      visibility: string
      created_by: string
    } | null; error: unknown }

  if (!flow) redirect(`/w/${params.workspaceSlug}/flows`)
  if (flow.visibility === 'private' && flow.created_by !== user.id) {
    redirect(`/w/${params.workspaceSlug}/flows`)
  }

  const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
  const edges = Array.isArray(flow.edges) ? flow.edges : []

  return (
    <div className="h-full">
      <FlowEditor
        flowId={flow.id}
        workspaceSlug={params.workspaceSlug}
        workspaceId={workspace.id}
        initialNodes={nodes as any}
        initialEdges={edges as any}
        initialTitle={flow.title}
        initialDescription={flow.description}
      />
    </div>
  )
}
