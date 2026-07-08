/**
 * Middleware de Next.js — se ejecuta en CADA request (Edge Runtime)
 *
 * Responsabilidades:
 * 1. Refresh de sesión Supabase — mantiene tokens frescos
 * 2. Verificación de autenticación — redirige a /login si no hay sesión
 * 3. Domain restriction — solo @ALLOWED_EMAIL_DOMAIN puede acceder
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
    // searchParams.set ya hace el encoding — no llamar encodeURIComponent
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Domain restriction ────────────────────────────────────
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? '')
    .split(',').map(d => d.trim()).filter(Boolean)
  if (allowedDomains.length > 0 && user.email && !allowedDomains.some(d => user.email!.endsWith(`@${d}`))) {
    return NextResponse.redirect(new URL('/auth/unauthorized', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
