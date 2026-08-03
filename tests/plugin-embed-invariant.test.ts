/**
 * Tripwire del cargador generico de plugins.
 *
 * Un plugin es codigo de otra persona pintado dentro del workspace. Lo unico que
 * lo mantiene encerrado son tres reglas de `construirUrlDeEmbed` y el atributo
 * `sandbox` del iframe. Ninguna de las dos cosas falla de forma visible cuando
 * se rompe: el plugin sigue cargando igual de bien, solo que ya sin jaula. Por
 * eso se fijan aqui, y por eso el ultimo bloque lee el page.tsx en crudo en vez
 * de confiar en que nadie va a armar la URL a mano mas adelante.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { construirUrlDeEmbed } from '@/lib/plugins/embed'

const WLO = 'https://wlo.vercel.app'
const DATOS = { workspaceId: 'ws-1', workspaceSlug: 'wlp', subPath: 'editor/42' }

const PAGE = join(
  process.cwd(),
  'src/app/(app)/w/[workspaceSlug]/p/[pluginId]/[...path]/page.tsx',
)

describe('construirUrlDeEmbed: que se puede montar', () => {
  it('acepta https de otro origen y pasa el workspace', () => {
    const r = construirUrlDeEmbed('https://flows.felipe.dev/app', DATOS, WLO)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const u = new URL(r.url)
    expect(u.origin).toBe('https://flows.felipe.dev')
    expect(u.searchParams.get('workspace_id')).toBe('ws-1')
    expect(u.searchParams.get('workspace_slug')).toBe('wlp')
    expect(u.searchParams.get('path')).toBe('editor/42')
  })

  it('rechaza http fuera de local: en la red se reescribe el plugin al vuelo', () => {
    const r = construirUrlDeEmbed('http://flows.felipe.dev', DATOS, WLO)
    expect(r.ok).toBe(false)
  })

  it('deja pasar http en localhost, que es el caso de desarrollo', () => {
    const r = construirUrlDeEmbed('http://localhost:5173', DATOS, WLO)
    expect(r.ok).toBe(true)
  })

  it('rechaza servir el plugin desde el propio WLO', () => {
    // Con el mismo origen, `allow-scripts` + `allow-same-origin` equivale a no
    // tener sandbox: el iframe puede leer el DOM del padre y actuar como el
    // usuario. Es el unico caso en que el sandbox miente.
    const r = construirUrlDeEmbed(`${WLO}/algo`, DATOS, WLO)
    expect(r.ok).toBe(false)
  })

  it('rechaza base_url vacia, que es lo que deja un registro a medias', () => {
    expect(construirUrlDeEmbed('', DATOS, WLO).ok).toBe(false)
    expect(construirUrlDeEmbed(null, DATOS, WLO).ok).toBe(false)
  })

  it('rechaza una URL que no se puede ni parsear', () => {
    expect(construirUrlDeEmbed('esto no es una url', DATOS, WLO).ok).toBe(false)
  })

  it('rechaza javascript: y data:, que no son navegacion sino ejecucion', () => {
    expect(construirUrlDeEmbed('javascript:alert(1)', DATOS, WLO).ok).toBe(false)
    expect(construirUrlDeEmbed('data:text/html,<script>1</script>', DATOS, WLO).ok).toBe(false)
  })

  it('conserva la query que ya traia el base_url', () => {
    // Pegando "?workspace_id=" con plantillas, un base_url con query propia
    // quedaba "?tenant=wlp?workspace_id=...": el segundo ? se vuelve parte del
    // valor y el plugin recibe un workspace inexistente.
    const r = construirUrlDeEmbed('https://flows.felipe.dev/app?tenant=wlp', DATOS, WLO)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const u = new URL(r.url)
    expect(u.searchParams.get('tenant')).toBe('wlp')
    expect(u.searchParams.get('workspace_id')).toBe('ws-1')
  })

  it('sin subPath manda path vacio, no "undefined"', () => {
    const r = construirUrlDeEmbed('https://flows.felipe.dev', {
      workspaceId: 'ws-1', workspaceSlug: 'wlp',
    }, WLO)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(new URL(r.url).searchParams.get('path')).toBe('')
  })
})

describe('el cargador obedece esas reglas', () => {
  const src = readFileSync(PAGE, 'utf8')

  it('arma el src del iframe con construirUrlDeEmbed, no a mano', () => {
    expect(src).toContain('construirUrlDeEmbed')
    expect(src).toContain('src={embed.url}')
    // Ningun `src={\`...\`}` con plantilla: eso se salta las tres reglas.
    expect(src).not.toMatch(/src=\{`/)
  })

  it('no monta el iframe si la URL fue rechazada', () => {
    expect(src).toMatch(/if\s*\(\s*!embed\.ok\s*\)/)
  })

  it('el sandbox no deja que el plugin saque al usuario de WLO', () => {
    const sandbox = src.match(/sandbox="([^"]*)"/)?.[1] ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-top-navigation')
  })

  it('comprueba membresia e instalacion habilitada antes de pintar nada', () => {
    expect(src).toContain('workspace_members')
    expect(src).toMatch(/\.eq\('enabled',\s*true\)/)
  })
})
