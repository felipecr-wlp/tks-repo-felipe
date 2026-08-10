/**
 * POST /api/academy/videos/upload-url  { name, mime, size, kind }
 *
 * Devuelve una SIGNED UPLOAD URL para subir el video (o su miniatura) DIRECTO
 * a Storage, sin pasar el binario por la serverless function (en Vercel el
 * cuerpo esta acotado a ~4.5MB; un video jamas entraria por ahi). Mismo camino
 * probado de task-files/upload-url.
 *
 * SOLO ADMIN: la galeria la publica quien gobierna la academia. El path lo
 * construye el SERVIDOR bajo videos/<uuid>/ o thumbs/<uuid>/, nunca el cliente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/team-access'
import {
  VIDEO_BUCKET,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_ALLOWLIST,
  THUMB_MIME_ALLOWLIST,
  nombreSeguro,
} from '@/lib/academy/videos'

const schema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  size: z.number().int().positive().max(VIDEO_MAX_BYTES),
  kind: z.enum(['video', 'thumb']),
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

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const allow = parsed.data.kind === 'video' ? VIDEO_MIME_ALLOWLIST : THUMB_MIME_ALLOWLIST
  if (!allow.has(parsed.data.mime)) {
    return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 422 })
  }

  const carpeta = parsed.data.kind === 'video' ? 'videos' : 'thumbs'
  const path = `${carpeta}/${randomUUID()}/${nombreSeguro(parsed.data.name)}`

  const admin = createAdminClient()
  const { data: signed, error } = await admin
    .storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(path)

  if (error || !signed) {
    console.error('[academy videos upload-url] signed url error:', error)
    return NextResponse.json({ error: 'Error al preparar la subida' }, { status: 500 })
  }

  // Se devuelve tambien la URL COMPLETA firmada: el cliente sube con XHR para
  // tener barra de progreso, y armar esa URL a mano en el navegador seria
  // duplicar el formato del endpoint de storage en dos lugares.
  return NextResponse.json({
    path,
    token: signed.token,
    bucket: VIDEO_BUCKET,
    signedUrl: signed.signedUrl,
  }, { status: 201 })
}
