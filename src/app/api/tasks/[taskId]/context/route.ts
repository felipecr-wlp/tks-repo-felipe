/**
 * GET /api/tasks/[taskId]/context
 * Estados y miembros del proyecto al que pertenece una tarea.
 *
 * Existe por una razon concreta: el TaskDetailPanel necesita `statuses` y
 * `members` para pintar los selectores, y hasta ahora esos dos datos SOLO
 * llegaban desde el server component del tablero. Eso ataba el panel al
 * proyecto: cualquier otra pantalla que quisiera abrir una tarea tenia que
 * mandar a la persona al tablero y sacarla de donde estaba.
 *
 * El reporte diario es justo ese caso. La actividad dice "avance el brief" y
 * enlaza la tarea; abrirla no deberia costar perder el dia que estabas leyendo.
 * Con este endpoint el panel se puede montar desde cualquier lado con solo el
 * id de la tarea.
 *
 * Anti-IDOR: el project_id se deriva de la tarea, nunca del cliente, y el
 * acceso se valida con la MISMA funcion que usa GET /api/tasks/[taskId]. Si
 * alguien no puede ver la tarea, tampoco ve quien la puede tomar.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessProject } from '@/lib/team-access'

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: task } = (await admin
    .from('tasks')
    .select('id, project_id, project:projects ( id, name )')
    .eq('id', params.taskId)
    .maybeSingle()) as {
      data: { id: string; project_id: string; project: { id: string; name: string } | null } | null
    }

  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { ok } = await canAccessProject(admin, task.project_id, user.id)
  if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Las dos consultas son independientes: en serie se notarian al abrir el modal.
  const [statusesRes, membersRes] = await Promise.all([
    admin
      .from('task_statuses')
      .select('id, name, color, category, position')
      .eq('project_id', task.project_id)
      .order('position', { ascending: true }),
    admin
      .from('project_members')
      .select('profile:profiles ( id, display_name, avatar_url )')
      .eq('project_id', task.project_id),
  ])

  type StatusRow = { id: string; name: string; color: string | null; category: string; position: number }
  type MemberRow = { profile: { id: string; display_name: string; avatar_url: string | null } | null }

  const statuses = (statusesRes.data ?? []) as StatusRow[]
  const members = ((membersRes.data ?? []) as MemberRow[])
    .filter(m => m.profile != null)
    .map(m => m.profile!)

  return NextResponse.json({
    project: task.project ? { id: task.project.id, name: task.project.name } : null,
    statuses,
    members,
  })
}
