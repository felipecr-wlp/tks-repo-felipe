/**
 * Password hashing usando PBKDF2 (Node crypto built-in).
 * Se usa para passwords opcionales de workspace_invites.
 *
 * Formato del hash almacenado: `salt:iterations:hash`
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto'

const ITERATIONS = 100_000
const KEYLEN = 64
const DIGEST = 'sha512'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex')
  return `${salt}:${ITERATIONS}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3) return false
  const [salt, iterStr, expectedHex] = parts
  const iterations = parseInt(iterStr, 10)
  if (!Number.isFinite(iterations) || iterations < 1) return false

  const computed = pbkdf2Sync(password, salt, iterations, KEYLEN, DIGEST)
  const expected = Buffer.from(expectedHex, 'hex')
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}
