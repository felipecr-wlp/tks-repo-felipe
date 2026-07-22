/**
 * PATCH /api/workspaces/[workspaceId], Actualiza nombre o descripcion del workspace.
 * Solo admins del workspace (o de la org).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const patchSchema = z
  .object({
    name: z.string().min(2).max(80).trim().optional(),
    description: z.string().max(500).trim().nullable().optional(),
  })
  .strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  if (!isUuid(params.workspaceId)) {
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
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos invalidos', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const admin = createAdminClient()
  type WsResult = { id: string; name: string; slug: string; description: string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = (await (admin as any)
    .from('workspaces')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.workspaceId)
    .select('id, name, slug, description')
    .single()) as { data: WsResult | null; error: unknown }

  if (error || !updated)
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  return NextResponse.json(updated)
}
