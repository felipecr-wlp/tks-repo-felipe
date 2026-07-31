import 'server-only'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Utilidades de tokens y firma para el contrato de conectores.
 *
 * Modelo de token (key de integracion):
 *   - Formato: `pck_live_<random>` (pck = pavific connector key). En dev `pck_test_`.
 *   - Se guarda SOLO el hash sha256 en connector_keys.token_hash. El texto plano se
 *     entrega una unica vez al crearlo y jamas se vuelve a poder leer.
 *   - El provider valida buscando por hash (lookup indexado, sin timing attack).
 *
 * Modelo de firma de webhooks:
 *   - HMAC-SHA256 sobre `${timestamp}.${rawBody}` con el secreto de la suscripcion.
 *   - Header X-Pavific-Signature: `sha256=<hex>`. Se rechaza si el timestamp tiene
 *     mas de 5 minutos (anti replay).
 */

const KEY_BYTES = 24
const WEBHOOK_TOLERANCE_SEC = 5 * 60

export function generateConnectorToken(env: 'live' | 'test' = 'live'): string {
  const random = randomBytes(KEY_BYTES).toString('base64url')
  return `pck_${env}_${random}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Prefijo legible para mostrar en el panel sin revelar el token completo. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 16)
}

/** Firma un payload de webhook. Devuelve { timestamp, signature } para los headers. */
export function signWebhook(
  secret: string,
  rawBody: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { timestamp: number; signature: string } {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return { timestamp, signature: `sha256=${mac}` }
}

/**
 * Verifica la firma de un webhook entrante en tiempo constante y con ventana de
 * tolerancia. Devuelve true solo si la firma coincide y el timestamp es reciente.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
): boolean {
  if (!signatureHeader || !timestampHeader) return false
  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SEC) return false

  const expected = signWebhook(secret, rawBody, ts).signature
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`
}
