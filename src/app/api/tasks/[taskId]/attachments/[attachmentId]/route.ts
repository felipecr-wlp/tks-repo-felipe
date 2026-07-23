/**
 * DELETE /api/tasks/[taskId]/attachments/[attachmentId], Borra un adjunto.
 *
 * Autorizacion: solo quien lo subio, o un manager del proyecto (o lider / org
 * owner-admin). Se borra el objeto del bucket y luego la fila.
 * Anti-IDOR: el adjunto debe pertenecer al taskId de la ruta y el user debe ser
 * miembro del proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const BUCKET = 'task-files'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string; attachmentId: string } }
) {
  if (!isUuid(params.taskId) || !isUuid(params.attachmentId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type AttachmentRow = { id: string; task_id: string; project_id: string; url: string; uploaded_by: string }
  const { data: att } = await admin
    .from('task_attachments')
    .select('id, task_id, project_id, url, uploaded_by')
    .eq('id', params.attachmentId)
    .maybeSingle() as { data: AttachmentRow | null }

  if (!att || att.task_id !== params.taskId) {
    return NextResponse.json({ error: 'Adjunto no encontrado' }, { status: 404 })
  }

  // Membresia + rol para decidir permiso de borrado.
  const [{ data: membership }, { data: project }, { data: profile }] = await Promise.all([
    admin.from('project_members').select('role').eq('project_id', att.project_id).eq('profile_id', user.id).maybeSingle() as unknown as Promise<{ data: { role: string } | null }>,
    admin.from('projects').select('lead_id').eq('id', att.project_id).maybeSingle() as unknown as Promise<{ data: { lead_id: string | null } | null }>,
    admin.from('profiles').select('org_role').eq('id', user.id).maybeSingle() as unknown as Promise<{ data: { org_role: string } | null }>,
  ])

  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const isManager = membership.role === 'manager'
    || project?.lead_id === user.id
    || profile?.org_role === 'owner' || profile?.org_role === 'admin'
  const canDelete = att.uploaded_by === user.id || isManager
  if (!canDelete) {
    return NextResponse.json({ error: 'No puedes borrar este adjunto' }, { status: 403 })
  }

  // Borrar objeto del bucket (best-effort) y luego la fila.
  await admin.storage.from(BUCKET).remove([att.url])

  const { error: delErr } = await admin
    .from('task_attachments')
    .delete()
    .eq('id', att.id)

  if (delErr) {
    console.error('[attachments DELETE] delete error:', delErr)
    return NextResponse.json({ error: 'Error al borrar el adjunto' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
