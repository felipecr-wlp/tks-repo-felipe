/**
 * POST /api/tickets/[ticketId]/files
 *   Registra en la solicitud un archivo YA subido por signed URL.
 *
 * GET  /api/tickets/[ticketId]/files?path=...
 *   Devuelve una URL firmada temporal para descargarlo.
 *
 * Las dos operaciones comparten la misma comprobacion, que es la que importa: el
 * `path` tiene que empezar con el prefijo de ESTA solicitud. Sin ella, pasar el
 * path de un adjunto ajeno bastaria para leerlo, porque el bucket es privado
 * pero el admin client firma lo que le pidan.
 *
 * ── Por que el tamaño se vuelve a leer de storage ───────────────────────────
 * El `size` que manda el cliente al pedir la firma es una criba temprana, y un
 * cliente manipulado puede mentir. Aqui se lee el tamaño REAL del objeto: si no
 * existe, el registro no procede y no queda una fila apuntando a la nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { cargarSolicitud, puedeVer } from '@/lib/tickets/acceso'
import {
  TICKET_FILES_BUCKET,
  TICKET_FILES_MAX_SIZE,
  leerAdjuntos,
  prefijoDeSolicitud,
} from '@/lib/tickets/archivos'

const registrarSchema = z
  .object({
    path: z.string().min(1).max(400),
    name: z.string().min(1).max(200),
    mime: z.string().min(1).max(120),
  })
  .strict()

/** Tope de adjuntos por solicitud. No es capricho: la fila es jsonb y se lee
 *  entera en cada consulta del tablero. */
const MAX_ADJUNTOS = 12

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

  const parsed = registrarSchema.safeParse(crudo)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!puedeVer(s)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const prefijo = prefijoDeSolicitud(s.id)
  if (!parsed.data.path.startsWith(prefijo)) {
    return NextResponse.json({ error: 'Ese archivo no es de esta solicitud' }, { status: 422 })
  }

  // Tamaño real del objeto. `list` con search sobre el prefijo es la unica forma
  // de leer metadatos de un objeto privado sin descargarlo.
  const nombreObjeto = parsed.data.path.slice(prefijo.length)
  const { data: objetos } = await admin
    .storage
    .from(TICKET_FILES_BUCKET)
    .list(prefijo.replace(/\/$/, ''), { search: nombreObjeto, limit: 1 })

  const objeto = (objetos ?? [])[0]
  if (!objeto) {
    return NextResponse.json({ error: 'El archivo no llegó a subirse' }, { status: 422 })
  }
  const size = (objeto.metadata as { size?: number } | null)?.size ?? 0
  if (size <= 0 || size > TICKET_FILES_MAX_SIZE) {
    return NextResponse.json({ error: 'El archivo excede el tamaño permitido' }, { status: 422 })
  }

  const { data: fila } = (await admin
    .from('tickets').select('attachments').eq('id', s.id).single()) as {
    data: { attachments: unknown } | null
  }
  const previos = leerAdjuntos(fila?.attachments)
  if (previos.length >= MAX_ADJUNTOS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ADJUNTOS} archivos por solicitud. Comprime los demás en un ZIP.` },
      { status: 422 },
    )
  }

  const siguientes = [
    ...previos,
    { path: parsed.data.path, name: parsed.data.name, size, mime: parsed.data.mime },
  ]

  const { error } = await admin.from('tickets').update({ attachments: siguientes }).eq('id', s.id)
  if (error) {
    console.error('[tickets files] update error:', error)
    return NextResponse.json({ error: 'No se pudo registrar el archivo' }, { status: 500 })
  }

  return NextResponse.json({ attachments: siguientes }, { status: 201 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
) {
  if (!isUuid(params.ticketId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const path = request.nextUrl.searchParams.get('path') ?? ''
  if (!path) return NextResponse.json({ error: 'Falta el archivo' }, { status: 422 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!puedeVer(s)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  if (!path.startsWith(prefijoDeSolicitud(s.id))) {
    return NextResponse.json({ error: 'Ese archivo no es de esta solicitud' }, { status: 422 })
  }

  // 60 segundos: lo justo para que el navegador arranque la descarga. Una URL
  // firmada de horas es una URL publica con retraso.
  const { data, error } = await admin
    .storage
    .from(TICKET_FILES_BUCKET)
    .createSignedUrl(path, 60)

  if (error || !data) {
    console.error('[tickets files] signed url error:', error)
    return NextResponse.json({ error: 'No se pudo abrir el archivo' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
