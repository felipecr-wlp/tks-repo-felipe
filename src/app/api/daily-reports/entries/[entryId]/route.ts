/**
 * Una actividad del reporte diario.
 *
 * DELETE -> la borra.
 * PATCH  -> marca (o desmarca) un bloqueo como resuelto.
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
import { notifyBlockerResolved } from '@/lib/daily-report-blockers'

/**
 * El cuerpo del PATCH es un solo booleano, y antes se comprobaba a mano con un
 * `typeof`. Hace lo mismo, pero el resto de la API declara sus cuerpos con zod y
 * una excepcion en el patron cuesta mas de lo que ahorra: obliga a cada lector
 * (y a cada tripwire) a distinguir entre "aqui se valida distinto" y "aqui no se
 * valida". `strict()` ademas rechaza campos de mas en vez de ignorarlos.
 */
const patchSchema = z.object({ resolved: z.boolean() }).strict()

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
 * PATCH { resolved: boolean } -> cierra o reabre un bloqueo.
 *
 * Se permite reabrir a proposito: la persona marca "ya quedo", al dia siguiente
 * descubre que no quedo, y sin poder reabrir tendria que escribir un bloqueo
 * nuevo. Eso rompe la cuenta de dias detenido, que es el numero que hace que un
 * bloqueo viejo se note.
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
    return NextResponse.json({ error: 'Falta el campo resolved' }, { status: 422 })
  }
  const { resolved } = parsed.data

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
  if (entry.category !== 'bloqueo') {
    return NextResponse.json({ error: 'Solo los bloqueos se resuelven' }, { status: 422 })
  }

  const yaEstaba = !!entry.resolved_at
  const { error } = await admin
    .from('daily_report_entries')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', params.entryId)

  if (error) {
    console.error('[daily-reports entry PATCH] error:', error)
    return NextResponse.json({ error: 'No se pudo actualizar el bloqueo' }, { status: 500 })
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

  return NextResponse.json({ ok: true, resolved: resolved })
}
