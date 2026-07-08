/**
 * POST /api/messages — Publica un mensaje en el chat de un equipo.
 * Body: { team_id, body }
 *
 * Authz: solo miembros del equipo pueden publicar. La lectura del historial la
 * hace el Server Component del chat con el admin client (patrón anti-RLS-loop).
 * El realtime sobre la tabla messages entrega el mensaje a los demás en vivo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const schema = z.object({
  team_id: z.string().uuid(),
  body:    z.string().min(1).max(4000).trim(),
}).strict()

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { team_id, body } = parsed.data
  const admin = createAdminClient()

  // Verificar membresía al equipo
  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', team_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })

  // workspace_id del equipo (para scoping)
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', team_id)
    .maybeSingle() as { data: { workspace_id: string } | null; error: unknown }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: message, error } = await (admin as any)
    .from('messages')
    .insert({
      team_id,
      workspace_id: team?.workspace_id ?? null,
      author_id: user.id,
      body,
    })
    .select('id, team_id, author_id, body, created_at')
    .single()

  if (error || !message) {
    console.error('[messages POST] insert error:', error)
    return NextResponse.json({ error: 'Error al enviar el mensaje' }, { status: 500 })
  }

  return NextResponse.json(message, { status: 201 })
}
