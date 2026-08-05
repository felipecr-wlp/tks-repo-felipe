/**
 * Middleware de Next.js, se ejecuta en CADA request (Edge Runtime)
 *
 * Responsabilidades:
 * 1. Refresh de sesión Supabase, mantiene tokens frescos
 * 2. Verificación de autenticación, redirige a /login si no hay sesión
 * 3. Domain restriction, solo @ALLOWED_EMAIL_DOMAIN puede acceder
 * 4. Publica la ruta pedida en el header `x-pathname`
 *
 * Sobre el punto 4: un layout de servidor no conoce su propia URL, y el layout
 * del workspace la necesita para bloquear de verdad las pantallas que un admin
 * le apagó a una persona. Esconder el botón en la barra no basta, la URL se
 * pega a mano. El header viaja en el REQUEST (no en la respuesta), que es lo
 * único que `headers()` sabe leer.
 *
 * NOTA: Rate limiting NO se hace aquí (Edge Runtime no soporta @upstash/redis node.js).
 * El rate limiting se aplica en los Route Handlers de API via src/lib/rate-limit.ts
 */
import { NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/unauthorized',
  '/auth/callback',
  '/api/auth/callback',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Rutas públicas: pass-through ─────────────────────────
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // ── Assets estáticos: pass-through ───────────────────────
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // ── Refresh sesión + verificar auth ──────────────────────
  const { supabaseResponse, user } = await updateSession(request)

  if (!user) {
    const loginUrl = new URL('/auth/login', request.url)
    // searchParams.set ya hace el encoding, no llamar encodeURIComponent
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Domain restriction ────────────────────────────────────
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? '')
    .split(',').map(d => d.trim()).filter(Boolean)
  if (allowedDomains.length > 0 && user.email && !allowedDomains.some(d => user.email!.endsWith(`@${d}`))) {
    return NextResponse.redirect(new URL('/auth/unauthorized', request.url))
  }

  // ── Ruta pedida, visible para los Server Components ───────
  // Se rehace la respuesta para inyectar el header en el request. Las cookies
  // que Supabase acaba de refrescar se copian tal cual: perderlas aquí seria
  // cerrar la sesión en cada navegación.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie)
  }
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/plugins|plugins/|\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
