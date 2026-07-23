/**
 * GET /api/google/callback, Callback del flujo de OAuth de Google Calendar.
 *
 * Google redirige aqui con ?code y ?state. Revalidamos el state contra la cookie
 * (CSRF), intercambiamos el code por tokens, identificamos la cuenta de Google y
 * hacemos upsert en google_connections. Los tokens NUNCA se exponen al cliente.
 *
 * Preservamos el refresh_token existente: Google solo devuelve refresh_token la
 * primera vez (o con prompt=consent), asi que si viene vacio conservamos el que
 * ya teniamos para no romper la reconexion silenciosa.
 */
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/validation'
import { getOAuthClient } from '@/lib/google/client'
import { safeEqual } from '@/lib/secure-compare'
import { errMessage } from '@/lib/safe-log'

export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url)

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  const stateCookie = request.cookies.get('g_oauth_state')?.value
  const next = safeInternalPath(request.cookies.get('g_oauth_next')?.value)

  // Limpia las cookies del flujo en cualquier salida.
  const clearCookies = (res: NextResponse) => {
    res.cookies.set('g_oauth_state', '', { path: '/', maxAge: 0 })
    res.cookies.set('g_oauth_next', '', { path: '/', maxAge: 0 })
    return res
  }

  if (oauthError) {
    return clearCookies(NextResponse.redirect(`${origin}${next}?google=error`))
  }
  if (!code || !state || !stateCookie || !safeEqual(state, stateCookie)) {
    return clearCookies(NextResponse.redirect(`${origin}${next}?google=state_mismatch`))
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return clearCookies(NextResponse.redirect(`${origin}/auth/login`))
  }

  try {
    const oauth2 = getOAuthClient(origin)
    const { tokens } = await oauth2.getToken(code)
    oauth2.setCredentials(tokens)

    // Identificar la cuenta de Google (id + email) para la conexion.
    let googleUserId: string | null = null
    let googleEmail: string | null = null
    try {
      const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 })
      const { data: info } = await oauth2Api.userinfo.get()
      googleUserId = info.id ?? null
      googleEmail = info.email ?? null
    } catch (e) {
      // No es fatal: podemos guardar la conexion sin el id de Google.
      console.error('[google/callback] userinfo error:', errMessage(e))
    }

    const admin = createAdminClient()

    // refresh_token existente (si Google no lo devuelve esta vez, lo conservamos).
    const { data: existing } = await admin
      .from('google_connections')
      .select('refresh_token')
      .eq('profile_id', user.id)
      .maybeSingle()

    const refreshToken = tokens.refresh_token ?? existing?.refresh_token ?? null
    const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : []
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null

    const { error: upsertError } = await admin
      .from('google_connections')
      .upsert(
        {
          profile_id: user.id,
          google_user_id: googleUserId,
          email: googleEmail,
          access_token: tokens.access_token ?? '',
          refresh_token: refreshToken,
          token_expiry: tokenExpiry,
          scopes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id' },
      )

    if (upsertError) {
      console.error('[google/callback] upsert error:', errMessage(upsertError))
      return clearCookies(NextResponse.redirect(`${origin}${next}?google=save_error`))
    }

    return clearCookies(NextResponse.redirect(`${origin}${next}?google=connected`))
  } catch (e) {
    console.error('[google/callback] token exchange error:', errMessage(e))
    return clearCookies(NextResponse.redirect(`${origin}${next}?google=error`))
  }
}
