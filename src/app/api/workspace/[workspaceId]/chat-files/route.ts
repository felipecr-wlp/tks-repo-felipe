/**
 * POST /api/workspace/[workspaceId]/chat-files
 * Sube un archivo al bucket privado chat-files, scoped por workspace, y devuelve
 * la referencia mínima { path, name, mime, size } para adjuntarla a un mensaje
 * del canal General (columna attachments jsonb). NO crea el mensaje.
 *
 * Seguridad (espeja el endpoint del chat de equipo):
 *  - Auth + canAccessWorkspaceById (miembro del workspace o admin de la org).
 *  - workspaceId viene de la ruta; el path se scopea a workspace/<id>/… (anti-IDOR).
 *  - Validación server-side: tamaño <= 25MB y allowlist de mime.
 *  - Bucket privado: el contenido solo se sirve con signed URL temporal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessWorkspaceById } from '@/lib/team-access'
import {
  CHAT_FILES_BUCKET as BUCKET,
  CHAT_FILES_MAX_SIZE as MAX_SIZE,
  CHAT_FILES_MIME_ALLOWLIST as MIME_ALLOWLIST,
} from '@/lib/chat-files'

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let form: FormData
  try { form = await request.formData() }
  catch { return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo' }, { status: 422 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'El archivo está vacío' }, { status: 422 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'El archivo supera el límite de 25MB' }, { status: 422 })
  }
  const mime = file.type || 'application/octet-stream'
  if (!MIME_ALLOWLIST.has(mime)) {
    return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 422 })
  }

  const admin = createAdminClient()
  if (!(await canAccessWorkspaceById(admin, params.workspaceId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })
  }

  // Nombre saneado + path scoped por workspace (evita traversal y colisiones).
  const safeName = (file.name || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120)
  const path = `workspace/${params.workspaceId}/${randomUUID()}-${safeName}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: false,
  })
  if (upErr) {
    console.error('[ws chat-files POST] upload error:', upErr)
    return NextResponse.json({ error: 'Error al subir el archivo' }, { status: 500 })
  }

  return NextResponse.json(
    { path, name: safeName, mime, size: file.size },
    { status: 201 }
  )
}
