/**
 * Rate limiting para Route Handlers de API.
 *
 * NOTA: Este módulo usa @upstash/redis que NO es compatible con Edge Runtime.
 * Úsalo SOLO en Route Handlers (src/app/api/**), nunca en middleware.ts.
 *
 * Límites por defecto:
 * - General API: 60 req / 60s por IP
 * - AI endpoints: 10 req / 60s por IP (Gemini free tier: 15 RPM)
 * - Auth endpoints: 20 req / 60s por IP
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

// ── Instancia Redis ───────────────────────────────────────────────────────────
// Lazy-initialized para evitar errores en build si las vars no están seteadas
let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  }
  return redis
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
/** General API: 60 requests por minuto por IP */
export function getApiLimiter() {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(60, '60 s'),
    analytics: false,
    prefix: 'rl:api',
  })
}

/** AI endpoints: 10 requests por minuto (debajo del límite de Gemini free: 15 RPM) */
export function getAiLimiter() {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(10, '60 s'),
    analytics: false,
    prefix: 'rl:ai',
  })
}

/** Auth endpoints: 20 requests por minuto por IP */
export function getAuthLimiter() {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(20, '60 s'),
    analytics: false,
    prefix: 'rl:auth',
  })
}

// ── Helper: extrae IP del request ─────────────────────────────────────────────
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous'
  )
}

// ── Helper: aplica rate limit y retorna 429 si se excede ─────────────────────
/**
 * Aplica rate limiting a un Route Handler.
 * Retorna NextResponse(429) si se excede el límite, null si pasa.
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   const limited = await applyRateLimit(request, 'api')
 *   if (limited) return limited
 *   // ... resto del handler
 * }
 * ```
 */
export async function applyRateLimit(
  request: NextRequest,
  type: 'api' | 'ai' | 'auth' = 'api'
): Promise<NextResponse | null> {
  // Skip rate limiting si no hay Redis configurado (desarrollo local sin Upstash)
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }

  try {
    const ip = getClientIp(request)
    const limiter =
      type === 'ai'
        ? getAiLimiter()
        : type === 'auth'
          ? getAuthLimiter()
          : getApiLimiter()

    const { success, limit, remaining, reset } = await limiter.limit(ip)

    if (!success) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(reset),
            'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
          },
        }
      )
    }

    return null
  } catch {
    // Si Redis falla, no bloqueamos el request (fail open)
    console.error('[rate-limit] Redis error — skipping rate limit')
    return null
  }
}
