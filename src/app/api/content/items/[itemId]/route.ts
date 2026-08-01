/**
 * PATCH  /api/content/items/[itemId]   editar la pieza y mover su estado.
 * DELETE /api/content/items/[itemId]   borrarla junto con sus imagenes.
 *
 * Aqui vive la unica decision con consecuencias del planificador: aprobar y
 * publicar. Por eso el cambio de estado se separa del resto de la edicion y pasa
 * por `motivoParaNegarCambioDeEstado`, en `src/lib/content/access.ts`. Editar el
 * copy es colaborar; mover a "aprobado" es firmar.
 *
 * Todo se resuelve con el admin client (se salta RLS), asi que cada regla se
 * comprueba explicitamente en el handler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadItemAccess, motivoParaNegarCambioDeEstado } from '@/lib/content/access'
import {
  isNetwork,
  isContentStatus,
  CONTENT_ASSETS_BUCKET,
  type ContentStatus,
} from '@/lib/content/catalog'
import type { Database } from '@/lib/supabase/types'

/**
 * Un PATCH manda solo lo que cambio, asi que todo es opcional y hay que
 * distinguir tres cosas distintas: ausente (no tocar), null (vaciar la columna)
 * y valor (escribir). De ahi `.nullish()` en vez de `.nullable()`.
 *
 * Lo que NO esta aqui es igual de importante: `approved_by`, `approved_at`,
 * `created_by`, `workspace_id` y `updated_at` no se aceptan del cliente. Se
 * sellan en el servidor o no se tocan.
 */
const parchearSchema = z.object({
  title: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(5000).nullish(),
  format: z.string().trim().max(60).nullish(),
  // Techo antes del refine: ver la nota en items/route.ts.
  network: z.string().max(40).refine(isNetwork, 'Red social no reconocida').optional(),
  scheduled_for: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  // Calificacion entera de 1 a 5, o null para quitarla.
  rating: z.number().int().min(1).max(5).nullish(),
  // `z.custom` y no `z.string().refine`: conserva el tipo `ContentStatus`, que es
  // lo que exige `motivoParaNegarCambioDeEstado`. Con un `string` a secas la
  // regla de quien puede mover el estado se comprobaria sin que el compilador
  // supiera contra que.
  status: z.custom<ContentStatus>(isContentStatus).optional(),
  published_url: z.string().trim().max(500).nullish(),
})

/** Texto vacio y null son lo mismo: columna nula, nunca string vacio. */
function oNulo(v: string | null | undefined): string | null {
  return v ? v : null
}

export async function PATCH(request: NextRequest, { params }: { params: { itemId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.itemId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const acceso = await loadItemAccess(admin, params.itemId, user.id)
  if (!acceso) return NextResponse.json({ error: 'Contenido no encontrado' }, { status: 404 })
  // Mismo 404 para "no existe" y "no es tuyo": distinguirlos le confirmaria a un
  // extraño que la pieza existe.
  if (!acceso.isMember) return NextResponse.json({ error: 'Contenido no encontrado' }, { status: 404 })

  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = parchearSchema.safeParse(crudo)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ese cambio no es válido' }, { status: 422 })
  }
  const body = parsed.data

  // Tipado contra la tabla y no `Record<string, unknown>`: asi un nombre de
  // columna mal escrito revienta al compilar, no en silencio al guardar.
  const patch: Database['public']['Tables']['content_items']['Update'] = {
    updated_at: new Date().toISOString(),
  }

  if (body.title !== undefined) {
    if (!body.title) {
      return NextResponse.json({ error: 'El título no puede quedar vacío' }, { status: 422 })
    }
    patch.title = body.title
  }

  if (body.caption !== undefined) patch.caption = oNulo(body.caption)
  if (body.format !== undefined) patch.format = oNulo(body.format)
  if (body.network !== undefined) patch.network = body.network
  if (body.scheduled_for !== undefined) patch.scheduled_for = oNulo(body.scheduled_for)

  // La calificacion es de cualquier miembro: es una opinion, no una firma. Lo
  // que decide es el estado, y ese si esta restringido.
  if (body.rating !== undefined) patch.rating = body.rating ?? null

  // ── Cambio de estado ───────────────────────────────────────────────────────
  if (body.status !== undefined) {
    const motivo = motivoParaNegarCambioDeEstado(acceso.status, body.status, acceso.isManager)
    if (motivo) return NextResponse.json({ error: motivo }, { status: 403 })

    patch.status = body.status

    if (body.status === 'aprobado') {
      // Se sella quien aprobo. Sin esto, "aprobado" es un estado sin responsable
      // y la pregunta "¿quien dijo que si?" no tiene respuesta.
      patch.approved_by = user.id
      patch.approved_at = new Date().toISOString()
    }

    if (body.status === 'publicado') {
      patch.published_at = new Date().toISOString()
      if (body.published_url !== undefined) patch.published_url = oNulo(body.published_url)
    }

    if (body.status === 'por_aprobar') {
      // Regresar a revision limpia la firma anterior: dejarla puesta haria creer
      // que la version que ahora se revisa ya la aprobo alguien.
      patch.approved_by = null
      patch.approved_at = null
      patch.published_at = null
      patch.published_url = null
    }
  } else if (body.published_url !== undefined) {
    // Corregir el enlace de algo ya publicado, sin mover el estado.
    patch.published_url = oNulo(body.published_url)
  }

  const { data: item, error } = await admin
    .from('content_items')
    .update(patch)
    .eq('id', params.itemId)
    .select(
      'id, title, caption, network, format, status, rating, scheduled_for, published_at, published_url, approved_at, updated_at',
    )
    .single()

  if (error || !item) {
    console.error('[content items] update error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el cambio' }, { status: 500 })
  }

  return NextResponse.json({ item })
}

export async function DELETE(request: NextRequest, { params }: { params: { itemId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.itemId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const acceso = await loadItemAccess(admin, params.itemId, user.id)
  if (!acceso || !acceso.isMember) {
    return NextResponse.json({ error: 'Contenido no encontrado' }, { status: 404 })
  }
  if (!acceso.isCreator && !acceso.isManager) {
    return NextResponse.json(
      { error: 'Solo quien lo subió o un administrador puede borrarlo' },
      { status: 403 },
    )
  }

  // Los binarios primero. Si se borrara la fila antes y fallara el storage, los
  // objetos quedarian huerfanos: nadie sabria que existen y se seguirian
  // cobrando para siempre.
  const { data: assets } = (await admin
    .from('content_assets')
    .select('path, thumb_path')
    .eq('item_id', params.itemId)) as { data: { path: string; thumb_path: string }[] | null }

  const rutas = (assets ?? []).flatMap((a) => [a.path, a.thumb_path])
  if (rutas.length > 0) {
    const { error: rmError } = await admin.storage.from(CONTENT_ASSETS_BUCKET).remove(rutas)
    if (rmError) console.error('[content items] remove objects error:', rmError)
  }

  // Las filas hijas (imagenes y correcciones) se van solas por ON DELETE CASCADE.
  const { error } = await admin.from('content_items').delete().eq('id', params.itemId)
  if (error) {
    console.error('[content items] delete error:', error)
    return NextResponse.json({ error: 'No se pudo borrar el contenido' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
