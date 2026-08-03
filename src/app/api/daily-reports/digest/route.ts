/**
 * Reporte ARMADO de la bitacora.
 *
 * GET  ?workspace_id&from&to&period&profile_id  -> devuelve el guardado, si existe.
 * POST { workspace_id, from, to, period, profile_id?, force? } -> lo redacta y lo guarda.
 *
 * El GET existe para que abrir la pantalla NO cueste una llamada al modelo. Solo
 * el POST genera, y solo con `force` vuelve a generar uno que ya estaba: sin
 * eso, cada visita rearmaria el mismo reporte y el texto cambiaria de redaccion
 * cada vez, que es la forma mas rapida de que nadie confie en el.
 *
 * PRIVACIDAD: la misma regla que el resto de la bitacora. Quien no es mando
 * solo puede armar el SUYO, y el intento de pedir el de otro (o el del equipo)
 * se corta aqui con 403. Esto no es cosmetico: como todas las rutas /api usan
 * el service role y se saltan RLS, este archivo ES el candado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isReportSupervisor } from '@/lib/daily-report-access'
import { isValidReportDate } from '@/lib/daily-reports'
import { collectDigestMaterial, buildDigest, type DigestPeriod } from '@/lib/daily-report-digest'
import { esCuotaDeModeloAgotada, MENSAJE_CUOTA_AGOTADA } from '@/lib/ai/client'

export const maxDuration = 60

const PERIODS: DigestPeriod[] = ['dia', 'semana', 'rango']

/** Un rango sin tope permitiria pedir "todo el año" y reventar el contexto. */
const MAX_DIAS = 45

interface Scope {
  workspaceId: string
  profileId: string | null
  from: string
  to: string
  period: DigestPeriod
}

/**
 * Valida forma y permisos de una sola vez. Devuelve el scope ya saneado o la
 * respuesta de error, para que GET y POST no dupliquen el criterio (y no se les
 * despegue con el tiempo, que es como se abren los huecos de privacidad).
 */
async function resolveScope(
  raw: { workspace_id?: string; from?: string; to?: string; period?: string; profile_id?: string | null },
  userId: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ scope: Scope; isSupervisor: boolean } | NextResponse> {
  const { workspace_id, from, to } = raw
  if (!workspace_id || !isUuid(workspace_id)) {
    return NextResponse.json({ error: 'workspace_id inválido' }, { status: 422 })
  }
  if (!from || !to || !isValidReportDate(from) || !isValidReportDate(to)) {
    return NextResponse.json({ error: 'Rango de fechas inválido' }, { status: 422 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'El rango está al revés' }, { status: 422 })
  }
  const dias = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  if (dias > MAX_DIAS) {
    return NextResponse.json({ error: `El rango no puede pasar de ${MAX_DIAS} días` }, { status: 422 })
  }

  const period = (PERIODS as string[]).includes(raw.period ?? '') ? (raw.period as DigestPeriod) : 'rango'

  // Pertenencia al workspace. Sin esto, un id de workspace ajeno bastaria para
  // leer la bitacora de otra empresa.
  const { data: member } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  const isSupervisor = await isReportSupervisor(admin, workspace_id, userId)

  // `profile_id` ausente significa "el mío". Solo un mando puede pedir otro, o
  // el del equipo entero (profile_id explicitamente nulo).
  let profileId: string | null
  if (raw.profile_id === null || raw.profile_id === 'equipo') {
    if (!isSupervisor) {
      return NextResponse.json({ error: 'Solo puedes armar tu propio reporte' }, { status: 403 })
    }
    profileId = null
  } else if (!raw.profile_id) {
    profileId = userId
  } else {
    if (!isUuid(raw.profile_id)) {
      return NextResponse.json({ error: 'profile_id inválido' }, { status: 422 })
    }
    if (raw.profile_id !== userId && !isSupervisor) {
      return NextResponse.json({ error: 'Solo puedes armar tu propio reporte' }, { status: 403 })
    }
    profileId = raw.profile_id
  }

  return { scope: { workspaceId: workspace_id, profileId, from, to, period }, isSupervisor }
}

/** El guardado, si existe. `null` no es error: significa "todavía no se arma". */
async function findSaved(admin: ReturnType<typeof createAdminClient>, s: Scope) {
  let q = admin
    .from('daily_report_digests')
    .select('id, content, updated_at, profile_id')
    .eq('workspace_id', s.workspaceId)
    .eq('period', s.period)
    .eq('period_start', s.from)
  q = s.profileId ? q.eq('profile_id', s.profileId) : q.is('profile_id', null)
  const { data } = (await q.maybeSingle()) as {
    data: { id: string; content: string; updated_at: string; profile_id: string | null } | null
  }
  return data
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const sp = request.nextUrl.searchParams
  const resolved = await resolveScope(
    {
      workspace_id: sp.get('workspace_id') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      period: sp.get('period') ?? undefined,
      profile_id: sp.get('profile_id'),
    },
    user.id,
    admin
  )
  if (resolved instanceof NextResponse) return resolved

  const saved = await findSaved(admin, resolved.scope)
  return NextResponse.json({
    content: saved?.content ?? null,
    updated_at: saved?.updated_at ?? null,
  })
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 422 })
  }

  const admin = createAdminClient()
  const resolved = await resolveScope(body as Parameters<typeof resolveScope>[0], user.id, admin)
  if (resolved instanceof NextResponse) return resolved
  const { scope } = resolved

  // Sin `force`, un reporte ya armado se devuelve tal cual: rearmarlo cuesta
  // una llamada al modelo y cambia la redaccion de algo que quiza ya se citó.
  if (!body.force) {
    const saved = await findSaved(admin, scope)
    if (saved) {
      return NextResponse.json({ content: saved.content, updated_at: saved.updated_at, cached: true })
    }
  }

  // Nombre de la persona, solo para que el reporte no hable de un uuid.
  let persona: string | null = null
  if (scope.profileId) {
    const { data: p } = (await admin
      .from('profiles')
      .select('display_name')
      .eq('id', scope.profileId)
      .maybeSingle()) as { data: { display_name: string } | null }
    persona = p?.display_name ?? null
  }

  try {
    const material = await collectDigestMaterial(admin, scope)
    const result = await buildDigest(material, {
      period: scope.period,
      from: scope.from,
      to: scope.to,
      persona,
    })

    // Sin material no se guarda nada. Un reporte vacio guardado sale despues por
    // el GET y parece un reporte de verdad que dice que no se hizo nada.
    if (!result) {
      return NextResponse.json(
        { content: null, empty: true, error: 'No hay actividades registradas en ese periodo' },
        { status: 200 }
      )
    }

    const { data: saved, error } = await admin
      .from('daily_report_digests')
      .upsert(
        {
          workspace_id: scope.workspaceId,
          profile_id: scope.profileId,
          period: scope.period,
          period_start: scope.from,
          period_end: scope.to,
          content: result.content,
          generated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        // Una sola lista para los dos casos (digest de persona y de equipo). El
        // indice que la respalda es unico y total, con NULLS NOT DISTINCT, asi
        // que `profile_id` nulo tambien colisiona consigo mismo. Antes habia un
        // ternario apuntando a dos indices PARCIALES: PostgREST no puede pasar el
        // predicado WHERE de un indice parcial, asi que Postgres no podia
        // inferirlo y devolvia 42P10 siempre. Ver la migracion
        // 20260813000000_digest_unico_nulls_not_distinct.sql.
        { onConflict: 'workspace_id,profile_id,period,period_start' }
      )
      .select('updated_at')
      .maybeSingle()

    if (error) {
      // El reporte ya esta redactado. Que falle GUARDARLO no es razon para
      // tirarlo: se devuelve igual y la persona lo copia.
      console.error('[daily-reports digest POST] no se pudo guardar:', error)
      return NextResponse.json({ content: result.content, updated_at: null, saved: false })
    }

    return NextResponse.json({
      content: result.content,
      updated_at: saved?.updated_at ?? null,
      actividades: result.totalActividades,
      cached: false,
    })
  } catch (err) {
    // Quedarse sin cupo del dia NO es un fallo de la aplicacion, y decirlo como
    // 500 "No se pudo armar el reporte" hace que la persona reintente y que
    // quien mire los logs busque un bug que no existe. 429 con el motivo real.
    if (esCuotaDeModeloAgotada(err)) {
      console.warn('[daily-reports digest POST] cuota del modelo agotada:', err)
      return NextResponse.json({ error: MENSAJE_CUOTA_AGOTADA }, { status: 429 })
    }
    console.error('[daily-reports digest POST] error:', err)
    return NextResponse.json({ error: 'No se pudo armar el reporte' }, { status: 500 })
  }
}
