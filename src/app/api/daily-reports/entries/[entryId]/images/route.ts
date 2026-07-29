/**
 * POST /api/daily-reports/entries/[entryId]/images
 * Adjunta evidencia en imagen a una actividad del reporte diario.
 *
 * El cliente manda DOS archivos ya comprimidos (`full` y `thumb`, ver
 * src/lib/daily-report-images.ts). El servidor no redimensiona nada: valida y
 * guarda. Que la compresion ocurra antes es justamente lo que hace que este
 * endpoint sea barato y que quepa de sobra bajo el techo de ~4.5MB que Vercel
 * impone al cuerpo de una serverless function.
 *
 * Seguridad:
 *  - Solo el DUEÑO del reporte adjunta. Ni un admin escribe el dia de otro.
 *  - El tipo se verifica por los BYTES (numeros magicos), no por lo que declare
 *    el cliente: un `Content-Type: image/webp` sobre un ejecutable es trivial de
 *    falsificar, y el bucket acepta lo que le manden con esa etiqueta.
 *  - El path lo construye el servidor a partir del reporte resuelto en base, asi
 *    que un cliente no puede escribir dentro de la carpeta de otra persona.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadEntryOwnership } from '@/lib/daily-report-access'
import {
  REPORT_IMAGES_BUCKET,
  REPORT_IMAGE_MAX_BYTES,
  REPORT_THUMB_MAX_BYTES,
  REPORT_IMAGE_MIMES,
  MAX_IMAGES_PER_ENTRY,
  MAX_IMAGES_PER_REPORT,
  reportImagePrefix,
} from '@/lib/daily-report-images'

/**
 * ¿Los bytes son de verdad lo que dicen ser?
 *
 * WebP: "RIFF" .... "WEBP" (bytes 0-3 y 8-11).
 * JPEG: FF D8 FF.
 */
function sniffMime(bytes: Uint8Array): 'image/webp' | 'image/jpeg' | null {
  if (bytes.length >= 12) {
    const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    if (riff && webp) return 'image/webp'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

/** Entero opcional del formulario, acotado. Un NaN o un negativo se descartan. */
function intField(form: FormData, name: string, max: number): number | null {
  const raw = form.get(name)
  if (typeof raw !== 'string') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0 || n > max) return null
  return n
}

export async function POST(request: NextRequest, { params }: { params: { entryId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.entryId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const owner = await loadEntryOwnership(admin, params.entryId)
  if (!owner) return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 })
  if (owner.profile_id !== user.id) {
    return NextResponse.json({ error: 'Solo puedes adjuntar a tu propio reporte' }, { status: 403 })
  }

  // ── Cuerpo ─────────────────────────────────────────────────────────────────
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 })
  }

  const full = form.get('full')
  const thumb = form.get('thumb')
  if (!(full instanceof File) || !(thumb instanceof File)) {
    return NextResponse.json({ error: 'Faltan la imagen o su miniatura' }, { status: 422 })
  }
  if (full.size > REPORT_IMAGE_MAX_BYTES || thumb.size > REPORT_THUMB_MAX_BYTES) {
    return NextResponse.json(
      { error: 'La imagen no viene comprimida. Vuelve a intentarlo desde la pantalla de reportes.' },
      { status: 413 }
    )
  }

  const fullBytes = new Uint8Array(await full.arrayBuffer())
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer())

  const fullMime = sniffMime(fullBytes)
  const thumbMime = sniffMime(thumbBytes)
  if (!fullMime || !thumbMime || !REPORT_IMAGE_MIMES.includes(fullMime)) {
    return NextResponse.json({ error: 'Formato de imagen no admitido' }, { status: 415 })
  }

  // ── Topes de cantidad ──────────────────────────────────────────────────────
  // Se cuentan con `head: true`: interesa el numero, no las filas.
  const [{ count: enEntrada }, { count: enReporte }] = await Promise.all([
    admin.from('daily_report_images').select('id', { count: 'exact', head: true }).eq('entry_id', params.entryId),
    admin.from('daily_report_images').select('id', { count: 'exact', head: true }).eq('report_id', owner.report_id),
  ])

  if ((enEntrada ?? 0) >= MAX_IMAGES_PER_ENTRY) {
    return NextResponse.json(
      { error: `Máximo ${MAX_IMAGES_PER_ENTRY} imágenes por actividad.` },
      { status: 409 }
    )
  }
  if ((enReporte ?? 0) >= MAX_IMAGES_PER_REPORT) {
    return NextResponse.json(
      { error: `Máximo ${MAX_IMAGES_PER_REPORT} imágenes por día.` },
      { status: 409 }
    )
  }

  // ── Guardado ───────────────────────────────────────────────────────────────
  const ext = fullMime === 'image/webp' ? 'webp' : 'jpg'
  const base = `${reportImagePrefix(owner.report_id)}${params.entryId}/${randomUUID()}`
  const path = `${base}.${ext}`
  const thumbPath = `${base}_t.${ext}`

  const up = await admin.storage
    .from(REPORT_IMAGES_BUCKET)
    .upload(path, fullBytes, { contentType: fullMime, upsert: false })
  if (up.error) {
    console.error('[daily-reports images] upload full error:', up.error)
    return NextResponse.json({ error: 'No se pudo guardar la imagen' }, { status: 500 })
  }

  const upThumb = await admin.storage
    .from(REPORT_IMAGES_BUCKET)
    .upload(thumbPath, thumbBytes, { contentType: thumbMime, upsert: false })
  if (upThumb.error) {
    console.error('[daily-reports images] upload thumb error:', upThumb.error)
    // Sin miniatura la imagen no se puede listar sin quemar egress, asi que no
    // se deja a medias: se retira el objeto grande y se falla limpio.
    await admin.storage.from(REPORT_IMAGES_BUCKET).remove([path])
    return NextResponse.json({ error: 'No se pudo guardar la imagen' }, { status: 500 })
  }

  const captionRaw = form.get('caption')
  const caption = typeof captionRaw === 'string' ? captionRaw.trim().slice(0, 300) || null : null

  const { data: image, error } = (await admin
    .from('daily_report_images')
    .insert({
      entry_id: params.entryId,
      report_id: owner.report_id,
      path,
      thumb_path: thumbPath,
      width: intField(form, 'width', 20000),
      height: intField(form, 'height', 20000),
      bytes: fullBytes.byteLength,
      thumb_bytes: thumbBytes.byteLength,
      caption,
    })
    .select('id, width, height, caption, created_at')
    .single()) as {
    data: {
      id: string
      width: number | null
      height: number | null
      caption: string | null
      created_at: string
    } | null
    error: unknown
  }

  if (error || !image) {
    console.error('[daily-reports images] insert error:', error)
    // La fila es la que hace localizable al objeto: sin ella los binarios son
    // basura que igual se cobra. Se limpian los dos.
    await admin.storage.from(REPORT_IMAGES_BUCKET).remove([path, thumbPath])
    return NextResponse.json({ error: 'No se pudo registrar la imagen' }, { status: 500 })
  }

  // La miniatura se devuelve ya firmada: el cliente la acaba de subir y quiere
  // pintarla de inmediato, sin una segunda vuelta al servidor para firmarla.
  const { data: signed } = await admin.storage
    .from(REPORT_IMAGES_BUCKET)
    .createSignedUrl(thumbPath, 60 * 60 * 4)

  return NextResponse.json(
    {
      image: {
        id: image.id,
        width: image.width,
        height: image.height,
        caption: image.caption,
        thumb_url: signed?.signedUrl ?? null,
      },
    },
    { status: 201 }
  )
}
