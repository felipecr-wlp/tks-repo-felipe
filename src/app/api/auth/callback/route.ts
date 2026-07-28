/**
 * Callback de OAuth, Supabase redirige aquí después del login con Google.
 * Intercambia el code por una sesión y redirige al destino.
 */
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/validation'
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

  // Verificar dominios permitidos (multi-domain, con subdominios). Un allowlist
  // de "welovepaving.com" tambien admite "ops.welovepaving.com" (subdominio
  // corporativo); nunca baja a un TLD suelto porque se compara contra el dominio
  // completo configurado.
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? '')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  if (allowedDomains.length > 0 && data.user.email) {
    const host = data.user.email.split('@')[1]?.toLowerCase() ?? ''
    const allowed = allowedDomains.some(d => host === d || host.endsWith(`.${d}`))
    if (!allowed) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/auth/unauthorized`)
    }
  }

  // TODO: Fase 0, Verificar si el usuario tiene org/workspace asignado
  // Si es el primer login, redirigir al onboarding

  // Redirigir al destino original o al workspace. Solo aceptamos rutas internas
  // (guarda centralizada en safeInternalPath): protocol-relative y URLs absolutas
  // sacarian al usuario a otro dominio.
  return NextResponse.redirect(`${origin}${safeInternalPath(next)}`)
}
