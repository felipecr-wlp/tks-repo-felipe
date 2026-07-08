/**
 * Generador de códigos de invitación para workspaces.
 * Usa el alfabeto URL-safe sin caracteres ambiguos (0/O, 1/I/l).
 */
import { randomBytes } from 'crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function generateInviteCode(length = 16): string {
  const bytes = randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return code
}
