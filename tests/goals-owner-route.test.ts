/**
 * Tests de la barrera de responsable (owner_id) en PATCH /api/goals/[goalId].
 *
 * Regla: si se envia owner_id, ese profile DEBE ser miembro del workspace de la
 * meta. Sin la validacion se podia asignar como responsable a alguien de otra
 * org (dato roto en el join, fuga de nombre/avatar). Todo corre en admin client
 * (bypass RLS), la autorizacion se hace en el handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeSupabaseMock, type QueryResult } from './helpers/supabaseMock'

const state: {
  user: { id: string } | null
  adminResults: QueryResult[]
} = { user: null, adminResults: [] }

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => makeSupabaseMock({ user: state.user, results: [] }),
  createAdminClient: () => makeSupabaseMock({ user: state.user, results: state.adminResults }),
}))

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: async () => null,
}))

const { PATCH } = await import('@/app/api/goals/[goalId]/route')

const GOAL = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'
const OUTSIDER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/goals/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  state.user = null
  state.adminResults = []
})

describe('PATCH goals/[goalId] owner_id', () => {
  it('owner_id que no es miembro del workspace devuelve 422', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { workspace_id: 'ws-1' }, error: null },     // goalAccess: goal
      { data: { profile_id: 'user-1' }, error: null },     // goalAccess: user es miembro -> ok
      { data: null, error: null },                          // owner check: NO es miembro
    ]
    const res = await PATCH(req({ owner_id: OUTSIDER }), { params: { goalId: GOAL } })
    expect(res.status).toBe(422)
  })

  it('owner_id miembro del workspace se acepta', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { workspace_id: 'ws-1' }, error: null },     // goalAccess: goal
      { data: { profile_id: 'user-1' }, error: null },     // goalAccess: user es miembro -> ok
      { data: { profile_id: OUTSIDER }, error: null },     // owner check: SI es miembro
      { data: { id: GOAL, title: 'M', owner_id: OUTSIDER }, error: null }, // update
    ]
    const res = await PATCH(req({ owner_id: OUTSIDER }), { params: { goalId: GOAL } })
    expect(res.status).toBe(200)
  })
})
