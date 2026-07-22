/**
 * GET  /api/spaces/[spaceId]/members  -> lista los miembros del departamento con su perfil y rol
 * POST /api/spaces/[spaceId]/members  -> agrega un miembro (debe ser ya miembro del workspace)
 *
 * Solo admins del workspace. Roles de departamento: owner | member.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const postSchema = z
  .object({
    profile_id: z.string().uuid(),
    role: z.enum(['owner', 'member']).optional(),
  })
  .strict()

async function spaceWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  spaceId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('spaces')
    .select('workspace_id')
    .eq('id', spaceId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  return data?.workspace_id ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: { spaceId: string } }
) {
  if (!isUuid(params.spaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()
  const workspaceId = await spaceWorkspace(admin, params.spaceId)
  if (!workspaceId) return NextResponse.json({ error: 'Departamento no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  type MemberRow = {
    profile_id: string
    role: string
    joined_at: string
    profiles: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
  }

  const { data } = (await admin
    .from('space_members')
    .select('profile_id, role, joined_at, profiles ( id, display_name, email, avatar_url )')
    .eq('space_id', params.spaceId)
    .order('joined_at', { ascending: true })) as { data: MemberRow[] | null; error: unknown }

  const members = (data ?? []).map((m) => ({
    profile_id: m.profile_id,
    role: m.role,
    joined_at: m.joined_at,
    display_name: m.profiles?.display_name ?? 'Usuario',
    email: m.profiles?.email ?? '',
    avatar_url: m.profiles?.avatar_url ?? null,
  }))

  return NextResponse.json({ members })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { spaceId: string } }
) {
  if (!isUuid(params.spaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const workspaceId = await spaceWorkspace(admin, params.spaceId)
  if (!workspaceId) return NextResponse.json({ error: 'Departamento no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })

  // El objetivo debe ser ya miembro del workspace
  const { data: wsMember } = (await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', parsed.data.profile_id)
    .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
  if (!wsMember)
    return NextResponse.json({ error: 'La persona no es miembro del workspace' }, { status: 409 })

  const { data: existing } = (await admin
    .from('space_members')
    .select('profile_id')
    .eq('space_id', params.spaceId)
    .eq('profile_id', parsed.data.profile_id)
    .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
  if (existing) return NextResponse.json({ error: 'Ya es miembro del departamento' }, { status: 409 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('space_members').insert({
    space_id: params.spaceId,
    profile_id: parsed.data.profile_id,
    role: parsed.data.role ?? 'member',
    added_by: user?.id ?? null,
  })

  if (error) return NextResponse.json({ error: 'Error al agregar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 201 })
}
