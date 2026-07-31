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
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

/** Registro de un archivo ya subido por signed upload URL. */
const registerSchema = z.object({
  path: z.string().min(1).max(400),
  name: z.string().min(1).max(200),
})

import {
  TASK_FILES_BUCKET as BUCKET,
  TASK_FILES_DIRECT_MAX_SIZE,
  TASK_FILES_MIME_ALLOWLIST as MIME_ALLOWLIST,
  loadTaskWithAccess,
  safeFileName,
  taskFilePrefix,
} from '@/lib/task-files'

const SIGNED_TTL = 60 * 60 // 1 hora

type AttachmentRow = {
  id: string; name: string; url: string; mime_type: string | null
  size: number | null; uploaded_by: string; created_at: string
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

  const admin = createAdminClient()
  const { task, isMember } = await loadTaskWithAccess(admin, params.taskId, user.id)
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
  if (!isMember) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Dos caminos de entrada:
  //  (a) JSON  -> el archivo YA esta en storage, subido con signed upload URL
  //               directo desde el navegador. Unico camino viable para video.
  //  (b) multipart -> camino legacy, el binario pasa por la function. Sigue vivo
  //               por compatibilidad, acotado por debajo del techo de Vercel.
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json')

  let path: string
  let safeName: string
  let mime: string
  let size: number

  if (isJson) {
    let raw: unknown
    try { raw = await request.json() }
    catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

    const parsed = registerSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
    }

    // El path DEBE caer bajo el prefijo de ESTA tarea. Sin este check, un
    // cliente podria registrar como propio un objeto de otra tarea pasando su
    // path y leerlo despues por la signed URL del GET.
    if (!parsed.data.path.startsWith(taskFilePrefix(params.taskId))) {
      return NextResponse.json({ error: 'Ruta de archivo inválida' }, { status: 422 })
    }

    // El objeto tiene que existir de verdad. Ademas se toman mime y tamaño de
    // STORAGE, no de lo que declare el cliente.
    const dir = parsed.data.path.slice(0, parsed.data.path.lastIndexOf('/'))
    const base = parsed.data.path.slice(parsed.data.path.lastIndexOf('/') + 1)
    const { data: found } = await admin.storage.from(BUCKET).list(dir, { search: base, limit: 1 })
    const object = (found ?? []).find(o => o.name === base)
    if (!object) {
      return NextResponse.json({ error: 'El archivo no se subió' }, { status: 422 })
    }

    const meta = object.metadata as { size?: number; mimetype?: string } | null
    mime = meta?.mimetype || 'application/octet-stream'
    size = meta?.size ?? 0

    if (!MIME_ALLOWLIST.has(mime)) {
      await admin.storage.from(BUCKET).remove([parsed.data.path])
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 422 })
    }

    path = parsed.data.path
    safeName = safeFileName(parsed.data.name)
  } else {
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
    if (file.size > TASK_FILES_DIRECT_MAX_SIZE) {
      return NextResponse.json(
        { error: 'Archivo demasiado grande para esta vía. Usá la subida directa.' },
        { status: 422 },
      )
    }
    mime = file.type || 'application/octet-stream'
    if (!MIME_ALLOWLIST.has(mime)) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 422 })
    }

    safeName = safeFileName(file.name)
    path = `${taskFilePrefix(params.taskId)}${randomUUID()}-${safeName}`
    size = file.size

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: false,
    })
    if (upErr) {
      console.error('[attachments POST] upload error:', upErr)
      return NextResponse.json({ error: 'Error al subir el archivo' }, { status: 500 })
    }
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
      size,
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
