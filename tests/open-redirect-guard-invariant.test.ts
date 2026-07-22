/**
 * Tripwire de OPEN REDIRECT (redireccion abierta a un destino controlado por el
 * usuario).
 *
 * Un handler que redirige (login, callback de OAuth) suele aceptar a donde volver
 * DESPUES de autenticar: `?next`, `?redirectTo`, o una cookie del flujo. Si ese
 * destino se usa CRUDO, un atacante manda a la victima a
 *   /auth/login?redirectTo=https://evil.com
 * y, tras el login legitimo, la app la rebota a evil.com: phishing con la barra de
 * URL "correcta", robo del code/token en la vuelta, etc. Los vectores tipicos que
 * un `${origin}${next}` ingenuo NO frena:
 *   - URL absoluta:        https://evil.com   (no empieza con '/')
 *   - protocol-relative:   //evil.com         (el navegador la resuelve a https://)
 *   - backslash-trick:     /\evil.com         (algunos navegadores la tratan como //)
 *
 * La defensa, centralizada en `safeInternalPath` (src/lib/validation.ts), acota
 * TODO destino del usuario a una ruta interna del mismo origen y cae a '/' si no lo
 * es. Su comportamiento (rechazo de absoluta / protocol-relative / backslash /
 * esquemas no http) esta clavado en validation.test.ts.
 *
 * Lo que ESTE test clava es el eslabon estructural que aquel no cubre: que TODO
 * handler que CONSUME un destino de redireccion del usuario lo pase por
 * `safeInternalPath`. Que la guarda exista no sirve si un callback nuevo se olvida
 * de llamarla; aqui un consumidor nuevo sin la guarda cae.
 *
 * Contrato: en TODO archivo de src, si el codigo lee un destino de redireccion
 * controlado por el usuario (searchParams `next`/`redirectTo`, la cookie
 * `g_oauth_next`, o `searchParams.redirectTo`), ese mismo archivo debe referenciar
 * `safeInternalPath(`.
 *
 * Determinista: solo lee fuentes, no monta rutas ni navegador.
 *
 * Hoy 3 consumidores (auth/callback, google/callback, auth/login) y los 3 pasan por
 * la guarda. Un consumidor nuevo sin guarda cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSrc(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

// Lee un destino de redireccion CONTROLADO POR EL USUARIO. Nota: usa `.get(` (LEER
// el parametro/cookie), no `.set(` (escribirlo): el middleware que ESCRIBE
// redirectTo para el login no consume ningun destino y queda fuera, correctamente.
const CONSUMES_REDIRECT_DEST =
  /\.get\(['"]next['"]\)|\.get\(['"]redirectTo['"]\)|\.get\(['"]g_oauth_next['"]\)|searchParams\.redirectTo\b/
const USES_GUARD = /safeInternalPath\(/

describe('Invariante: todo destino de redireccion del usuario pasa por safeInternalPath', () => {
  const files = walkSrc(SRC)
  const consumers: string[] = []
  const gaps: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!CONSUMES_REDIRECT_DEST.test(src)) continue
    const rel = file.replace(SRC, '').replace(/\\/g, '/')
    consumers.push(rel)
    if (!USES_GUARD.test(src)) gaps.push(rel)
  }

  it('el scan encuentra los consumidores de destino de redireccion (no esta vacio)', () => {
    expect(consumers.length).toBeGreaterThanOrEqual(3)
  })

  it('todo consumidor de un destino de redireccion referencia safeInternalPath', () => {
    expect(gaps.sort()).toEqual([])
  })
})
