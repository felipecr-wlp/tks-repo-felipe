/**
 * GET  /api/tasks/[taskId]/attachments, Lista adjuntos (con signed URL).
 * POST /api/tasks/[taskId]/attachments, Sube un adjunto (multipart/form-data, campo "file").
 *
 * Seguridad:
 *  - Auth + re-chequeo de membresia del proyecto en el handler (anti-IDOR).
 *  - El taskId viene de la ruta; project_id/workspace_id se resuelven de la tarea,
 *    NUNCA del body.
 *  - Validacion server-side: tamano <= 25MB, allowlist de mime, path scoped por task.
 *  - Bucket privado task-files: se sirve solo con signed URL temporal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const BUCKET = 'task-files'
const MAX_SIZE = 25 * 1024 * 1024 // 25MB
const SIGNED_TTL = 60 * 60 // 1 hora

const MIME_ALLOWLIST = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
])

type TaskRow = { project_id: string; workspace_id: string }
type AttachmentRow = {
  id: string; name: string; url: string; mime_type: string | null
  size: number | null; uploaded_by: string; created_at: string
}

// Verifica que el user sea miembro del proyecto de la tarea.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTaskWithAccess(admin: any, taskId: string, userId: string): Promise<{ task: TaskRow | null; isMember: boolean }> {
  const { data: task } = await admin
    .from('tasks')
    .select('project_id, workspace_id')
    .eq('id', taskId)
    .maybeSingle() as { data: TaskRow | null }
  if (!task) return { task: null, isMember: false }

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  return { task, isMember: !!membership }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function toDto(admin: any, row: AttachmentRow) {
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(row.url, SIGNED_TTL)
  return {
    id: row.id,
    name: row.name,
    url: signed?.signedUrl ?? null,
    mime_type: row.mime_type,
    size: row.size,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { task, isMember } = await loadTaskWithAccess(admin, params.taskId, user.id)
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
  if (!isMember) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: rows } = await admin
    .from('task_attachments')
    .select('id, name, url, mime_type, size, uploaded_by, created_at')
    .eq('task_id', params.taskId)
    .order('created_at', { ascending: true }) as { data: AttachmentRow[] | null }

  const dtos = await Promise.all((rows ?? []).map(r => toDto(admin, r)))
  return NextResponse.json(dtos)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
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
    return NextResponse.json({ error: 'El archivo esta vacio' }, { status: 422 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'El archivo supera el limite de 25MB' }, { status: 422 })
  }
  const mime = file.type || 'application/octet-stream'
  if (!MIME_ALLOWLIST.has(mime)) {
    return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { task, isMember } = await loadTaskWithAccess(admin, params.taskId, user.id)
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
  if (!isMember) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Nombre saneado + path scoped por task (evita traversal y colisiones).
  const safeName = (file.name || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120)
  const path = `task/${params.taskId}/${randomUUID()}-${safeName}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: false,
  })
  if (upErr) {
    console.error('[attachments POST] upload error:', upErr)
    return NextResponse.json({ error: 'Error al subir el archivo' }, { status: 500 })
  }

  const { data: row, error: insErr } = await admin
    .from('task_attachments')
    .insert({
      task_id:      params.taskId,
      project_id:   task.project_id,
      workspace_id: task.workspace_id,
      name:         safeName,
      url:          path,
      mime_type:    mime,
      size:         file.size,
      uploaded_by:  user.id,
    })
    .select('id, name, url, mime_type, size, uploaded_by, created_at')
    .single() as { data: AttachmentRow | null; error: unknown }

  if (insErr || !row) {
    // Rollback del objeto si el insert falla.
    await admin.storage.from(BUCKET).remove([path])
    console.error('[attachments POST] insert error:', insErr)
    return NextResponse.json({ error: 'Error al registrar el adjunto' }, { status: 500 })
  }

  const dto = await toDto(admin, row)
  return NextResponse.json(dto, { status: 201 })
}
