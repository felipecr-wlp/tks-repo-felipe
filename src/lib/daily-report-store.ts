/**
 * Acceso compartido al reporte del dia.
 *
 * Existe porque hay CUATRO bocas que abren el mismo reporte (la pantalla, la
 * ruta /api, las herramientas de KERN y el agente de reportes) y cada una tenia
 * su propia copia de la misma funcion. Cuatro copias de una operacion con una
 * carrera adentro es un error esperando su turno: basta con que una se arregle
 * y las otras no.
 */
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export interface DailyReportRef {
  id: string
  status: string
}

/**
 * Devuelve el reporte del dia de una persona, creandolo si no existe.
 *
 * No puede fallar por una carrera: dos mensajes seguidos entrarian a la vez y
 * el segundo chocaria contra el UNIQUE (workspace, persona, fecha). Por eso el
 * insert va con `upsert` sobre esa misma restriccion e `ignoreDuplicates`, y
 * despues se relee: quien pierda la carrera se encuentra la fila del otro en
 * vez de un error.
 */
export async function ensureDailyReport(
  admin: Admin,
  workspaceId: string,
  userId: string,
  day: string,
): Promise<DailyReportRef | null> {
  const find = async () =>
    (await admin
      .from('daily_reports')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('profile_id', userId)
      .eq('report_date', day)
      .maybeSingle()) as { data: DailyReportRef | null; error: unknown }

  const { data: existing } = await find()
  if (existing) return existing

  const { error } = await admin
    .from('daily_reports')
    .upsert(
      { workspace_id: workspaceId, profile_id: userId, report_date: day },
      { onConflict: 'workspace_id,profile_id,report_date', ignoreDuplicates: true }
    )

  if (error) {
    console.error('[ensureDailyReport] upsert error:', error)
    return null
  }

  const { data: created } = await find()
  return created
}

/** Marca movimiento en el reporte para que los listados ordenen por actividad real. */
export async function touchDailyReport(admin: Admin, reportId: string): Promise<void> {
  await admin.from('daily_reports').update({ updated_at: new Date().toISOString() }).eq('id', reportId)
}
