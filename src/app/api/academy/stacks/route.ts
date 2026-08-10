/**
 * /api/academy/stacks
 *
 * GET   lista los stacks (cualquier usuario autenticado): la galeria los usa
 *       para agrupar sus secciones.
 * POST  (solo admin) crea un stack. El orden (`position`) por omision va al
 *       final de los existentes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/team-access'
import type { StackAcademia } from '@/lib/academy/videos'

const COLUMNAS = 'id, title, description, accent, position, created_by, created_at, updated_at'

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('academy_stacks')
    .select(COLUMNAS)
    .order('position', { ascending: true })

  if (error) {
    console.error('[academy stacks GET] error:', error)
    return NextResponse.json({ error: 'Error al cargar los stacks' }, { status: 500 })
  }
  return NextResponse.json({ stacks: (data ?? []) as unknown as StackAcademia[] })
}

const crearSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(''),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
  }

  const parsed = crearSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const admin = createAdminClient()
  // Al final de los existentes: max(position) + 1, con 0 si no hay ninguno.
  const { data: ultimo } = await admin
    .from('academy_stacks')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: fila, error } = await admin
    .from('academy_stacks')
    .insert({
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      ...(parsed.data.accent ? { accent: parsed.data.accent } : {}),
      position: (ultimo?.position ?? -1) + 1,
      created_by: user.id,
    })
    .select(COLUMNAS)
    .single()

  if (error || !fila) {
    console.error('[academy stacks POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear el stack' }, { status: 500 })
  }
  return NextResponse.json({ stack: fila as unknown as StackAcademia }, { status: 201 })
}
