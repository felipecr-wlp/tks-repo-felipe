/**
 * POST /api/tickets/[ticketId]/comments
 * Escribe en el hilo de una solicitud. Con respuesta a otro comentario
 * (`parentId`) y con adjuntos ya subidos.
 *
 * ── Un solo nivel de profundidad, a proposito ────────────────────────────────
 * Si alguien responde a una respuesta, el comentario se cuelga del ABUELO. Los
 * hilos de profundidad libre se ven muy bien en el diseño y en la practica
 * producen conversaciones imposibles de seguir en un telefono, que es donde la
 * mitad del equipo lee esto. La regla se aplica aqui y no en la base porque un
 * CHECK no puede consultar otra fila de la misma tabla.
 *
 * ── Comentar NO es decidir ──────────────────────────────────────────────────
 * Cualquiera que pueda VER la solicitud puede comentarla, incluido quien fue
 * involucrado despues. Ese es el "intercambio de ideas": si opinar exigiera
 * mando, el hilo seria un monologo y la conversacion volveria al chat.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/activity'
import { cargarSolicitud, puedeVer } from '@/lib/tickets/acceso'
import { TICKET_FILES_MAX_SIZE, prefijoDeSolicitud } from '@/lib/tickets/archivos'

const adjuntoSchema = z.object({
  path: z.string().min(1).max(400),
  name: z.string().min(1).max(200),
  size: z.number().int().nonnegative().max(TICKET_FILES_MAX_SIZE),
  mime: z.string().min(1).max(120),
})

const schema = z
  .object({
    body: z.string().trim().min(1).max(10000),
    parentId: z.string().uuid().nullish(),
    attachments: z.array(adjuntoSchema).max(10).optional(),
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
    const primero = parsed.error.issues[0]
    return NextResponse.json(
      { error: primero?.message ?? 'Escribe algo antes de enviar', campo: primero?.path.join('.') },
      { status: 422 },
    )
  }
  const d = parsed.data

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!puedeVer(s)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // El padre tiene que ser de ESTA solicitud. Sin esta comprobacion se podria
  // colgar un comentario del hilo de otra y hacerlo aparecer donde no toca.
  let parentId: string | null = null
  if (d.parentId) {
    const { data: padre } = (await admin
      .from('ticket_comments')
      .select('id, ticket_id, parent_id')
      .eq('id', d.parentId)
      .maybeSingle()) as { data: { id: string; ticket_id: string; parent_id: string | null } | null }
    if (!padre || padre.ticket_id !== s.id) {
      return NextResponse.json({ error: 'Ese comentario no es de esta solicitud' }, { status: 422 })
    }
    // Aplanado a un nivel: responder a una respuesta cuelga del abuelo.
    parentId = padre.parent_id ?? padre.id
  }

  // Los adjuntos tienen que vivir bajo el prefijo de ESTA solicitud. Sin esto,
  // un cliente manipulado podria reclamar como suyo un objeto de otra y
  // enseñarselo a quien no deberia verlo.
  const prefijo = prefijoDeSolicitud(s.id)
  const adjuntos = (d.attachments ?? []).filter((a) => a.path.startsWith(prefijo))
  if (adjuntos.length !== (d.attachments ?? []).length) {
    return NextResponse.json({ error: 'Adjunto fuera de esta solicitud' }, { status: 422 })
  }

  const { data: comentario, error } = await admin
    .from('ticket_comments')
    .insert({
      ticket_id: s.id,
      author_id: user.id,
      parent_id: parentId,
      body: d.body,
      attachments: adjuntos,
    })
    .select('id, body, parent_id, attachments, created_at')
    .single()

  if (error || !comentario) {
    console.error('[ticket comments] insert error:', error)
    return NextResponse.json({ error: 'No se pudo publicar el comentario' }, { status: 500 })
  }

  // Avisar a los involucrados. Aqui esta el valor de ticket_watchers: sin ella
  // habria que reenviar el hilo por chat a quien se sumo tarde, y el hilo se
  // partiria en dos justo cuando mas gente lo esta leyendo.
  try {
    const destinos = new Set<string>()
    if (s.requested_by) destinos.add(s.requested_by)
    if (s.assignee_id) destinos.add(s.assignee_id)
    const { data: watchers } = await admin
      .from('ticket_watchers').select('profile_id').eq('ticket_id', s.id)
    for (const w of (watchers ?? []) as { profile_id: string }[]) destinos.add(w.profile_id)
    destinos.delete(user.id)

    await Promise.all(
      [...destinos].map((id) =>
        notify({
          workspace_id: s.workspace_id,
          recipient_id: id,
          subject_id: user.id,
          type: 'ticket_commented',
          object_type: 'ticket',
          object_id: s.id,
          object_title: d.body.slice(0, 160),
        }),
      ),
    )
  } catch (e) {
    console.error('[ticket comments] aviso:', e)
  }

  return NextResponse.json({ comentario }, { status: 201 })
}
