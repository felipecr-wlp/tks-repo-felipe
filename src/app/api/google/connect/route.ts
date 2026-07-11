/**
 * GET /api/google/connect, Inicia el flujo de OAuth de Google Calendar.
 *
 * Este flujo es INDEPENDIENTE del login de Supabase: pedimos consentimiento
 * incremental con scope de calendario (solo lectura) y, tras el callback,
 * guardamos los tokens en google_connections. El usuario debe estar logueado.
 *
 * Seguridad:
 * - Requiere sesion (401 si no hay user).
 * - Genera un state aleatorio (CSRF) y lo guarda en cookie httpOnly; el callback
 *   lo revalida antes de aceptar el code.
 * - access_type=offline + prompt=consent para obtener refresh_token.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { getOAuthClient, CALENDAR_SCOPES, isGoogleConfigured } from '@/lib/google/client'

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const { origin, searchParams } = new URL(request.url)

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(`${origin}/?google=not_configured`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/auth/login?next=/`)
  }

  // Destino al que volver despues de conectar (solo rutas internas seguras).
  const nextRaw = searchParams.get('next') ?? '/'
  const isSafeNext =
    nextRaw.startsWith('/') && !nextRaw.startsWith('//') && !nextRaw.startsWith('/\\')
  const next = isSafeNext ? nextRaw : '/'

  // state anti-CSRF: valor aleatorio que revalidamos en el callback.
  const state = randomBytes(24).toString('hex')

  const oauth2 = getOAuthClient(origin)
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: CALENDAR_SCOPES,
    state,
  })

  const res = NextResponse.redirect(authUrl)
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 10, // 10 minutos: ventana del flujo OAuth
  }
  res.cookies.set('g_oauth_state', state, cookieOpts)
  res.cookies.set('g_oauth_next', next, cookieOpts)
  return res
}
