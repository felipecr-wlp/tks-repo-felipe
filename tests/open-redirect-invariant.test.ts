/**
 * Tripwire de OPEN REDIRECT (redireccion abierta a un destino controlado por el
 * request).
 *
 * El tripwire anti-SSRF (no-server-fetch-invariant) cierra la salida HTTP cruda del
 * servidor. Este cierra el eje gemelo del lado navegador: un handler que hace
 * NextResponse.redirect a un destino DERIVADO del request (un ?next, un ?redirect,
 * una cookie de retorno) sin sanitizarlo permite que un atacante arme un link a
 * nuestro dominio que rebota a un host ajeno (phishing, robo de token de OAuth por
 * fuga del code/state en el Referer). El truco clasico no es solo "https://evil";
 * tambien "//evil.com" (protocolo relativo), "/\evil.com" (el navegador normaliza la
 * barra invertida a //) y, si se concatena crudo tras el origin, ".evil.com/x"
 * (subdominio de otro: `https://wlo.app` + `.evil.com` = host `wlo.app.evil.com`).
 *
 * La primitiva del proyecto que neutraliza todo esto es safeInternalPath(): exige
 * que el valor empiece por "/" y rechaza "//" y "/\\", devolviendo un fallback "/"
 * si no. Contrato: TODO route.ts que redirige a un destino tomado del request DEBE
 * pasar ese destino por safeInternalPath antes de construir la URL.
 *
 * Deteccion estructural: se descubre el conjunto de "redirectores" (route.ts que
 * llaman NextResponse.redirect) y se exige que sea EXACTAMENTE el registro de abajo.
 * Un redirector nuevo no registrado (o uno registrado que desaparece) rompe el test
 * y fuerza revision consciente. Cada redirector registrado debe contener su
 * primitiva de saneo.
 *
 * Registro archivo -> primitiva de saneo del destino:
 *   - auth/callback     -> safeInternalPath( (sanea el ?next del login)
 *   - google/callback   -> safeInternalPath( (sanea el next guardado en cookie)
 *   - google/connect    -> safeInternalPath( (sanea el ?next antes de guardarlo)
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 3 redirectores; los 3 sanean su destino con safeInternalPath; 0 open redirects.
 * Un handler nuevo que redirija a un destino del request debe sanearlo y registrarse
 * aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

// Un handler que redirige el navegador.
const REDIRECT_CALL = /NextResponse\.redirect\(/

// Registro: archivo (ruta relativa a src/app/api) -> primitiva de saneo del destino.
const REGISTRY: Record<string, RegExp> = {
  'auth/callback/route.ts':   /safeInternalPath\(/,
  'google/callback/route.ts': /safeInternalPath\(/,
  'google/connect/route.ts':  /safeInternalPath\(/,
}

describe('Invariante: ningun redirector construye su destino desde el request sin safeInternalPath', () => {
  const discovered: string[] = []
  const gaps: string[] = []

  for (const file of walkRoutes(API)) {
    const src = readFileSync(file, 'utf8')
    if (!REDIRECT_CALL.test(src)) continue
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    discovered.push(rel)
    const primitive = REGISTRY[rel]
    if (!primitive || !primitive.test(src)) gaps.push('/src/app/api/' + rel)
  }

  it('el conjunto de redirectores descubierto es exactamente el registrado (ni nuevos sin registrar ni entradas muertas)', () => {
    expect(discovered.sort()).toEqual(Object.keys(REGISTRY).sort())
  })

  it('todo redirector sanea su destino con safeInternalPath', () => {
    expect(gaps.sort()).toEqual([])
  })
})
