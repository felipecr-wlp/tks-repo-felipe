/**
 * POST /api/content/items
 * Crea una pieza de contenido. Nace siempre en 'por_aprobar'.
 *
 * El estado inicial NO se acepta del cliente. Si se pudiera mandar, cualquiera
 * crearia su pieza directamente en 'aprobado' y la columna de revision se
 * quedaria vacia para siempre, que es justo lo que esta herramienta evita.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isNetwork } from '@/lib/content/catalog'

/**
 * El esquema es la puerta: lo que no esta aqui declarado no entra al handler.
 * Importa tanto lo que ACEPTA como lo que NO menciona: `status`, `rating`,
 * `approved_by` y `created_by` no existen en este esquema, asi que mandarlos no
 * hace nada. Un objeto suelto que se pasara entero al insert seria el bug.
 */
const crearSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  // La red se valida contra el catalogo de codigo (src/lib/content/catalog.ts),
  // no contra la base: la columna no tiene CHECK a proposito.
  // El techo va ANTES del refine: sin el, una cadena de 50 MB se bufferiza y se
  // recorre entera solo para acabar rechazada por no estar en el catalogo.
  network: z.string().max(40).refine(isNetwork, 'Red social no reconocida'),
  caption: z.string().trim().max(5000).nullish(),
  format: z.string().trim().max(60).nullish(),
  // Fecha y no timestamp: el contenido se planea por dia.
  scheduled_for: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
})

/** Cadena vacia y ausencia son lo mismo aqui: columna nula, no string vacio. */
function oNulo(v: string | null | undefined): string | null {
  return v ? v : null
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = crearSchema.safeParse(crudo)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Revisa el título y la red social' }, { status: 422 })
  }
  const datos = parsed.data
  const workspaceId = datos.workspaceId

  const admin = createAdminClient()

  // Membresia explicita: el admin client se salta RLS, asi que sin este check
  // cualquiera con sesion podria sembrar contenido en un workspace ajeno.
  const { data: membership } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'No perteneces a este workspace' }, { status: 403 })
  }

  const { data: item, error } = await admin
    .from('content_items')
    .insert({
      workspace_id: workspaceId,
      title: datos.title,
      caption: oNulo(datos.caption),
      network: datos.network,
      format: oNulo(datos.format),
      scheduled_for: oNulo(datos.scheduled_for),
      // La autoria SIEMPRE sale de la sesion, nunca del body.
      created_by: user.id,
    })
    .select('id, title, caption, network, format, status, rating, scheduled_for, created_at')
    .single()

  if (error || !item) {
    console.error('[content items] insert error:', error)
    return NextResponse.json({ error: 'No se pudo crear el contenido' }, { status: 500 })
  }

  return NextResponse.json({ item }, { status: 201 })
}
