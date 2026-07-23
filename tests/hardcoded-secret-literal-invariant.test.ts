/**
 * Tripwire de SECRETO HARDCODEADO EN FUENTE (CWE-798 Use of Hard-coded Credentials).
 *
 * Un secreto pegado como literal en el codigo (una API key, un token, un JWT, una llave
 * privada) es una fuga permanente: queda en el repo, en el historial de git, y si el
 * archivo es de cliente viaja ademas al bundle del navegador. Rota una vez y sigue vivo
 * en la historia. La disciplina del repo es que TODO secreto se lee de
 * `process.env.*` server-side (ver .env.example) y NUNCA se escribe su valor en fuente.
 *
 * Hermano de dos tripwires vecinos con otra boca: `log-secret-leak` (secretos que salen
 * por consola) y `public-env-exposure` (secretos con prefijo NEXT_PUBLIC_ que van al
 * bundle). Este cubre el escalon anterior: el valor literal escrito a mano en `src`.
 *
 * Contrato, una arista dura:
 *   NINGUN archivo de `src/**` contiene un literal que calce con una firma de secreto de
 *   proveedor conocido, con material suficiente para ser real (no un placeholder corto):
 *     - JWT / Supabase key .......... eyJ + 20+ chars base64url
 *     - Google API key .............. AIza + 20+ chars
 *     - Google OAuth client secret .. GOCSPX- + cuerpo
 *     - OpenAI key .................. sk- + 20+ chars
 *     - AWS access key id ........... AKIA + 16 chars
 *     - Llave privada PEM ........... "BEGIN ... PRIVATE KEY"
 *   Un secreto real que se cuele en fuente cae aqui.
 *
 * Nota anti-falso-positivo: los placeholders de .env.example (`eyJ...`, `AIza...`) son
 * demasiado cortos para calzar el `{20,}`, y este escaneo solo mira `src` (no el env de
 * ejemplo). Las firmas de ESTE archivo son regex (`AIza[...`), no valores; no se auto-calzan.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 0 secretos literales en src. Un valor real hardcodeado cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSource(full, out)
    else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(SRC, '').replace(/\\/g, '/').replace(/^\//, '')

// Firmas de secreto de proveedor, con material suficiente para ser un valor real.
const SECRET_SIGNATURES: { name: string; re: RegExp }[] = [
  { name: 'JWT/Supabase key', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Google API key', re: /AIza[A-Za-z0-9_-]{20,}/ },
  { name: 'Google OAuth secret', re: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key id', re: /\bAKIA[A-Z0-9]{16}\b/ },
  { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
]

describe('Invariante: ningun secreto hardcodeado como literal vive en src (anti CWE-798)', () => {
  const files = walkSource(SRC)

  it('el scan encuentra fuentes en src (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  it('ningun archivo de src contiene un literal con firma de secreto de proveedor', () => {
    const offenders: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const sig of SECRET_SIGNATURES) {
          if (sig.re.test(line)) offenders.push(`${rel(file)}:${i + 1} -> ${sig.name}`)
        }
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})
