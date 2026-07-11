/**
 * GET /api/calendar/events?from=&to=, Lista eventos del Google Calendar del
 * usuario (calendario "primary"), normalizados para el front.
 *
 * Todo corre en el servidor: cargamos la conexion del usuario desde
 * google_connections, refrescamos el access_token si expiro (google.auth.OAuth2)
 * y persistimos los tokens nuevos. Los tokens NUNCA se envian al cliente.
 *
 * Respuestas de estado (no 500) para que el front pueda reaccionar:
 * - 409 { reason: 'not_connected' }  -> mostrar CTA "Conectar Google Calendar".
 * - 409 { reason: 'reconnect' }      -> token revocado / refresh invalido.
 *
 * Seguridad: auth obligatorio, rate limit, y solo se lee la conexion del propio
 * user (profile_id = user.id). from/to validados con zod.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { google } from 'googleapis'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { getOAuthClient } from '@/lib/google/client'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Refuerzo server-side opcional (el filtrado fuerte vive en el cliente).
  q: z.string().max(200).optional(),
  hideAllDay: z.enum(['true', 'false']).optional(),
}).strict()

type GoogleConnectionRow = {
  access_token: string | null
  refresh_token: string | null
  token_expiry: string | null
  scopes: string[] | null
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const { origin, searchParams } = new URL(request.url)

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const parsed = querySchema.safeParse({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    hideAllDay: searchParams.get('hideAllDay') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parametros invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  // Rango por defecto: desde hace 1 dia hasta 60 dias adelante.
  const now = new Date()
  const timeMin = parsed.data.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const timeMax = parsed.data.to ?? new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conn } = await (admin as any)
    .from('google_connections')
    .select('access_token, refresh_token, token_expiry, scopes')
    .eq('profile_id', user.id)
    .maybeSingle() as { data: GoogleConnectionRow | null }

  if (!conn || (!conn.access_token && !conn.refresh_token)) {
    return NextResponse.json({ reason: 'not_connected' }, { status: 409 })
  }

  const oauth2 = getOAuthClient(origin)
  oauth2.setCredentials({
    access_token: conn.access_token ?? undefined,
    refresh_token: conn.refresh_token ?? undefined,
    expiry_date: conn.token_expiry ? new Date(conn.token_expiry).getTime() : undefined,
  })

  // Si googleapis refresca el token, persiste el nuevo access_token/expiry.
  oauth2.on('tokens', (tokens) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (tokens.access_token) patch.access_token = tokens.access_token
    if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token
    if (tokens.expiry_date) patch.token_expiry = new Date(tokens.expiry_date).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (admin as any).from('google_connections').update(patch).eq('profile_id', user.id)
  })

  try {
    // Fuerza refresh si expiro: getAccessToken usa el refresh_token si hace falta.
    await oauth2.getAccessToken()

    const calendar = google.calendar({ version: 'v3', auth: oauth2 })
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    })

    const q = parsed.data.q?.trim().toLowerCase()
    const hideAllDay = parsed.data.hideAllDay === 'true'

    const events = (data.items ?? []).map((ev) => {
      const allDay = Boolean(ev.start?.date)
      return {
        id: ev.id ?? '',
        title: ev.summary ?? '(sin titulo)',
        start: ev.start?.dateTime ?? ev.start?.date ?? null,
        end: ev.end?.dateTime ?? ev.end?.date ?? null,
        allDay,
        htmlLink: ev.htmlLink ?? null,
      }
    })
      .filter((e) => e.start)
      .filter((e) => !(hideAllDay && e.allDay))
      .filter((e) => !q || e.title.toLowerCase().includes(q))

    return NextResponse.json({ events })
  } catch (e: unknown) {
    // invalid_grant / token revocado => pedir reconexion, no 500.
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('invalid_grant') || msg.includes('invalid_token') || msg.includes('unauthorized')) {
      return NextResponse.json({ reason: 'reconnect' }, { status: 409 })
    }
    console.error('[calendar/events] error:', msg)
    return NextResponse.json({ error: 'Error al leer el calendario' }, { status: 502 })
  }
}
