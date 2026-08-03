/**
 * POST /api/tickets
 * Levanta una solicitud. Nace siempre en 'solicitado'.
 *
 * El estado inicial NO se acepta del cliente, por la misma razon que en el
 * planificador de contenido: si se pudiera mandar, cualquiera crearia la suya
 * directamente en 'canalizado' y la bandeja del admin se quedaria vacia, que es
 * justo lo que este modulo evita.
 *
 * Tampoco se acepta `assignee_id`. Elegir a quien le toca es EL acto de
 * canalizar, y ese es del admin. Quien pide puede sugerir un departamento
 * (`spaceId`), que es una pista, no una asignacion.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/activity'
import { esTipoValido, esPrioridadValida } from '@/lib/tickets/catalogo'
import { esUrlSegura } from '@/lib/tickets/archivos'

const enlaceSchema = z.object({
  url: z.string().max(2000).refine(esUrlSegura, 'Solo enlaces http o https'),
  label: z.string().trim().max(120).optional(),
})

const crearSchema = z
  .object({
    workspaceId: z.string().uuid(),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().max(10000).nullish(),
    // Tipo y prioridad se validan contra el catalogo de codigo. El techo va
    // ANTES del refine: sin el, una cadena enorme se recorre entera solo para
    // acabar rechazada por no estar en el catalogo.
    kind: z.string().max(40).refine(esTipoValido, 'Tipo de solicitud no reconocido'),
    priority: z.string().max(20).refine(esPrioridadValida, 'Urgencia no reconocida'),
    spaceId: z.string().uuid().nullish(),
    needed_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    links: z.array(enlaceSchema).max(20).optional(),
  })
  // Estricto: un campo de mas no se descarta en silencio, se nombra. La leccion
  // ya se pago una vez en la Academia, donde el panel mandaba `note` en lugar de
  // `nota`, zod lo tiraba sin decir nada y el API contestaba "hace falta el
  // motivo" a alguien que acababa de escribirlo.
  .strict()

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let crudo: unknown
  try { crudo = await request.json() }
  catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const parsed = crearSchema.safeParse(crudo)
  if (!parsed.success) {
    const primero = parsed.error.issues[0]
    return NextResponse.json(
      { error: primero?.message ?? 'Revisa los datos', campo: primero?.path.join('.') },
      { status: 422 },
    )
  }
  const d = parsed.data

  const admin = createAdminClient()

  // Membresia explicita: el admin client se salta RLS, asi que sin este check
  // cualquiera con sesion podria sembrar solicitudes en un workspace ajeno.
  const { data: membership } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', d.workspaceId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'No perteneces a este workspace' }, { status: 403 })
  }

  // El departamento tiene que ser de ESTE workspace. Sin esta comprobacion se
  // podria dirigir una solicitud a un departamento de otra organizacion y
  // hacersela visible a gente de fuera.
  if (d.spaceId) {
    const { data: space } = await admin
      .from('spaces')
      .select('id')
      .eq('id', d.spaceId)
      .eq('workspace_id', d.workspaceId)
      .maybeSingle()
    if (!space) {
      return NextResponse.json({ error: 'Ese departamento no es de este workspace' }, { status: 422 })
    }
  }

  const { data: ticket, error } = await admin
    .from('tickets')
    .insert({
      workspace_id: d.workspaceId,
      title: d.title,
      body: d.body || null,
      kind: d.kind,
      priority: d.priority,
      space_id: d.spaceId || null,
      needed_by: d.needed_by || null,
      links: d.links ?? [],
      // La autoria SIEMPRE sale de la sesion, nunca del body.
      requested_by: user.id,
    })
    .select('id, numero, title, status, kind, priority, created_at')
    .single()

  if (error || !ticket) {
    console.error('[tickets] insert error:', error)
    return NextResponse.json({ error: 'No se pudo crear la solicitud' }, { status: 500 })
  }

  // Avisar a quien tiene que decidir. Una solicitud que nadie sabe que existe es
  // identica a una que no se mando, y ese es el problema del que venimos.
  await avisarADecisores(admin, {
    workspaceId: d.workspaceId,
    ticketId: ticket.id as string,
    titulo: `#${ticket.numero} ${ticket.title}`,
    actorId: user.id,
    spaceId: d.spaceId || null,
  })

  return NextResponse.json({ ticket }, { status: 201 })
}

/**
 * Notifica a los mandos del workspace y, si la solicitud va dirigida a un
 * departamento, a los admins de ese departamento.
 *
 * Best effort a proposito: si el aviso falla, la solicitud YA quedo guardada y
 * visible en el tablero. Perder el correo es molesto; perder la peticion porque
 * el correo fallo seria absurdo.
 */
async function avisarADecisores(
  admin: ReturnType<typeof createAdminClient>,
  p: { workspaceId: string; ticketId: string; titulo: string; actorId: string; spaceId: string | null },
) {
  try {
    const destinos = new Set<string>()

    const { data: mandos } = await admin
      .from('workspace_members')
      .select('profile_id')
      .eq('workspace_id', p.workspaceId)
      .in('role', ['owner', 'admin'])
    for (const m of (mandos ?? []) as { profile_id: string }[]) destinos.add(m.profile_id)

    if (p.spaceId) {
      const { data: jefes } = await admin
        .from('space_members')
        .select('profile_id')
        .eq('space_id', p.spaceId)
        .in('role', ['owner', 'admin'])
      for (const m of (jefes ?? []) as { profile_id: string }[]) destinos.add(m.profile_id)
    }

    // Nadie se avisa a si mismo de lo que acaba de hacer.
    destinos.delete(p.actorId)

    await Promise.all(
      [...destinos].map((id) =>
        notify({
          workspace_id: p.workspaceId,
          recipient_id: id,
          subject_id: p.actorId,
          type: 'ticket_created',
          object_type: 'ticket',
          object_id: p.ticketId,
          object_title: p.titulo,
        }),
      ),
    )
  } catch (e) {
    console.error('[tickets] aviso a decisores:', e)
  }
}
