/**
 * GET  /api/spaces?workspace_id=xxx  -> departamentos (espacios) visibles del workspace
 * POST /api/spaces                   -> crea un departamento; el creador queda como owner
 *
 * Un "Espacio" = Departamento (RH, Marketing, Legal). Independiente de los equipos.
 * Agrupa notas via notes.space_id. La visibilidad fina la aplica RLS; aqui se usa el
 * admin client con checks explicitos de membresia, igual que en /api/notes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const createSchema = z.object({
  workspace_id:  z.string().uuid(),
  name:          z.string().min(1).max(120).trim(),
  description:   z.string().max(500).nullable().optional(),
  icon:          z.string().max(64).nullable().optional(),
  color:         z.string().max(32).nullable().optional(),
  is_restricted: z.boolean().optional(),
})

interface SpaceRow {
  id: string
  organization_id: string
  workspace_id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  is_restricted: boolean
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const workspace_id = new URL(request.url).searchParams.get('workspace_id')
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: spaces } = await admin
    .from('spaces')
    .select('id, organization_id, workspace_id, name, description, icon, color, is_restricted, is_archived, created_by, created_at, updated_at')
    .eq('workspace_id', workspace_id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: SpaceRow[] | null; error: unknown }

  // Ocultar restringidos donde el user no es miembro (F3 lo hara en RLS; aqui best-effort)
  const { data: myMemberships } = await admin
    .from('space_members')
    .select('space_id')
    .eq('profile_id', user.id) as { data: { space_id: string }[] | null; error: unknown }
  const mine = new Set((myMemberships ?? []).map(m => m.space_id))
  const isOrgAdmin = membership.role === 'owner' || membership.role === 'admin'

  const visible = (spaces ?? []).filter(s =>
    !s.is_restricted || isOrgAdmin || mine.has(s.id)
  )

  return NextResponse.json({ spaces: visible })
}

// ── POST ─────────────────────────────────────────────────────────────────────
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
  const { workspace_id, name, description, icon, color, is_restricted } = parsed.data

  const admin = createAdminClient()

  // Acceso al workspace + organization_id del workspace
  type WsRow = { id: string; org_id: string }
  const { data: ws } = await admin
    .from('workspaces')
    .select('id, org_id')
    .eq('id', workspace_id)
    .maybeSingle() as { data: WsRow | null; error: unknown }
  if (!ws) return NextResponse.json({ error: 'Workspace no encontrado' }, { status: 404 })

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: space, error } = await (admin as any)
    .from('spaces')
    .insert({
      organization_id: ws.org_id,
      workspace_id,
      name,
      description:   description ?? null,
      icon:          icon ?? null,
      color:         color ?? null,
      is_restricted: is_restricted ?? false,
      created_by:    user.id,
    })
    .select('id, organization_id, workspace_id, name, description, icon, color, is_restricted, is_archived, created_by, created_at, updated_at')
    .single() as { data: SpaceRow | null; error: unknown }

  if (error || !space) {
    console.error('[spaces POST] insert error:', error)
    return NextResponse.json({
      error: 'Error al crear el departamento',    }, { status: 500 })
  }

  // El creador queda como owner del departamento
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('space_members')
    .insert({ space_id: space.id, profile_id: user.id, role: 'owner', added_by: user.id })

  return NextResponse.json(space, { status: 201 })
}
