import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  title:        z.string().max(200).trim().optional(),
  visibility:   z.enum(['private', 'project', 'team', 'workspace']).default('private'),
  project_id:   z.string().uuid().nullable().optional(),
})

interface FlowListRow {
  id: string
  title: string
  visibility: string
  created_at: string
  updated_at: string
  created_by: string | null
  author: { display_name: string; avatar_url: string | null } | null
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const workspace_id = url.searchParams.get('workspace_id')
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: flows, error: flowsError } = await admin
    .from('flows')
    .select(`
      id, title, visibility, created_at, updated_at, created_by,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('workspace_id', workspace_id)
    .eq('created_by', user.id)
    .order('updated_at', { ascending: false })
    .limit(100) as { data: FlowListRow[] | null; error: unknown }

  if (flowsError) {
    console.error('[flows GET] read error:', flowsError)
    return NextResponse.json({ error: 'Error al cargar flujos' }, { status: 500 })
  }

  return NextResponse.json({ flows: flows ?? [] })
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { workspace_id, title, visibility, project_id } = parsed.data
  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  type FlowInsert = { id: string; title: string; created_at: string }
  const { data: flow, error } = await admin
    .from('flows')
    .insert({
      workspace_id,
      project_id: project_id ?? null,
      title: title ?? 'Flujo sin titulo',
      nodes: [],
      edges: [],
      visibility,
      created_by: user.id,
    })
    .select('id, title, created_at')
    .single() as { data: FlowInsert | null; error: unknown }

  if (error || !flow) {
    console.error('[flows POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear el flujo' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.FLOW_CREATED,
    subject_id: user.id,
    object_type: 'flow',
    object_id: flow.id,
    object_title: flow.title,
    workspace_id,
  }).catch(console.error)

  return NextResponse.json(flow, { status: 201 })
}
