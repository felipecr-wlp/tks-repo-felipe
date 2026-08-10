/**
 * /api/academy/paths
 *
 * GET   lista rutas (las publicadas para cualquiera; los borradores solo admin).
 * POST  (solo admin) crea una ruta.
 *
 * Una ruta solo guarda por donde se ENTRA; el arbol de caminos se deriva de
 * los enlaces de las interacciones (lib/academy/rutas.ts). Ver la migracion
 * 20260817000000 para por que no se guarda el arbol.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/team-access'
import type { RutaAcademia } from '@/lib/academy/videos'

export const COLUMNAS_RUTA =
  'id, title, description, school_id, entry_video_id, accent, position, status, audience, audience_profiles, created_by, created_at, updated_at'

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  let q = admin.from('academy_paths').select(COLUMNAS_RUTA).order('position', { ascending: true })
  if (!(await isOrgAdmin(user.id))) q = q.eq('status', 'live')

  const { data, error } = await q
  if (error) {
    console.error('[academy paths GET] error:', error)
    return NextResponse.json({ error: 'Error al cargar las rutas' }, { status: 500 })
  }
  return NextResponse.json({ paths: (data ?? []) as unknown as RutaAcademia[] })
}

const crearSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).optional().default(''),
  schoolId: z.string().uuid().nullable().optional(),
  entryVideoId: z.string().uuid().nullable().optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(['draft', 'live']).optional().default('draft'),
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
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()

  // Un video de entrada que no existe dejaria la ruta descabezada desde el
  // primer dia. Se verifica ahora, no cuando alguien intente empezarla.
  if (parsed.data.entryVideoId) {
    const { data: v } = await admin
      .from('academy_videos').select('id').eq('id', parsed.data.entryVideoId).maybeSingle()
    if (!v) return NextResponse.json({ error: 'El video de entrada no existe' }, { status: 422 })
  }

  const { data: ultimo } = await admin
    .from('academy_paths').select('position').order('position', { ascending: false }).limit(1).maybeSingle()

  const { data: fila, error } = await admin
    .from('academy_paths')
    .insert({
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      school_id: parsed.data.schoolId ?? null,
      entry_video_id: parsed.data.entryVideoId ?? null,
      ...(parsed.data.accent ? { accent: parsed.data.accent } : {}),
      position: (ultimo?.position ?? -1) + 1,
      status: parsed.data.status,
      created_by: user.id,
    })
    .select(COLUMNAS_RUTA)
    .single()

  if (error || !fila) {
    console.error('[academy paths POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear la ruta' }, { status: 500 })
  }
  return NextResponse.json({ path: fila as unknown as RutaAcademia }, { status: 201 })
}
