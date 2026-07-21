/**
 * POST /api/teams/[teamId]/chat-files
 * Sube un archivo al bucket privado chat-files, scoped por equipo, y devuelve la
 * referencia mínima { path, name, mime, size } para que el cliente la adjunte a
 * un mensaje (columna attachments jsonb). NO crea el mensaje: solo sube el objeto.
 *
 * Seguridad (espeja task-files):
 *  - Auth + canAccessTeamById (miembro del equipo o admin del workspace).
 *  - teamId viene de la ruta; el path se scopea a team/<teamId>/… (anti-IDOR).
 *  - Validación server-side: tamaño <= 25MB y allowlist de mime.
 *  - Bucket privado: el contenido solo se sirve con signed URL temporal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessTeamById } from '@/lib/team-access'
import {
  CHAT_FILES_BUCKET as BUCKET,
  CHAT_FILES_MAX_SIZE as MAX_SIZE,
  CHAT_FILES_MIME_ALLOWLIST as MIME_ALLOWLIST,
} from '@/lib/chat-files'

export async function POST(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
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
  if (!(await canAccessTeamById(admin, params.teamId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // Nombre saneado + path scoped por equipo (evita traversal y colisiones).
  const safeName = (file.name || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120)
  const path = `team/${params.teamId}/${randomUUID()}-${safeName}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: false,
  })
  if (upErr) {
    console.error('[chat-files POST] upload error:', upErr)
    return NextResponse.json({ error: 'Error al subir el archivo' }, { status: 500 })
  }

  return NextResponse.json(
    { path, name: safeName, mime, size: file.size },
    { status: 201 }
  )
}
