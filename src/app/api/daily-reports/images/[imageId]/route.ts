/**
 * GET    /api/daily-reports/images/[imageId] -> URL firmada de la version COMPLETA.
 * DELETE /api/daily-reports/images/[imageId] -> quita la evidencia.
 *
 * Este GET es la pieza central del ahorro de egress. El listado del dia pinta
 * solo miniaturas (firmadas en lote al render). La version completa, que pesa
 * entre cinco y diez veces mas, no se firma ni se descarga hasta que alguien
 * hace clic para verla en grande. Un dia con veinte capturas cuesta ~400KB de
 * bajada en vez de ~5MB, y solo paga los originales que de verdad se miraron.
 *
 * La URL vive 5 minutos: es para abrir el visor ahora, no para repartirse. Una
 * URL firmada es un permiso portatil, y mientras mas dura, mas se parece a
 * publicar el archivo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadEntryOwnership, canViewEntry } from '@/lib/daily-report-access'
import { REPORT_IMAGES_BUCKET } from '@/lib/daily-report-images'

const FULL_URL_TTL = 60 * 5

type ImageRow = { id: string; entry_id: string; path: string; thumb_path: string }

/** Resuelve la imagen y verifica la sesion. Compartido por los dos handlers. */
async function resolve(request: NextRequest, imageId: string) {
  if (!isUuid(imageId)) {
    return { error: NextResponse.json({ error: 'ID inválido' }, { status: 422 }) }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const { data: image } = (await admin
    .from('daily_report_images')
    .select('id, entry_id, path, thumb_path')
    .eq('id', imageId)
    .maybeSingle()) as { data: ImageRow | null; error: unknown }

  if (!image) {
    return { error: NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 }) }
  }

  const owner = await loadEntryOwnership(admin, image.entry_id)
  if (!owner) {
    return { error: NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 }) }
  }

  return { admin, user, image, owner }
}

export async function GET(request: NextRequest, { params }: { params: { imageId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const ctx = await resolve(request, params.imageId)
  if ('error' in ctx) return ctx.error
  const { admin, user, image, owner } = ctx

  // Dueño siempre; los demas solo si son mando del workspace de ese reporte.
  if (!(await canViewEntry(admin, owner, user.id))) {
    return NextResponse.json({ error: 'Sin acceso a esta imagen' }, { status: 403 })
  }

  const { data: signed, error } = await admin.storage
    .from(REPORT_IMAGES_BUCKET)
    .createSignedUrl(image.path, FULL_URL_TTL)

  if (error || !signed?.signedUrl) {
    console.error('[daily-reports images GET] sign error:', error)
    return NextResponse.json({ error: 'No se pudo abrir la imagen' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}

export async function DELETE(request: NextRequest, { params }: { params: { imageId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const ctx = await resolve(request, params.imageId)
  if ('error' in ctx) return ctx.error
  const { admin, user, image, owner } = ctx

  // Borrar es editar. Un admin puede LEER el dia de alguien mas, no corregirlo.
  if (owner.profile_id !== user.id) {
    return NextResponse.json({ error: 'Solo puedes editar tu propio reporte' }, { status: 403 })
  }

  // Primero los binarios: si falla el borrado de la fila despues, quedan objetos
  // huerfanos que nadie puede pedir (la fila es el unico camino a su path). Al
  // reves quedarian bytes cobrandose sin forma de encontrarlos.
  const { error: storageError } = await admin.storage
    .from(REPORT_IMAGES_BUCKET)
    .remove([image.path, image.thumb_path])
  if (storageError) {
    console.error('[daily-reports images DELETE] storage error:', storageError)
  }

  const { error } = await admin.from('daily_report_images').delete().eq('id', image.id)
  if (error) {
    console.error('[daily-reports images DELETE] error:', error)
    return NextResponse.json({ error: 'No se pudo borrar la imagen' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
