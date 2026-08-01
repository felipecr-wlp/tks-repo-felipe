/**
 * DELETE /api/content/assets/[assetId]
 * Quita una imagen de una pieza.
 *
 * Se borran los DOS objetos (completa y miniatura) y despues la fila. En ese
 * orden: si se borrara la fila primero y fallara el storage, los binarios
 * quedarian huerfanos, sin nadie que sepa que existen y cobrandose igual.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadItemAccess } from '@/lib/content/access'
import { CONTENT_ASSETS_BUCKET } from '@/lib/content/catalog'

export async function DELETE(request: NextRequest, { params }: { params: { assetId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.assetId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: asset } = (await admin
    .from('content_assets')
    .select('id, item_id, path, thumb_path')
    .eq('id', params.assetId)
    .maybeSingle()) as {
    data: { id: string; item_id: string; path: string; thumb_path: string } | null
  }

  if (!asset) return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 })

  // El permiso se resuelve subiendo a la pieza, nunca por lo que mande el
  // cliente: el id de una imagen es adivinable, la pertenencia no.
  const acceso = await loadItemAccess(admin, asset.item_id, user.id)
  if (!acceso || !acceso.isMember) {
    return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 })
  }
  if (acceso.status === 'publicado' && !acceso.isManager) {
    return NextResponse.json(
      { error: 'Esta pieza ya se publicó. Solo un administrador puede tocarla.' },
      { status: 409 },
    )
  }

  const { error: rmError } = await admin.storage
    .from(CONTENT_ASSETS_BUCKET)
    .remove([asset.path, asset.thumb_path])
  if (rmError) console.error('[content assets] remove error:', rmError)

  const { error } = await admin.from('content_assets').delete().eq('id', params.assetId)
  if (error) {
    console.error('[content assets] delete error:', error)
    return NextResponse.json({ error: 'No se pudo quitar la imagen' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
