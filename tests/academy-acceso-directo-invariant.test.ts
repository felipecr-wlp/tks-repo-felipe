/**
 * Tripwire: la barrera de acceso vive en la PAGINA del video, no solo en el
 * filtro de la galeria.
 *
 * Esconder una tarjeta no impide abrir el enlace directo, y los enlaces se
 * comparten por WhatsApp. Si alguien "simplifica" quitando este check, la
 * galeria seguiria viendose bien y "solo para foremen" pasaria a ser
 * decorativo, sin que nada truene.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGINA = join(
  process.cwd(), 'src', 'app', '(app)', 'w', '[workspaceSlug]',
  'academia', 'videos', '[videoId]', 'page.tsx',
)
const src = readFileSync(PAGINA, 'utf8')

describe('Invariante: el enlace directo a un video respeta la audiencia', () => {
  it('la pagina del video llama a puedeVer', () => {
    expect(src).toMatch(/puedeVer\(\s*video/)
  })

  it('y NIEGA cuando no puede ver (no solo lo registra)', () => {
    expect(src).toMatch(/if\s*\(!puedeVer\([\s\S]{0,80}?notFound\(\)/)
  })

  it('la galeria tambien filtra en el SERVIDOR', () => {
    const galeria = readFileSync(join(
      process.cwd(), 'src', 'app', '(app)', 'w', '[workspaceSlug]',
      'academia', 'videos', 'page.tsx',
    ), 'utf8')
    expect(galeria).toContain('filtrarVisibles')
  })
})
