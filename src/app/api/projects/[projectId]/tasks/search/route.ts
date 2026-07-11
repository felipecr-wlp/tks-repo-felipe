/**
 * GET /api/projects/[projectId]/tasks/search?q=texto
 *
 * Busca tareas del proyecto por titulo (ILIKE) para pickers como el de
 * dependencias entre tareas. Devuelve { tasks: [{ id, title }] } (max 10).
 *
 * Authz: miembro del proyecto o de su workspace. Anti-IDOR: el projectId viene
 * de la ruta y se valida contra la membresia real; nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const querySchema = z.object({ q: z.string().min(1).max(80).trim() })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canAccessProject(admin: any, projectId: string, userId: string): Promise<boolean> {
  const { data: project } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null }
  if (!project) return false

  const { data: pmem } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null }
  if (pmem) return true

  const { data: wmem } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null }
  return !!wmem
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get('q') })
  if (!parsed.success) return NextResponse.json({ tasks: [] })

  const admin = createAdminClient()
  const ok = await canAccessProject(admin, params.projectId, user.id)
  if (!ok) return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })

  const escaped = parsed.data.q.replace(/[%_]/g, m => `\\${m}`)
  const { data: tasks } = await admin
    .from('tasks')
    .select('id, title')
    .eq('project_id', params.projectId)
    .eq('is_archived', false)
    .ilike('title', `%${escaped}%`)
    .order('sort_order', { ascending: true })
    .limit(10) as { data: { id: string; title: string }[] | null; error: unknown }

  return NextResponse.json({ tasks: tasks ?? [] })
}
