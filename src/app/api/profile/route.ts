/**
 * PATCH /api/profile, Actualiza el perfil del usuario autenticado
 * (nombre para mostrar y/o avatar). Cada quien solo edita su propio perfil.
 *
 * El avatar debe ser una de las rutas de la galería (AVATAR_PATHS). Los
 * avatares reservados (husky) solo los puede elegir un Admin (org_role
 * admin/owner). Se valida aquí en el servidor, no solo en la UI.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { AVATAR_PATHS, ADMIN_ONLY_AVATARS, ADMIN_ROLES } from '@/lib/avatars'

const patchSchema = z.object({
  display_name: z.string().min(2).max(80).trim().optional(),
  avatar_url: z.string().nullable().optional(),
}).strict()

export async function PATCH(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()

  // El avatar (si viene) debe ser de la galería. null = quitar avatar.
  const avatar = parsed.data.avatar_url
  if (avatar !== undefined && avatar !== null) {
    if (!AVATAR_PATHS.has(avatar)) {
      return NextResponse.json({ error: 'Avatar no válido' }, { status: 422 })
    }
    // Avatares reservados: solo Admin del org.
    if (ADMIN_ONLY_AVATARS.has(avatar)) {
      const { data: me } = await admin
        .from('profiles')
        .select('org_role')
        .eq('id', user.id)
        .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }
      if (!me || !ADMIN_ROLES.has(me.org_role ?? '')) {
        return NextResponse.json({ error: 'Ese avatar está reservado para el Admin' }, { status: 403 })
      }
    }
  }

  const patch: { display_name?: string; avatar_url?: string | null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.display_name !== undefined) patch.display_name = parsed.data.display_name
  if (avatar !== undefined) patch.avatar_url = avatar

  type ProfileResult = { id: string; display_name: string; avatar_url: string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id, display_name, avatar_url')
    .single() as { data: ProfileResult | null; error: unknown }

  if (error || !updated) return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  return NextResponse.json(updated)
}
