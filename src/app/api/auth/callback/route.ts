/**
 * Callback de OAuth, Supabase redirige aquí después del login con Google.
 * Intercambia el code por una sesión y redirige al destino.
 */
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)

  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  const error = searchParams.get('error')

  // Si Google devolvió error (usuario canceló, etc.)
  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=${error}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = createClient()
  const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

  if (sessionError || !data.user) {
    console.error('[auth/callback] Error:', sessionError?.message)
    return NextResponse.redirect(`${origin}/auth/login?error=session_error`)
  }

  // Verificar dominios permitidos (multi-domain)
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? '')
    .split(',').map(d => d.trim()).filter(Boolean)
  if (allowedDomains.length > 0 && data.user.email) {
    if (!allowedDomains.some(d => data.user.email!.endsWith(`@${d}`))) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/auth/unauthorized`)
    }
  }

  // TODO: Fase 0, Verificar si el usuario tiene org/workspace asignado
  // Si es el primer login, redirigir al onboarding

  // Redirigir al destino original o al workspace.
  // Solo aceptamos rutas internas: debe empezar con "/" pero NO con "//" ni
  // "/\" (redirect protocol-relative que sacaría al usuario a otro dominio).
  const isSafeNext = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
  const redirectUrl = isSafeNext ? `${origin}${next}` : origin
  return NextResponse.redirect(redirectUrl)
}
