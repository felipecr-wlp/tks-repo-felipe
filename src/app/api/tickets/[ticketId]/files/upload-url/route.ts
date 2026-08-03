/**
 * POST /api/tickets/[ticketId]/files/upload-url
 *
 * Devuelve una SIGNED UPLOAD URL para que el navegador suba el archivo DIRECTO a
 * Supabase Storage, sin pasar el binario por la serverless function.
 *
 * Por que existe: en Vercel el cuerpo de una request a una function esta acotado
 * a ~4.5MB. Un ZIP con capturas y logs, que es justo lo que se adjunta a una
 * peticion de soporte, revienta con un 413 que la app ni siquiera controla. Con
 * este camino el binario viaja navegador -> storage y la API solo firma.
 *
 * Seguridad:
 *  - Auth + puedeVer (los cinco motivos de acceso, anti-IDOR).
 *  - El path lo construye el SERVIDOR bajo el prefijo ticket/<id>/, nunca el
 *    cliente. La firma solo habilita escribir en ese path concreto.
 *  - Nombre saneado (sin traversal) y mime normalizado y validado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { cargarSolicitud, puedeVer } from '@/lib/tickets/acceso'
import {
  TICKET_FILES_BUCKET,
  TICKET_FILES_MAX_SIZE,
  TICKET_FILES_MIME_ALLOWLIST,
  nombreSeguro,
  normalizaMime,
  prefijoDeSolicitud,
} from '@/lib/tickets/archivos'

const schema = z
  .object({
    name: z.string().min(1).max(200),
    // Se acepta vacio a proposito: varios navegadores no mandan tipo para .rar y
    // .7z, y `normalizaMime` lo deduce de la extension. Rechazar aqui haria que
    // el archivo correcto se cayera por su nombre correcto.
    mime: z.string().max(120).optional(),
    size: z.number().int().positive().max(TICKET_FILES_MAX_SIZE),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
) {
  if (!isUuid(params.ticketId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let crudo: unknown
  try { crudo = await request.json() }
  catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(crudo)
  if (!parsed.success) {
    return NextResponse.json({ error: 'El archivo es demasiado grande o no tiene nombre' }, { status: 422 })
  }

  const mime = normalizaMime(parsed.data.name, parsed.data.mime)
  if (!TICKET_FILES_MIME_ALLOWLIST.has(mime)) {
    return NextResponse.json(
      { error: 'Ese tipo de archivo no se puede adjuntar. Comprímelo en un ZIP y súbelo así.' },
      { status: 422 },
    )
  }

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!puedeVer(s)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const safeName = nombreSeguro(parsed.data.name)
  const path = `${prefijoDeSolicitud(s.id)}${randomUUID()}-${safeName}`

  const { data: signed, error } = await admin
    .storage
    .from(TICKET_FILES_BUCKET)
    .createSignedUploadUrl(path)

  if (error || !signed) {
    console.error('[tickets upload-url] signed url error:', error)
    return NextResponse.json({ error: 'Error al preparar la subida' }, { status: 500 })
  }

  return NextResponse.json(
    { path, token: signed.token, name: safeName, mime, bucket: TICKET_FILES_BUCKET },
    { status: 201 },
  )
}
