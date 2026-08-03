/**
 * PATCH /api/tickets/[ticketId]
 *
 * Un solo handler para TODAS las acciones sobre una solicitud, porque quien
 * decide si proceden no es este archivo: es la tabla de transiciones de
 * src/lib/tickets/flujo-solicitud.ts. Aqui solo se reunen los tres hechos que
 * esa tabla necesita (quien eres, en que estado esta, que traes escrito) y se
 * obedece el veredicto.
 *
 * La consecuencia practica: agregar una accion nueva es agregar una FILA, no un
 * `if` mas en una cadena que ya nadie lee entera.
 *
 * ── Por que cada accion deja un comentario de sistema ────────────────────────
 * "Bien comunicado" no es mandar mas correos, es que la conversacion y las
 * decisiones se lean en el MISMO hilo y en orden. Si el cambio de estado viviera
 * en una bitacora aparte, para entender por que algo se rechazo habria que leer
 * dos listas e intercalarlas mentalmente. Por eso `is_system` es una columna de
 * ticket_comments y no una tabla nueva.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/activity'
import { cargarSolicitud, puedeVer } from '@/lib/tickets/acceso'
import { evaluarAccion, TRANSICIONES, type AccionSolicitud } from '@/lib/tickets/flujo-solicitud'
import { esTipoValido, esPrioridadValida } from '@/lib/tickets/catalogo'
import { esUrlSegura } from '@/lib/tickets/archivos'

const ACCIONES = [
  'editar', 'canalizar', 'rechazar', 'arrancar', 'resolver', 'cancelar', 'reabrir',
] as const

const schema = z
  .object({
    accion: z.enum(ACCIONES),
    /** Motivo / explicacion. Obligatorio en las acciones con `exigeNota`. */
    nota: z.string().trim().max(5000).optional(),

    // Destino (solo se lee al canalizar).
    spaceId: z.string().uuid().nullish(),
    assigneeId: z.string().uuid().nullish(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),

    // Campos editables (solo se leen al editar).
    title: z.string().trim().min(3).max(200).optional(),
    body: z.string().trim().max(10000).nullish(),
    kind: z.string().max(40).refine(esTipoValido, 'Tipo no reconocido').optional(),
    priority: z.string().max(20).refine(esPrioridadValida, 'Urgencia no reconocida').optional(),
    needed_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    links: z
      .array(z.object({
        url: z.string().max(2000).refine(esUrlSegura, 'Solo enlaces http o https'),
        label: z.string().trim().max(120).optional(),
      }))
      .max(20)
      .optional(),
  })
  .strict()

/** Frase que queda en el hilo por cada accion. Se lee como la contaria alguien. */
const FRASE: Record<AccionSolicitud, string> = {
  editar:    'actualizó la solicitud',
  canalizar: 'canalizó la solicitud',
  rechazar:  'rechazó la solicitud',
  arrancar:  'empezó a trabajar en esto',
  resolver:  'marcó la solicitud como resuelta',
  cancelar:  'canceló la solicitud',
  reabrir:   'reabrió la solicitud',
}

/** Tipo de notificacion por accion, para que la bandeja diga que paso. */
const TIPO_AVISO: Record<AccionSolicitud, string> = {
  editar:    'ticket_updated',
  canalizar: 'ticket_channeled',
  rechazar:  'ticket_rejected',
  arrancar:  'ticket_started',
  resolver:  'ticket_resolved',
  cancelar:  'ticket_cancelled',
  reabrir:   'ticket_reopened',
}

/**
 * GET /api/tickets/[ticketId]
 *
 * El detalle completo: hilo, involucrados y adjuntos. Existe para que el tablero
 * NO tenga que traerlo todo de entrada. Con 80 solicitudes abiertas, cargar sus
 * hilos por si acaso son cientos de filas que casi nadie mira; asi se pagan solo
 * las que se abren.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
) {
  if (!isUuid(params.ticketId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!puedeVer(s)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const [{ data: comentarios }, { data: watchers }] = await Promise.all([
    admin
      .from('ticket_comments')
      .select(
        'id, parent_id, body, attachments, is_system, created_at, edited_at, autor:profiles!ticket_comments_author_id_fkey ( id, display_name, avatar_url )',
      )
      .eq('ticket_id', s.id)
      .order('created_at', { ascending: true })
      .limit(500),
    admin
      .from('ticket_watchers')
      .select('profile_id, perfil:profiles!ticket_watchers_profile_id_fkey ( id, display_name, avatar_url )')
      .eq('ticket_id', s.id),
  ])

  return NextResponse.json({
    comentarios: comentarios ?? [],
    involucrados: watchers ?? [],
    // Se devuelve para que la pantalla sepa que botones dibujar sin volver a
    // deducirlo del lado del cliente, que es donde se desincronizaria.
    yo: {
      esSolicitante: s.esSolicitante,
      esResponsable: s.esResponsable,
      esAdmin: s.esAdmin,
    },
  })
}

export async function PATCH(
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
      { error: primero?.message ?? 'Datos inválidos', campo: primero?.path.join('.') },
      { status: 422 },
    )
  }
  const d = parsed.data

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!s.esMiembroDelWorkspace) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  // El destino que TENDRA despues de esta accion, no el que tiene ahora: se
  // canaliza y se asigna en el mismo movimiento, y evaluar contra el estado
  // viejo rechazaria justo el caso normal.
  const spaceFinal = d.spaceId !== undefined ? d.spaceId : s.space_id
  const assigneeFinal = d.assigneeId !== undefined ? d.assigneeId : s.assignee_id

  const veredicto = evaluarAccion({
    accion: d.accion,
    estadoActual: s.status,
    esSolicitante: s.esSolicitante,
    esResponsable: s.esResponsable,
    esAdmin: s.esAdmin,
    tieneNota: Boolean(d.nota && d.nota.length > 0),
    tieneDestino: Boolean(spaceFinal || assigneeFinal),
  })
  if (!veredicto.ok) {
    return NextResponse.json({ error: veredicto.error }, { status: veredicto.estado })
  }

  const regla = TRANSICIONES[d.accion]
  const ahora = new Date().toISOString()

  // Solo se escriben las columnas que la accion tiene derecho a tocar. Pasar el
  // body entero al update seria el bug: mandar `title` junto a `rechazar`
  // reescribiria la peticion en el mismo momento de rechazarla.
  const cambios: Record<string, unknown> = {}
  if (regla.hacia) cambios.status = regla.hacia
  cambios.closed_at = regla.cierra ? ahora : regla.hacia ? null : undefined
  if (cambios.closed_at === undefined) delete cambios.closed_at

  if (d.accion === 'editar') {
    if (d.title !== undefined) cambios.title = d.title
    if (d.body !== undefined) cambios.body = d.body || null
    if (d.kind !== undefined) cambios.kind = d.kind
    if (d.priority !== undefined) cambios.priority = d.priority
    if (d.needed_by !== undefined) cambios.needed_by = d.needed_by || null
    if (d.links !== undefined) cambios.links = d.links
  }

  if (d.accion === 'canalizar') {
    // El departamento tiene que ser de ESTE workspace, igual que al crear.
    if (spaceFinal) {
      const { data: space } = await admin
        .from('spaces').select('id')
        .eq('id', spaceFinal).eq('workspace_id', s.workspace_id).maybeSingle()
      if (!space) {
        return NextResponse.json({ error: 'Ese departamento no es de este workspace' }, { status: 422 })
      }
    }
    // Y el responsable tiene que pertenecer al workspace. Asignarle trabajo a
    // alguien que no puede entrar a verlo es la version silenciosa de no
    // asignarselo a nadie.
    if (assigneeFinal) {
      const { data: m } = await admin
        .from('workspace_members').select('profile_id')
        .eq('workspace_id', s.workspace_id).eq('profile_id', assigneeFinal).maybeSingle()
      if (!m) {
        return NextResponse.json({ error: 'Esa persona no pertenece a este workspace' }, { status: 422 })
      }
    }
    cambios.space_id = spaceFinal ?? null
    cambios.assignee_id = assigneeFinal ?? null
    if (d.dueDate !== undefined) cambios.due_date = d.dueDate || null
    cambios.decision_note = d.nota || null
    cambios.decided_by = user.id
    cambios.decided_at = ahora
  }

  if (d.accion === 'rechazar') {
    cambios.decision_note = d.nota ?? null
    cambios.decided_by = user.id
    cambios.decided_at = ahora
  }

  const { error: errUpd } = await admin.from('tickets').update(cambios).eq('id', s.id)
  if (errUpd) {
    console.error('[tickets PATCH] update error:', errUpd)
    return NextResponse.json({ error: 'No se pudo actualizar la solicitud' }, { status: 500 })
  }

  // El rastro en el hilo. Falla suave: la solicitud ya cambio de estado, y no
  // poder escribir la linea de bitacora no es motivo para deshacer la decision.
  const cuerpo = d.nota ? `${FRASE[d.accion]}: ${d.nota}` : FRASE[d.accion]
  await admin.from('ticket_comments').insert({
    ticket_id: s.id,
    author_id: user.id,
    body: cuerpo,
    is_system: true,
  })

  await avisar(admin, {
    workspaceId: s.workspace_id,
    ticketId: s.id,
    actorId: user.id,
    tipo: TIPO_AVISO[d.accion],
    titulo: cuerpo.slice(0, 200),
    extra: [s.requested_by, assigneeFinal],
  })

  return NextResponse.json({ ok: true, status: regla.hacia ?? s.status })
}

/**
 * Avisa a todo el que este involucrado en la solicitud menos al que actuo.
 *
 * `extra` deja meter a quien todavia no es watcher formal (el solicitante y el
 * recien asignado). Es el caso que importa: a quien acabas de poner a cargo hay
 * que avisarle ANTES de que se convierta en observador, no despues.
 */
async function avisar(
  admin: ReturnType<typeof createAdminClient>,
  p: {
    workspaceId: string
    ticketId: string
    actorId: string
    tipo: string
    titulo: string
    extra: (string | null | undefined)[]
  },
) {
  try {
    const destinos = new Set<string>()
    for (const id of p.extra) if (id) destinos.add(id)

    const { data: watchers } = await admin
      .from('ticket_watchers').select('profile_id').eq('ticket_id', p.ticketId)
    for (const w of (watchers ?? []) as { profile_id: string }[]) destinos.add(w.profile_id)

    destinos.delete(p.actorId)

    await Promise.all(
      [...destinos].map((id) =>
        notify({
          workspace_id: p.workspaceId,
          recipient_id: id,
          subject_id: p.actorId,
          type: p.tipo,
          object_type: 'ticket',
          object_id: p.ticketId,
          object_title: p.titulo,
        }),
      ),
    )
  } catch (e) {
    console.error('[tickets] aviso:', e)
  }
}

/**
 * DELETE /api/tickets/[ticketId]
 * Solo mandos, y solo como valvula para basura o duplicados. Para arrepentirse
 * esta 'cancelar', que deja rastro; borrar es la unica operacion que no lo deja
 * y por eso no la tiene ni quien la pidio.
 */
export async function DELETE(
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

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!s.esAdmin) {
    return NextResponse.json({ error: 'Solo un administrador puede borrar una solicitud' }, { status: 403 })
  }

  const { error } = await admin.from('tickets').delete().eq('id', s.id)
  if (error) {
    console.error('[tickets DELETE] error:', error)
    return NextResponse.json({ error: 'No se pudo borrar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
