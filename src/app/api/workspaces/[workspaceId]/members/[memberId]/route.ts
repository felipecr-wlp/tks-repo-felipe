/**
 * PATCH  /api/workspaces/[workspaceId]/members/[memberId]  -> cambia el rol y/o las funciones visibles (memberId = profile_id)
 * DELETE /api/workspaces/[workspaceId]/members/[memberId]  -> quita al miembro del workspace
 *
 * Solo admins. Guardas de integridad: nunca dejar el workspace sin owners y no
 * permitir que un admin se quite a si mismo (evita bloqueos accidentales).
 *
 * `hidden_features` guarda que pantallas NO ve esa persona. Se normaliza contra
 * el catalogo antes de escribir: una clave inventada o una funcion bloqueada
 * (Inicio) se descartan aqui, no se confia en lo que mande el cliente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { normalizeHidden } from '@/lib/features'

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const
const patchSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    hidden_features: z.array(z.string().max(40)).max(50).optional(),
  })
  .strict()
  .refine((d) => d.role !== undefined || d.hidden_features !== undefined, {
    message: 'Nada que actualizar',
  })

async function ownerCount(admin: ReturnType<typeof createAdminClient>, workspaceId: string): Promise<number> {
  const { count } = (await admin
    .from('workspace_members')
    .select('profile_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')) as { count: number | null }
  return count ?? 0
}

async function currentRole(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  profileId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', profileId)
    .maybeSingle()) as { data: { role: string } | null }
  return data?.role ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string; memberId: string } }
) {
  if (!isUuid(params.workspaceId) || !isUuid(params.memberId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const { role, hidden_features } = parsed.data

  // Solo un owner puede otorgar el rol owner. Sin esta barrera un simple admin
  // podia promover a cualquiera (incluido a si mismo) a owner: escalada de
  // privilegios. Los admin siguen pudiendo asignar roles admin y por debajo.
  if (role === 'owner' && !auth.isOwner) {
    return NextResponse.json({ error: 'Solo un owner puede asignar el rol owner' }, { status: 403 })
  }

  const admin = createAdminClient()
  const prev = await currentRole(admin, params.workspaceId, params.memberId)
  if (!prev) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  // No dejar el workspace sin owners
  if (role !== undefined && prev === 'owner' && role !== 'owner' && (await ownerCount(admin, params.workspaceId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un owner' }, { status: 409 })
  }

  const patch: { role?: string; hidden_features?: string[] } = {}
  if (role !== undefined) patch.role = role
  // El cliente propone, el catalogo dispone: se descarta lo que no exista o no
  // se pueda apagar.
  const cleanHidden = hidden_features !== undefined ? normalizeHidden(hidden_features) : undefined
  if (cleanHidden !== undefined) patch.hidden_features = cleanHidden

  const { error } = await admin
    .from('workspace_members')
    .update(patch)
    .eq('workspace_id', params.workspaceId)
    .eq('profile_id', params.memberId)

  if (error) return NextResponse.json({ error: 'Error al actualizar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true, role: role ?? prev, hidden_features: cleanHidden })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string; memberId: string } }
) {
  if (!isUuid(params.workspaceId) || !isUuid(params.memberId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  if (auth.userId === params.memberId)
    return NextResponse.json({ error: 'No puedes quitarte a ti mismo' }, { status: 409 })

  const admin = createAdminClient()
  const prev = await currentRole(admin, params.workspaceId, params.memberId)
  if (!prev) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  if (prev === 'owner' && (await ownerCount(admin, params.workspaceId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un owner' }, { status: 409 })
  }

  const { error } = await admin
    .from('workspace_members')
    .delete()
    .eq('workspace_id', params.workspaceId)
    .eq('profile_id', params.memberId)

  if (error) return NextResponse.json({ error: 'Error al quitar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
