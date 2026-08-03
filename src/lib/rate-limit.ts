/**
 * Rate limiting para Route Handlers de API.
 *
 * NOTA: Este módulo usa @upstash/redis que NO es compatible con Edge Runtime.
 * Úsalo SOLO en Route Handlers (src/app/api/**), nunca en middleware.ts.
 *
 * CREDENCIALES: se aceptan dos convenciones de nombre, ver readRedisConfig().
 * En producción manda `KV_REST_API_URL` / `KV_REST_API_TOKEN`, que es lo que
 * inyecta la integración de Upstash del Marketplace de Vercel. Nunca uses
 * `KV_REST_API_READ_ONLY_TOKEN`: el limiter escribe contadores.
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

// Warn-once en no-producción para no inundar los logs de desarrollo.
let warnedUnconfigured = false

// Warn-once para la cuota agotada: si no, cada request del mes escribiría una
// línea de error idéntica y el log dejaría de servir para nada.
let warnedQuota = false

/**
 * ¿El error de Upstash es "se acabó la cuota del plan" y no "Redis se cayó"?
 *
 * Upstash contesta a la API REST con 429 y un mensaje del tipo
 * "ERR max daily request limit exceeded" / "max requests limit exceeded" cuando
 * se agota el cupo del plan. Es un estado PERMANENTE hasta que se sube el plan
 * o corta el ciclo, a diferencia de un timeout, que se resuelve solo.
 *
 * Se inspecciona el texto porque @upstash/redis lanza un Error plano, sin
 * código estructurado que consultar.
 */
export function isQuotaExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /limit exceeded|exceeded your .*(quota|limit)|quota exceeded|max requests/i.test(msg)
}

/**
 * ¿Estamos en produccion DE VERDAD?
 *
 * `NODE_ENV` vale 'production' en CUALQUIER build de Next, incluidos los deploys
 * de preview. Confiar en el solo costo tiempo real: las credenciales de Upstash
 * estan definidas unicamente en el entorno Production de Vercel, asi que cada
 * deploy de preview escribia "no configurado en producción" y el log acusaba a
 * produccion de un problema que solo existia en preview. Un aviso que miente
 * sobre donde pasa la cosa es peor que no tenerlo: manda a revisar el sitio sano.
 *
 * En Vercel manda `VERCEL_ENV` ('production' | 'preview' | 'development'), que
 * es el unico que distingue las tres. Fuera de Vercel esa variable no existe y
 * se cae a `NODE_ENV`, para no aflojar el fail-closed en un self-host.
 */
function esProduccion(): boolean {
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv) return vercelEnv === 'production'
  return process.env.NODE_ENV === 'production'
}

/**
 * Respuesta 429 "bloqueado" que los callers esperan (mismo shape que cuando se
 * excede el límite real). Se usa para fail-closed en producción.
 */
function blockedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': '0',
        'X-RateLimit-Remaining': '0',
        'Retry-After': '60',
      },
    }
  )
}

/**
 * Resuelve las credenciales de Redis aceptando DOS convenciones de nombre:
 *
 *  - `KV_REST_API_URL` / `KV_REST_API_TOKEN`: los que inyecta SOLO la
 *    integracion de Upstash del Marketplace de Vercel. Es la fuente real en
 *    produccion, asi que va primero.
 *  - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: los nombres nativos
 *    de Upstash, utiles para `.env.local` y para cualquier deploy que no pase
 *    por el Marketplace.
 *
 * OJO con el token: la integracion tambien inyecta `KV_REST_API_READ_ONLY_TOKEN`
 * y ese NO sirve aqui. El rate limiter ESCRIBE (incrementa contadores), asi que
 * con el token de solo lectura cada request lanzaria y en produccion caeriamos
 * al fail-closed: 429 para toda la app. Nunca leerlo desde este modulo.
 *
 * Devuelve null si falta cualquiera de las dos piezas.
 */
function readRedisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url, token }
}

function getRedis(): Redis {
  if (!redis) {
    const config = readRedisConfig()
    if (!config) {
      // No deberia pasar: applyRateLimit ya corta antes si falta config. Se
      // lanza en vez de construir un cliente invalido para que el error se vea
      // en el catch de applyRateLimit y no como un 401 silencioso de Upstash.
      throw new Error('[rate-limit] Redis no configurado (URL/TOKEN ausentes)')
    }
    redis = new Redis({ url: config.url, token: config.token })
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
  // Redis no configurado. Esto es un estado de infra en TIEMPO DE DEPLOY (las
  // vars nunca se setearon), NO un ataque en curso: fallar CERRADO aqui deja
  // TODA la app inutilizable (auth, invitaciones, join -> 429 "Demasiadas
  // solicitudes"). Por eso se falla ABIERTO (permisivo) y se grita fuerte en los
  // logs para que se provisione Upstash. Los endpoints ya estan protegidos por
  // Google OAuth + allowlist de dominios, asi que la superficie de abuso se
  // limita a miembros ya autenticados de la org. El fallo en TIEMPO DE EJECUCION
  // (Redis configurado pero caido) SI se sigue tratando como fail-closed abajo.
  if (!readRedisConfig()) {
    if (esProduccion() && !warnedUnconfigured) {
      warnedUnconfigured = true
      console.error(
        '[rate-limit] KV_REST_API_URL/TOKEN (o UPSTASH_REDIS_REST_*) no configurado en producción. ' +
          'Rate limiting DESHABILITADO (fail-open) para no bloquear auth/invitaciones. ' +
          'Provisiona Upstash Redis y setea las vars para restaurar la protección.'
      )
    } else if (!warnedUnconfigured) {
      warnedUnconfigured = true
      // Preview y desarrollo. Se nombra el entorno para que el log no vuelva a
      // acusar a produccion de algo que pasa en una rama.
      console.warn(
        `[rate-limit] Redis no configurado; rate limiting DESHABILITADO (entorno: ${process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'desconocido'}).`
      )
    }
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
  } catch (err) {
    // Se acabó la CUOTA del plan de Upstash (no es que Redis se haya caído).
    // Distinguirlo importa muchísimo: el plan free son 500K comandos al mes y al
    // agotarse Upstash rechaza TODO. Si eso cayera en el fail-closed de abajo,
    // WLO entero devolvería 429 a todo el mundo por quedarnos sin cuota, que es
    // justo el peor momento para tumbar la app. Aquí se deja PASAR y se grita en
    // los logs: quedarse sin rate limit es peor que quedarse sin app.
    if (isQuotaExhausted(err)) {
      if (!warnedQuota) {
        warnedQuota = true
        console.error(
          '[rate-limit] CUOTA DE UPSTASH AGOTADA. Rate limiting deshabilitado (fail-open) ' +
            'para no tumbar la app. Sube el plan o espera al corte del ciclo:',
          err
        )
      }
      return null
    }

    // Redis lanzó por otra razón (timeout, red, credenciales inválidas). En
    // producción se falla CERRADO (429): sin Redis no hay garantía anti-abuso,
    // mejor rechazar que dejar la puerta abierta. Esto es un incidente acotado
    // en el tiempo, no un estado permanente como la cuota. En desarrollo se deja
    // pasar para no bloquear.
    if (esProduccion()) {
      console.error('[rate-limit] Redis error en producción, fallando CERRADO (429):', err)
      return blockedResponse()
    }
    console.warn('[rate-limit] Redis error en desarrollo, dejando pasar (fail open):', err)
    return null
  }
}
