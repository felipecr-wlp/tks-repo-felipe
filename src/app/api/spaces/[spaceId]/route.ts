/**
 * PATCH  /api/spaces/[spaceId]  -> actualiza nombre/descripcion/icono/color/restringido/archivado
 * DELETE /api/spaces/[spaceId]  -> elimina el departamento
 *
 * Solo admins del workspace. El departamento se resuelve por su workspace_id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const patchSchema = z
  .object({
    name: z.string().min(1).max(120).trim().optional(),
    description: z.string().max(500).trim().nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    is_restricted: z.boolean().optional(),
    is_archived: z.boolean().optional(),
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { spaceId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

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
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })

  type SpaceResult = {
    id: string
    name: string
    description: string | null
    icon: string | null
    color: string | null
    is_restricted: boolean
    is_archived: boolean
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = (await (admin as any)
    .from('spaces')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.spaceId)
    .select('id, name, description, icon, color, is_restricted, is_archived')
    .single()) as { data: SpaceResult | null; error: unknown }

  if (error || !updated) return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { spaceId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()
  const workspaceId = await spaceWorkspace(admin, params.spaceId)
  if (!workspaceId) return NextResponse.json({ error: 'Departamento no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('spaces').delete().eq('id', params.spaceId)
  if (error) return NextResponse.json({ error: 'Error al eliminar el departamento' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
