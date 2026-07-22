/**
 * Regresion de escape de comodines LIKE en GET /api/tasks/search.
 * El buscador arma un patron ilike('title', `%<q>%`). Los caracteres % y _ son
 * comodines de LIKE; si el texto del usuario no se escapa, una busqueda como "%"
 * se vuelve sobre-amplia y un patron patologico ("%_%_%_...") puede forzar un
 * escaneo lento. La ruta debe escapar % y _ igual que search/route.ts y
 * projects/[projectId]/tasks/search. Este test captura el patron que llega a
 * .ilike() y fija ese contrato.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const state: { user: { id: string } | null; canAccess: boolean } = {
  user: null,
  canAccess: true,
}

// Captura del ultimo patron pasado a .ilike(col, pattern).
const captured: { col: string; pattern: string }[] = []

vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: async () => null }))
vi.mock('@/lib/team-access', () => ({ canAccessTeamById: async () => state.canAccess }))

// Builder encadenable minimo: cada metodo devuelve el mismo builder; .ilike
// registra sus argumentos; await sobre el builder resuelve a filas vacias.
function makeBuilder() {
  const b: Record<string, unknown> = {
    then(onF: (v: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(onF)
    },
  }
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b
  b.ilike = (col: string, pattern: string) => { captured.push({ col, pattern }); return b }
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({ from: () => makeBuilder() }),
}))

const { GET } = await import('@/app/api/tasks/search/route')

const TEAM = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

function req(q: string | null, teamId: string = TEAM) {
  const u = new URL('http://localhost/api/tasks/search')
  u.searchParams.set('team_id', teamId)
  if (q !== null) u.searchParams.set('q', q)
  return new NextRequest(u, { method: 'GET' })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.canAccess = true
  captured.length = 0
})

describe('GET tasks/search: escape de comodines LIKE', () => {
  it('escapa % y _ en el patron ilike', async () => {
    const res = await GET(req('a%b_c'))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toEqual({ col: 'title', pattern: '%a\\%b\\_c%' })
  })

  it('sin q no aplica ilike', async () => {
    const res = await GET(req(null))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(0)
  })

  it('sin sesion -> 401', async () => {
    state.user = null
    const res = await GET(req('x'))
    expect(res.status).toBe(401)
  })
})
