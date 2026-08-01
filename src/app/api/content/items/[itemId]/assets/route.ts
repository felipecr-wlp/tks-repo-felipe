/**
 * POST /api/content/items/[itemId]/assets   sube una imagen de la pieza.
 * GET  /api/content/items/[itemId]/assets   firma las versiones COMPLETAS.
 *
 * ── Por que el GET existe ───────────────────────────────────────────────────
 * La galeria se pinta con miniaturas firmadas en el servidor al render. Las
 * versiones completas NO se firman ahi: se piden aqui, y solo cuando alguien
 * abre una pieza. Firmar es barato, pero mandar 40 enlaces de imagen completa en
 * el HTML invita al navegador a precargarlas, y ese es exactamente el egress que
 * el diseño de dos objetos evita.
 *
 * ── Por que el cliente manda las dos versiones ya comprimidas ───────────────
 * El servidor no redimensiona nada: valida y guarda. Comprimir en el navegador
 * (ver src/lib/content/catalog.ts) es lo que hace que un original de 6MB nunca
 * viaje, nunca se almacene y nunca se descargue. El tipo se verifica por los
 * BYTES y no por lo que declare el cliente: un `Content-Type` es trivial de
 * falsificar y el bucket acepta lo que le manden con esa etiqueta.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadItemAccess } from '@/lib/content/access'
import {
  CONTENT_ASSETS_BUCKET,
  CONTENT_IMAGE_MAX_BYTES,
  CONTENT_THUMB_MAX_BYTES,
  CONTENT_IMAGE_MIMES,
  MAX_ASSETS_PER_ITEM,
  contentAssetPrefix,
} from '@/lib/content/catalog'

/** Vida de la URL firmada de una imagen completa. Lo que dura revisar una pieza. */
const FULL_URL_TTL = 60 * 60

/**
 * ¿Los bytes son de verdad lo que dicen ser?
 *   WebP: "RIFF" .... "WEBP" (bytes 0-3 y 8-11).
 *   JPEG: FF D8 FF.
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

function intField(form: FormData, name: string, max: number): number | null {
  const raw = form.get(name)
  if (typeof raw !== 'string') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0 || n > max) return null
  return n
}

export async function GET(request: NextRequest, { params }: { params: { itemId: string } }) {
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

  const { data: assets } = (await admin
    .from('content_assets')
    .select('id, path, width, height, position')
    .eq('item_id', params.itemId)
    .order('position', { ascending: true })) as {
    data: { id: string; path: string; width: number | null; height: number | null; position: number }[] | null
  }

  const filas = assets ?? []
  if (filas.length === 0) return NextResponse.json({ assets: [] })

  const { data: signed } = await admin.storage
    .from(CONTENT_ASSETS_BUCKET)
    .createSignedUrls(
      filas.map((a) => a.path),
      FULL_URL_TTL,
    )

  // Se emparejan POR RUTA y nunca por indice: createSignedUrls puede fallar en
  // un objeto suelto y devolver el arreglo desalineado, lo que mostraria la
  // imagen equivocada en la pieza equivocada.
  const urlPorRuta = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlPorRuta.set(s.path, s.signedUrl)
  }

  return NextResponse.json({
    assets: filas.map((a) => ({
      id: a.id,
      width: a.width,
      height: a.height,
      position: a.position,
      url: urlPorRuta.get(a.path) ?? null,
    })),
  })
}

export async function POST(request: NextRequest, { params }: { params: { itemId: string } }) {
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
  if (acceso.status === 'publicado') {
    return NextResponse.json(
      { error: 'Esta pieza ya se publicó. Regrésala a revisión para cambiarla.' },
      { status: 409 },
    )
  }

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
  if (full.size > CONTENT_IMAGE_MAX_BYTES || thumb.size > CONTENT_THUMB_MAX_BYTES) {
    return NextResponse.json(
      { error: 'La imagen no viene comprimida. Vuelve a intentarlo desde la pantalla de contenidos.' },
      { status: 413 },
    )
  }

  const fullBytes = new Uint8Array(await full.arrayBuffer())
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer())

  const fullMime = sniffMime(fullBytes)
  const thumbMime = sniffMime(thumbBytes)
  if (!fullMime || !thumbMime || !CONTENT_IMAGE_MIMES.includes(fullMime)) {
    return NextResponse.json({ error: 'Formato de imagen no admitido' }, { status: 415 })
  }

  const { count } = await admin
    .from('content_assets')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', params.itemId)

  if ((count ?? 0) >= MAX_ASSETS_PER_ITEM) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ASSETS_PER_ITEM} imágenes por pieza.` },
      { status: 409 },
    )
  }

  const ext = fullMime === 'image/webp' ? 'webp' : 'jpg'
  // El path lo arma el SERVIDOR con el id ya resuelto en base, asi que un cliente
  // no puede escribir dentro de la carpeta de otra pieza.
  const base = `${contentAssetPrefix(params.itemId)}${randomUUID()}`
  const path = `${base}.${ext}`
  const thumbPath = `${base}_t.${ext}`

  const up = await admin.storage
    .from(CONTENT_ASSETS_BUCKET)
    .upload(path, fullBytes, { contentType: fullMime, upsert: false })
  if (up.error) {
    console.error('[content assets] upload full error:', up.error)
    return NextResponse.json({ error: 'No se pudo guardar la imagen' }, { status: 500 })
  }

  const upThumb = await admin.storage
    .from(CONTENT_ASSETS_BUCKET)
    .upload(thumbPath, thumbBytes, { contentType: thumbMime, upsert: false })
  if (upThumb.error) {
    console.error('[content assets] upload thumb error:', upThumb.error)
    // Sin miniatura la galeria tendria que bajar la imagen completa por cada
    // pieza. Antes que dejarlo a medias, se retira el objeto grande.
    await admin.storage.from(CONTENT_ASSETS_BUCKET).remove([path])
    return NextResponse.json({ error: 'No se pudo guardar la imagen' }, { status: 500 })
  }

  const { data: asset, error } = (await admin
    .from('content_assets')
    .insert({
      item_id: params.itemId,
      path,
      thumb_path: thumbPath,
      width: intField(form, 'width', 20000),
      height: intField(form, 'height', 20000),
      bytes: fullBytes.byteLength,
      thumb_bytes: thumbBytes.byteLength,
      position: count ?? 0,
    })
    .select('id, width, height, position')
    .single()) as {
    data: { id: string; width: number | null; height: number | null; position: number } | null
    error: unknown
  }

  if (error || !asset) {
    console.error('[content assets] insert error:', error)
    // La fila es lo que hace localizable al objeto: sin ella los binarios son
    // basura que igual se cobra.
    await admin.storage.from(CONTENT_ASSETS_BUCKET).remove([path, thumbPath])
    return NextResponse.json({ error: 'No se pudo registrar la imagen' }, { status: 500 })
  }

  // La miniatura se devuelve ya firmada: quien acaba de subirla quiere verla sin
  // una segunda vuelta al servidor.
  const { data: signed } = await admin.storage
    .from(CONTENT_ASSETS_BUCKET)
    .createSignedUrl(thumbPath, 60 * 60 * 4)

  return NextResponse.json(
    {
      asset: {
        id: asset.id,
        width: asset.width,
        height: asset.height,
        position: asset.position,
        thumb_url: signed?.signedUrl ?? null,
      },
    },
    { status: 201 },
  )
}
