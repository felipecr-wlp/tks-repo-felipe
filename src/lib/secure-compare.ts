/**
 * Comparacion de cadenas en TIEMPO CONSTANTE (anti timing side-channel, CWE-208
 * Observable Timing Discrepancy).
 *
 * El operador `===` / `!==` de JS corta en la PRIMERA diferencia (y antes compara
 * longitudes), asi que el tiempo de respuesta filtra cuantos caracteres del secreto
 * acerto el atacante. Sobre un secreto compartido (el Bearer del cron, el token de
 * state de OAuth) eso permite, en teoria, recuperarlo byte a byte midiendo latencia.
 *
 * `timingSafeEqual` de node compara en tiempo constante, pero EXIGE buffers del mismo
 * tamano (si difieren, lanza, y esa excepcion filtra la longitud). Por eso primero
 * llevamos ambos lados a un digest de longitud FIJA (SHA-256, 32 bytes): igualdad de
 * entrada da igualdad de digest, longitudes distintas ya no filtran nada, y la
 * comparacion final corre siempre sobre 32 bytes en tiempo constante.
 */
import { createHash, timingSafeEqual } from 'crypto'

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}
