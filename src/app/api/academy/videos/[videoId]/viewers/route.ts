/**
 * /api/academy/videos/[videoId]/viewers   (solo admin)
 *
 * Quien esta NOMBRADO para ver un video con audiencia = 'personas'.
 *
 * POR QUE EXISTE. La audiencia 'personas' se podia elegir y no habia forma de
 * nombrar a nadie: el video quedaba invisible para todo el mundo sin manera de
 * arreglarlo salvo tocando la base. Una opcion que solo sabe esconder es peor
 * que no tener la opcion.
 *
 * GET    lista los nombrados + el directorio del workspace para poder elegir.
 * PUT    fija la lista COMPLETA de nombrados (reemplaza, no acumula).
 *
 * Se eligio PUT-lista-completa y no POST/DELETE por persona a proposito: la UI
 * es un conjunto de casillas, y mandar el estado final evita el desfase clasico
 * de "marque tres, se guardaron dos" cuando una de las peticiones falla.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isOrgAdmin } from '@/lib/team-access'

interface RouteParams { params: { videoId: string } }

/**
 * El gate NO se factoriza a un helper compartido, aunque se repita en los dos
 * handlers. Es deliberado: el tripwire de IDOR de lectura analiza el cuerpo
 * del GET AISLADO, justo para que un gate del POST no tape un GET abierto.
 * Escondido en un helper, la autorizacion deja de ser visible donde se lee, y
 * la unica forma de "arreglarlo" seria aflojar el tripwire, que es la manera
 * de convertir una barrera en un adorno. Seis lineas repetidas cuestan menos
 * que eso.
 */

interface MiembroRow {
  profile: { id: string; display_name: string | null; email: string } | null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.videoId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  // Devuelve el DIRECTORIO del workspace: sin este gate, cualquiera con sesion
  // se lleva el padron completo pegandole a la URL.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
  }

  const admin = createAdminClient()
  const [{ data: nombrados }, { data: miembros }] = await Promise.all([
    admin.from('academy_video_viewers').select('profile_id').eq('video_id', params.videoId),
    // Directorio del workspace, deduplicado: una persona puede pertenecer a
    // varios workspaces y saldria repetida en la lista de casillas.
    admin
      .from('workspace_members')
      .select('profile:profiles!inner ( id, display_name, email )'),
  ])

  const vistos = new Map<string, { id: string; nombre: string }>()
  for (const m of (miembros ?? []) as unknown as MiembroRow[]) {
    if (m.profile && !vistos.has(m.profile.id)) {
      vistos.set(m.profile.id, {
        id: m.profile.id,
        nombre: m.profile.display_name?.trim() || m.profile.email,
      })
    }
  }

  return NextResponse.json({
    nombrados: (nombrados ?? []).map((r) => r.profile_id),
    personas: Array.from(vistos.values()).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  })
}

const putSchema = z.object({
  profileIds: z.array(z.string().uuid()).max(500),
})

export async function PUT(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.videoId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
  }

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { data: video } = await admin
    .from('academy_videos').select('id').eq('id', params.videoId).maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 })

  // Ids unicos: la tabla tiene UNIQUE(video_id, profile_id) y un duplicado en
  // el payload haria fallar el insert entero por un descuido de la UI.
  const ids = Array.from(new Set(parsed.data.profileIds))

  // Se borra y se reinserta porque el PUT manda el estado FINAL. El borrado va
  // primero: si el insert falla, quedarse sin nombrados es visible de
  // inmediato (nadie ve el video). Al reves quedarian de mas, que es una fuga
  // silenciosa, y entre los dos fallos posibles se elige el que se nota.
  const { error: eDel } = await admin
    .from('academy_video_viewers').delete().eq('video_id', params.videoId)
  if (eDel) {
    console.error('[academy viewers PUT] delete error:', eDel)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }

  if (ids.length > 0) {
    const { error: eIns } = await admin
      .from('academy_video_viewers')
      .insert(ids.map((profile_id) => ({ video_id: params.videoId, profile_id })))
    if (eIns) {
      console.error('[academy viewers PUT] insert error:', eIns)
      return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, total: ids.length })
}
