/**
 * Regresion de escalada de privilegios en la gestion de miembros del workspace.
 * PATCH /api/workspaces/[workspaceId]/members/[memberId] cambia el rol de un
 * miembro. Contratos que este test fija (todos cortan ANTES de tocar la DB, asi
 * que no necesitan primar el mock de resultados):
 *
 *  1) Sin sesion -> 401.
 *  2) Con sesion pero sin rol admin -> 403 (se requiere admin).
 *  3) Admin que NO es owner intentando asignar el rol "owner" -> 403. Sin esta
 *     barrera un admin podria promoverse a si mismo (o a otro) a owner: escalada
 *     de privilegios. Solo un owner puede otorgar owner.
 *
 * isWorkspaceAdminById se mockea para simular cada nivel de autoridad; es la
 * fuente de verdad de sesion+rol de la ruta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Estado mutable que el mock de isWorkspaceAdminById lee en cada test.
const state: {
  auth: { isAdmin: boolean; isOwner: boolean; userId: string; role: string } | null
} = { auth: null }

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: async () => null,
}))

vi.mock('@/lib/workspace-admin', () => ({
  isWorkspaceAdminById: async () => state.auth,
}))

// El admin client no debe llegar a usarse en estos casos (cortan antes), pero se
// mockea para que el import no reviente y para detectar si algun cambio futuro
// hiciera una query antes de la barrera.
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('no debe consultarse la DB antes de la barrera de autoridad')
  },
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}))

const { PATCH } = await import('@/app/api/workspaces/[workspaceId]/members/[memberId]/route')

const WS = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'
const MEMBER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  state.auth = null
})

describe('PATCH workspace member: barreras de autoridad y anti-escalada', () => {
  it('sin sesion -> 401', async () => {
    state.auth = null
    const res = await PATCH(req({ role: 'member' }), { params: { workspaceId: WS, memberId: MEMBER } })
    expect(res.status).toBe(401)
  })

  it('sin rol admin -> 403', async () => {
    state.auth = { isAdmin: false, isOwner: false, userId: 'user-1', role: 'member' }
    const res = await PATCH(req({ role: 'member' }), { params: { workspaceId: WS, memberId: MEMBER } })
    expect(res.status).toBe(403)
  })

  it('admin no-owner asignando "owner" -> 403 (anti-escalada)', async () => {
    state.auth = { isAdmin: true, isOwner: false, userId: 'user-1', role: 'admin' }
    const res = await PATCH(req({ role: 'owner' }), { params: { workspaceId: WS, memberId: MEMBER } })
    expect(res.status).toBe(403)
  })
})
