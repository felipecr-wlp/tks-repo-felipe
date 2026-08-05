/**
 * Una actividad del reporte diario.
 *
 * DELETE -> la borra.
 * PATCH  -> marca (o desmarca) un bloqueo como resuelto, y/o guarda el detalle.
 *
 * En ambos casos solo el autor del reporte al que pertenece la entrada. Se
 * resuelve el dueño subiendo por report_id en vez de confiar en nada que venga
 * del cliente: el id de una entrada es adivinable, la pertenencia no.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { sanitizeRichText } from '@/lib/sanitize'
import { notifyBlockerResolved } from '@/lib/daily-report-blockers'

/**
 * El cuerpo del PATCH declara sus campos con zod, como el resto de la API: una
 * excepcion en el patron obliga a cada lector (y a cada tripwire) a distinguir
 * entre "aqui se valida distinto" y "aqui no se valida". `strict()` ademas
 * rechaza campos de mas en vez de ignorarlos.
 *
 * Los dos campos son opcionales pero el cuerpo vacio se rechaza. Sin ese
 * `refine`, un PATCH `{}` respondería 200 sin haber tocado nada: el peor de los
 * dos mundos, porque el cliente se queda creyendo que guardo.
 *
 * `details` acepta null a proposito. Es como se BORRA el detalle; si solo
 * aceptara texto, vaciar el editor no tendria forma de llegar a la base y el
 * detalle viejo se quedaria para siempre.
 */
const patchSchema = z
  .object({
    resolved: z.boolean().optional(),
    // Mismo techo que el resumen del dia (20k). Es HTML del editor, asi que un
    // texto normal cabe de sobra y una pegada de un documento entero no.
    details: z.string().max(20000).nullable().optional(),
  })
  .strict()
  .refine(v => v.resolved !== undefined || v.details !== undefined, {
    message: 'Nada que actualizar',
  })

/**
 * ¿El editor trae algo de verdad? Un editor vacio no devuelve cadena vacia,
 * devuelve `<p></p>`. Guardar eso pintaria un detalle en blanco que ocupa lugar,
 * y peor: haria que la actividad se vea "con detalle" cuando no lo tiene.
 */
function detalleConTexto(html: string): string | null {
  const limpio = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return limpio.length > 0 ? html : null
}

export async function DELETE(request: NextRequest, { params }: { params: { entryId: string } }) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  // Un id malformado hace que Postgres lance 22P02 y el handler devuelva un 500
  // opaco. Se corta antes de tocar la base.
  if (!isUuid(params.entryId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: entry } = (await admin
    .from('daily_report_entries')
    .select('id, report:daily_reports ( id, profile_id )')
    .eq('id', params.entryId)
    .maybeSingle()) as {
    data: { id: string; report: { id: string; profile_id: string } | null } | null
    error: unknown
  }

  if (!entry) return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 })
  if (entry.report?.profile_id !== user.id) {
    return NextResponse.json({ error: 'Solo puedes editar tu propio reporte' }, { status: 403 })
  }

  const { error } = await admin.from('daily_report_entries').delete().eq('id', params.entryId)
  if (error) {
    console.error('[daily-reports entry DELETE] error:', error)
    return NextResponse.json({ error: 'No se pudo borrar la actividad' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * PATCH { resolved?: boolean, details?: string | null }
 *
 * `resolved` cierra o reabre un bloqueo. Se permite reabrir a proposito: la
 * persona marca "ya quedo", al dia siguiente descubre que no quedo, y sin poder
 * reabrir tendria que escribir un bloqueo nuevo. Eso rompe la cuenta de dias
 * detenido, que es el numero que hace que un bloqueo viejo se note.
 *
 * `details` guarda el detalle largo de la actividad (HTML del editor, con los
 * enlaces a lo entregado). Se sanea SIEMPRE en el servidor: el editor del
 * cliente no es una barrera, cualquiera puede llamar esta ruta con curl, y el
 * detalle se pinta despues con dangerouslySetInnerHTML tanto para el autor como
 * para su mando. Ese es exactamente el camino de un stored XSS.
 */
export async function PATCH(request: NextRequest, { params }: { params: { entryId: string } }) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  if (!isUuid(params.entryId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 422 })
  }
  const { resolved, details } = parsed.data

  const admin = createAdminClient()

  const { data: entry } = (await admin
    .from('daily_report_entries')
    .select('id, category, content, resolved_at, report:daily_reports ( id, profile_id, workspace_id, report_date )')
    .eq('id', params.entryId)
    .maybeSingle()) as {
    data: {
      id: string
      category: string
      content: string
      resolved_at: string | null
      report: { id: string; profile_id: string; workspace_id: string; report_date: string } | null
    } | null
    error: unknown
  }

  if (!entry || !entry.report) return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 })
  if (entry.report.profile_id !== user.id) {
    return NextResponse.json({ error: 'Solo puedes editar tu propio reporte' }, { status: 403 })
  }
  // `resolved_at` solo significa algo en un bloqueo. Dejar que se marque un
  // avance como resuelto llenaria la columna de ruido sin sentido.
  //
  // La comprobacion cuelga de `resolved !== undefined` y no de la ruta entera:
  // el detalle se escribe en CUALQUIER actividad, y antes de separarlo un
  // PATCH de detalle sobre un avance habria muerto aqui con un mensaje que no
  // tiene nada que ver con lo que la persona intentaba hacer.
  if (resolved !== undefined && entry.category !== 'bloqueo') {
    return NextResponse.json({ error: 'Solo los bloqueos se resuelven' }, { status: 422 })
  }

  const patch: { resolved_at?: string | null; details?: string | null } = {}
  if (resolved !== undefined) {
    patch.resolved_at = resolved ? new Date().toISOString() : null
  }
  if (details !== undefined) {
    // null llega tal cual (borrar). El texto se sanea y, si al quitarle las
    // etiquetas no queda nada, tambien se guarda como null.
    patch.details = details === null ? null : detalleConTexto(sanitizeRichText(details))
  }

  const yaEstaba = !!entry.resolved_at
  const { error } = await admin
    .from('daily_report_entries')
    .update(patch)
    .eq('id', params.entryId)

  if (error) {
    console.error('[daily-reports entry PATCH] error:', error)
    return NextResponse.json({ error: 'No se pudo actualizar la actividad' }, { status: 500 })
  }

  // Solo se avisa en la TRANSICION a resuelto. Sin esta guarda, dos clics
  // seguidos en el mismo boton mandarian dos veces la misma buena noticia.
  if (resolved && !yaEstaba) {
    await notifyBlockerResolved({
      admin,
      workspaceId: entry.report.workspace_id,
      userId: user.id,
      date: entry.report.report_date,
      content: entry.content,
    })
  }

  // Se devuelve el detalle YA saneado, no el que mando el cliente. Asi la
  // pantalla pinta exactamente lo que quedo guardado: si el saneador quito algo,
  // se ve en el acto en vez de descubrirse al recargar.
  return NextResponse.json({ ok: true, resolved, details: patch.details })
}
