/**
 * POST /api/tasks/[taskId]/attachments/upload-url
 *
 * Devuelve una SIGNED UPLOAD URL para que el navegador suba el archivo DIRECTO
 * a Supabase Storage, sin pasar el binario por la serverless function.
 *
 * Por que existe: en Vercel el cuerpo de una request a una function esta acotado
 * a ~4.5MB, asi que la subida multipart clasica revienta con 413 mucho antes del
 * limite que declara la app. Un creativo en video de campaña jamas entraria por
 * ahi. Con este camino el binario viaja navegador -> storage y la API solo firma
 * y registra.
 *
 * Seguridad:
 *  - Auth + loadTaskWithAccess (membresia del proyecto de ESA tarea, anti-IDOR).
 *  - El path lo construye el SERVIDOR bajo el prefijo task/<taskId>/, nunca el
 *    cliente. La firma solo habilita escribir en ese path concreto.
 *  - Nombre saneado (sin traversal) y mime validado contra la allowlist.
 *  - El tamaño declarado aqui es una criba temprana; el tamaño REAL se
 *    re-verifica contra storage al registrar el adjunto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import {
  TASK_FILES_BUCKET,
  TASK_FILES_MAX_SIZE,
  TASK_FILES_MIME_ALLOWLIST,
  loadTaskWithAccess,
  safeFileName,
  taskFilePrefix,
} from '@/lib/task-files'

const schema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  size: z.number().int().positive().max(TASK_FILES_MAX_SIZE),
})

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

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  if (!TASK_FILES_MIME_ALLOWLIST.has(parsed.data.mime)) {
    return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { task, isMember } = await loadTaskWithAccess(admin, params.taskId, user.id)
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
  if (!isMember) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const safeName = safeFileName(parsed.data.name)
  const path = `${taskFilePrefix(params.taskId)}${randomUUID()}-${safeName}`

  const { data: signed, error } = await admin
    .storage
    .from(TASK_FILES_BUCKET)
    .createSignedUploadUrl(path)

  if (error || !signed) {
    console.error('[attachments upload-url] signed url error:', error)
    return NextResponse.json({ error: 'Error al preparar la subida' }, { status: 500 })
  }

  return NextResponse.json({
    path,
    token: signed.token,
    name: safeName,
    bucket: TASK_FILES_BUCKET,
  }, { status: 201 })
}
