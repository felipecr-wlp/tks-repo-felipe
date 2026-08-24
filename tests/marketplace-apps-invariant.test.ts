/**
 * Tripwire del MARKETPLACE DE HERRAMIENTAS EXTERNAS.
 *
 * Contexto de por que existe. El intento anterior de plugins era "sube tu codigo
 * y WLO lo sirve": imposible en Vercel (disco de solo lectura) y ademas la peor
 * clase de riesgo, porque obliga a WLO a ejecutar codigo ajeno en su proceso. El
 * modelo que quedo es el contrario: la herramienta vive en SU deploy y WLO solo
 * guarda a donde apunta, que permisos pidio y cuales se le concedieron.
 *
 * Ese modelo tiene exactamente cuatro puntos donde se puede aflojar sin que nadie
 * lo note, y cada uno tiene su capa aqui:
 *
 *   1. EMBEBIDO. El unico candado que un navegador obedece es el `frame-src` del
 *      CSP. Si la allowlist del codigo y la del CSP se separan, o el sandbox
 *      pierde una palabra, la herramienta pasa de invitada a duena de la sesion.
 *   2. CONCESION. Lo que la app PIDE y lo que el workspace CONCEDE son columnas
 *      distintas a proposito. Si se colapsan, publicar una version que pide mas
 *      se concede sola.
 *   3. REVISION. Un borrador no se instala. Si se pudiera, la revision entera se
 *      salta con una peticion a mano.
 *   4. TOKEN. Es de la instalacion, no de la persona, y en la base solo vive su
 *      hash.
 *
 * Determinista: ejecuta funciones puras y lee fuentes. No toca red ni base.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMBED_ORIGINS,
  EMBED_SANDBOX,
  buildEmbedUrl,
  isEmbeddable,
  originOf,
} from '@/lib/connectors/embed'
import { ALL_SCOPES, scopeDef } from '@/lib/connectors/scopes'

const raiz = process.cwd()
const leer = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8')

// El CSP ya no se arma al construir la app: el middleware consulta la base
// (connector_apps aprobadas) y refresca cada 60s, para que aprobar una
// herramienta no exija redeploy. La invariante vive ahi ahora.
const middleware = leer('src', 'middleware.ts')
const rutaInstalls = leer('src', 'app', 'api', 'connectors', 'installs', 'route.ts')
const rutaInstall1 = leer('src', 'app', 'api', 'connectors', 'installs', '[installId]', 'route.ts')
const rutaApps = leer('src', 'app', 'api', 'connectors', 'apps', 'route.ts')
const rutaRevision = leer('src', 'app', 'api', 'connectors', 'apps', '[appId]', 'route.ts')
const paginaEmbed = leer('src', 'app', '(app)', 'w', '[workspaceSlug]', 'apps', '[appId]', 'page.tsx')

// ── Capa 1: embebido ─────────────────────────────────────────────────────────

describe('Marketplace: solo se embebe lo que el CSP permite', () => {
  it('la allowlist solo tiene origenes https, sin ruta', () => {
    expect(EMBED_ORIGINS.length).toBeGreaterThan(0)
    for (const o of EMBED_ORIGINS) {
      expect(o).toMatch(/^https:\/\//)
      expect(new URL(o).origin).toBe(o)
    }
  })

  it('el frame-src del CSP se arma en el middleware desde la base, no a mano', () => {
    // Garantia vieja: next.config.js leia embed-origins.json al construir.
    // Ya no aplica: la lista vive en connector_apps y el middleware la consulta
    // con cache de 60s, asi que aprobar una herramienta actualiza el CSP sin
    // redeploy. Lo que no puede faltar es que ESA consulta filtre por aprobadas.
    expect(middleware).toContain("from('connector_apps')")
    expect(middleware).toContain(".eq('kind', 'embed')")
    expect(middleware).toMatch(/eq\('status', 'approved'\)/)
    expect(middleware).toMatch(/frame-src/)
  })

  it('isEmbeddable solo pre-valida HTTPS; el candado real es el CSP', () => {
    // La pertenencia a la lista ya no se comprueba aqui (el middleware la
    // resuelve desde la base en cada request, con cache). Esta funcion existe
    // para no intentar renderizar un iframe que el navegador va a bloquear,
    // y para rechazar lo que jamas podria pasar el CSP: http plano.
    expect(isEmbeddable('https://dominio-que-nadie-aprobo.example/tool')).toBe(true)
  })

  it('http no cuenta como origen valido', () => {
    expect(originOf('http://wli-marketing-os.vercel.app')).toBeNull()
    expect(isEmbeddable('http://wli-marketing-os.vercel.app')).toBe(false)
  })

  it('una ruta no puede sacar el iframe fuera del origen de la base', () => {
    // La pertenencia a la allowlist ya no vive aqui (la decide el CSP del
    // middleware). Lo que SI es invariante de esta funcion: ninguna ruta, ni
    // absoluta a otro dominio ni protocolo-relativa, cambia el origen final.
    const base = 'https://tool.ejemplo.test'
    // Absoluta a otro dominio: se trata como texto del path, queda en el origen.
    const u1 = buildEmbedUrl(base, 'https://evil.example.com/x', { workspaceId: 'w', installId: 'i' })
    expect(u1 && new URL(u1).origin).toBe(base)
    // Protocolo relativo: `new URL('//evil...', origin)` SI cambiaria de origen.
    const u2 = buildEmbedUrl(base, '//evil.example.com/x', { workspaceId: 'w', installId: 'i' })
    expect(u2).toBeNull()
  })

  it('el sandbox nunca concede same-origin ni navegacion del padre', () => {
    expect(EMBED_SANDBOX).not.toContain('allow-same-origin')
    expect(EMBED_SANDBOX).not.toContain('allow-top-navigation')
    expect(EMBED_SANDBOX).not.toContain('allow-popups-to-escape-sandbox')
    expect(EMBED_SANDBOX).toContain('allow-scripts')
  })

  it('la pagina del iframe usa la constante, no un sandbox escrito ahi', () => {
    expect(paginaEmbed).toContain('sandbox={EMBED_SANDBOX}')
    expect(paginaEmbed).not.toMatch(/sandbox="/)
  })

  it('la pagina del iframe exige membresia e instalacion encendida', () => {
    expect(paginaEmbed).toContain('getWorkspaceAdminContext')
    expect(paginaEmbed).toMatch(/!install\.enabled/)
    expect(paginaEmbed).toContain('buildEmbedUrl')
  })
})

// ── Capa 2: pedir no es conceder ─────────────────────────────────────────────

describe('Marketplace: nadie se concede permisos que no pidio', () => {
  it('instalar valida lo concedido contra lo que la app pidio', () => {
    expect(rutaInstalls).toContain('requested_scopes')
    expect(rutaInstalls).toMatch(/granted_scopes\.filter\(/)
    expect(rutaInstalls).toContain('no pidio')
  })

  it('aceptar permisos nuevos pasa por la misma validacion', () => {
    expect(rutaInstall1).toContain('requested_scopes')
    expect(rutaInstall1).toContain('no pidio')
  })

  it('instalar y cambiar permisos siguen exigiendo admin del workspace', () => {
    for (const fuente of [rutaInstalls, rutaInstall1]) {
      expect(fuente).toContain('isWorkspaceAdminById')
      expect(fuente).toContain('Solo admin')
    }
  })

  it('proponer una herramienta rechaza scopes que no existen', () => {
    expect(rutaApps).toContain('ALL_SCOPES')
    expect(rutaApps).toContain('Permisos desconocidos')
  })
})

// ── Capa 3: revision ─────────────────────────────────────────────────────────

describe('Marketplace: un borrador no se instala', () => {
  it('instalar exige que la app este aprobada', () => {
    expect(rutaInstalls).toMatch(/status !== 'approved'/)
  })

  it('el catalogo no lista borradores', () => {
    const catalogo = leer('src', 'lib', 'connectors', 'catalog.ts')
    expect(catalogo).toMatch(/neq\('status', 'draft'\)/)
  })

  it('aprobar es del mando de la organizacion, no de un admin de workspace', () => {
    expect(rutaRevision).toContain('org_role')
    expect(rutaRevision).not.toContain('isWorkspaceAdminById')
  })
})

// ── Capa 4: el token ─────────────────────────────────────────────────────────

describe('Marketplace: el token es de la instalacion y se guarda hasheado', () => {
  it('a la base va el hash, nunca el token', () => {
    expect(rutaInstalls).toContain('token_hash: tokenHasheado')
    expect(rutaInstalls).toContain('hashToken(token)')
    expect(rutaInstalls).not.toMatch(/token_plain|token:\s*token,/)
  })

  it('el token nace con fecha de muerte', () => {
    expect(rutaInstalls).toContain('token_expires_at')
    expect(rutaInstalls).toContain('TOKEN_DIAS')
  })

  it('el listado de instalaciones no devuelve el hash', () => {
    const select = rutaInstalls.match(/\.select\('id, app_id, manifest[^']*'\)/g) ?? []
    expect(select.length).toBeGreaterThan(0)
    for (const s of select) expect(s).not.toContain('token_hash')
  })
})

// ── Capa 5: scopes de flujos ─────────────────────────────────────────────────

describe('Marketplace: los permisos de flujos existen y estan graduados', () => {
  it('flows:read y flows:write estan en el catalogo', () => {
    expect(ALL_SCOPES).toContain('flows:read')
    expect(ALL_SCOPES).toContain('flows:write')
  })

  it('escribir flujos es riesgo alto', () => {
    expect(scopeDef('flows:write')?.risk).toBe('alto')
  })

  it('el catalogo declara que leer no alcanza lo privado', () => {
    const fuente = leer('src', 'lib', 'connectors', 'scopes.ts')
    expect(fuente).toContain('NUNCA alcanza un flujo privado')
  })
})
