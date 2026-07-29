/**
 * DELETE /api/daily-reports/entries/[entryId] -> borra una actividad del dia.
 *
 * Solo el autor del reporte al que pertenece la entrada. Se resuelve el dueño
 * subiendo por report_id en vez de confiar en nada que venga del cliente: el id
 * de una entrada es adivinable, la pertenencia no.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'

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
