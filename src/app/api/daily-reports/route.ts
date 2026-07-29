/**
 * POST  /api/daily-reports          -> registra una actividad del dia (alta manual).
 * PATCH /api/daily-reports          -> guarda el resumen y abre o cierra el reporte.
 *
 * Es el camino "a mano" del mismo reporte que KERN llena por chat. Las dos
 * bocas escriben en las mismas tablas y comparten las reglas de src/lib/daily-reports.
 *
 * Seguridad: cada quien escribe UNICAMENTE su propio reporte. El profile_id sale
 * de la sesion, nunca del cuerpo de la peticion, asi que no hay forma de firmar
 * el dia de otra persona ni siquiera siendo admin. La pertenencia al workspace
 * se re-verifica en cada llamada (anti-IDOR sobre workspace_id).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { REPORT_CATEGORIES, todayInReportTz, isValidReportDate } from '@/lib/daily-reports'

type Admin = ReturnType<typeof createAdminClient>

/** El workspace debe existir Y el usuario debe ser miembro. */
async function resolveWorkspace(admin: Admin, workspaceId: string, userId: string) {
  const { data } = (await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  return data?.workspace_id ?? null
}

/**
 * Reporte del dia, creandolo si hace falta. Mismo criterio que en KERN: upsert
 * con ignoreDuplicates y relectura, para que dos altas simultaneas no choquen
 * contra el UNIQUE (workspace, persona, fecha).
 */
async function ensureReport(admin: Admin, workspaceId: string, userId: string, day: string) {
  const find = async () =>
    (await admin
      .from('daily_reports')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('profile_id', userId)
      .eq('report_date', day)
      .maybeSingle()) as { data: { id: string; status: string } | null; error: unknown }

  const { data: existing } = await find()
  if (existing) return existing

  const { error } = await admin
    .from('daily_reports')
    .upsert(
      { workspace_id: workspaceId, profile_id: userId, report_date: day },
      { onConflict: 'workspace_id,profile_id,report_date', ignoreDuplicates: true }
    )
  if (error) {
    console.error('[daily-reports ensureReport] upsert error:', error)
    return null
  }

  const { data: created } = await find()
  return created
}

// ── POST: una actividad ──────────────────────────────────────────────────────
const entrySchema = z
  .object({
    workspace_id: z.string().uuid(),
    content: z.string().min(3).max(1000).trim(),
    category: z.enum(REPORT_CATEGORIES).optional(),
    minutes: z.number().int().min(0).max(1440).nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = entrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { workspace_id, content, category, minutes, date } = parsed.data
  const admin = createAdminClient()

  if (!(await resolveWorkspace(admin, workspace_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso a ese espacio de trabajo' }, { status: 403 })
  }

  const day = date && isValidReportDate(date) ? date : todayInReportTz()
  const report = await ensureReport(admin, workspace_id, user.id, day)
  if (!report) return NextResponse.json({ error: 'No se pudo abrir el reporte del día' }, { status: 500 })

  const { data: entry, error } = (await admin
    .from('daily_report_entries')
    .insert({
      report_id: report.id,
      content,
      category: category ?? 'avance',
      minutes: minutes ?? null,
      source: 'manual',
    })
    .select('id, content, category, minutes, source, created_at')
    .single()) as {
    data: {
      id: string
      content: string
      category: string
      minutes: number | null
      source: string
      created_at: string
    } | null
    error: unknown
  }

  if (error || !entry) {
    console.error('[daily-reports POST] insert error:', error)
    return NextResponse.json({ error: 'No se pudo registrar la actividad' }, { status: 500 })
  }

  await admin.from('daily_reports').update({ updated_at: new Date().toISOString() }).eq('id', report.id)

  return NextResponse.json({ entry, report_id: report.id, date: day }, { status: 201 })
}

// ── PATCH: resumen y estado ──────────────────────────────────────────────────
const reportSchema = z
  .object({
    workspace_id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    summary: z.string().max(4000).trim().nullable().optional(),
    status: z.enum(['draft', 'submitted']).optional(),
  })
  .strict()

export async function PATCH(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = reportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { workspace_id, date, summary, status } = parsed.data
  const admin = createAdminClient()

  if (!(await resolveWorkspace(admin, workspace_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso a ese espacio de trabajo' }, { status: 403 })
  }

  const day = date && isValidReportDate(date) ? date : todayInReportTz()
  const report = await ensureReport(admin, workspace_id, user.id, day)
  if (!report) return NextResponse.json({ error: 'No se pudo abrir el reporte del día' }, { status: 500 })

  const patch: {
    updated_at: string
    summary?: string | null
    status?: string
    submitted_at?: string | null
  } = { updated_at: new Date().toISOString() }
  if (summary !== undefined) patch.summary = summary
  if (status !== undefined) {
    patch.status = status
    // Reabrir un reporte limpia la marca de entrega: dejarla puesta diria que
    // se entregó a una hora que ya no corresponde a lo que contiene.
    patch.submitted_at = status === 'submitted' ? new Date().toISOString() : null
  }

  const { error } = await admin.from('daily_reports').update(patch).eq('id', report.id)
  if (error) {
    console.error('[daily-reports PATCH] update error:', error)
    return NextResponse.json({ error: 'No se pudo actualizar el reporte' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, date: day, status: status ?? report.status })
}
