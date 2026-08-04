import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isUuid } from '@/lib/validation'
import FlowEditor from './FlowEditor'
import { FlowErrorBoundary } from '@/components/FlowErrorBoundary'
import { resolveFlowAccess } from '@/lib/flows/access'
import type { Node, Edge } from '@xyflow/react'

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

  const { data: plugin } = await admin
    .from('connector_installs')
    .select('id')
    .eq('workspace_id', workspace.id)
    .eq('app_id', 'wlo-flows')
    .eq('enabled', true)
    .maybeSingle() as { data: { id: string } | null; error: unknown }
  if (!plugin) redirect(`/w/${params.workspaceSlug}`)

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
      updated_at: string | null
    } | null; error: unknown }

  if (!flow) redirect(`/w/${params.workspaceSlug}/flows`)

  // Misma regla que usa la API, para que la pantalla y el servidor no se
  // contradigan: un privado compartido si se abre, y un share de lectura entra
  // en modo solo lectura en vez de dejar editar y fallar al guardar.
  const access = await resolveFlowAccess(admin, {
    flowId: flow.id,
    workspaceId: workspace.id,
    createdBy: flow.created_by,
    visibility: flow.visibility,
    userId: user.id,
  })
  if (access === 'none') redirect(`/w/${params.workspaceSlug}/flows`)

  const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
  const edges = Array.isArray(flow.edges) ? flow.edges : []

  return (
    <div className="h-full">
      <FlowErrorBoundary>
      <FlowEditor
        flowId={flow.id}
        workspaceSlug={params.workspaceSlug}
        workspaceId={workspace.id}
        initialNodes={nodes as unknown as Node[]}
        initialEdges={edges as unknown as Edge[]}
        initialTitle={flow.title}
        initialDescription={flow.description}
      />
      </FlowErrorBoundary>
    </div>
  )
}
