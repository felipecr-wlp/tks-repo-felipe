/**
 * Regresion de fronteras cross-tenant (anti-IDOR). Los handlers corren sobre el
 * admin client (bypass RLS), asi que la separacion entre workspaces/orgs se
 * sostiene SOLO por checks explicitos en codigo. Estos tests fijan dos de esos
 * checks para que no se erosionen en un refactor:
 *
 *  1. POST /api/goals/[goalId]/tasks: una tarea de OTRO workspace no se puede
 *     enlazar a la meta (aunque la meta sea accesible). Debe responder 404.
 *  2. GET /api/search: buscar en un workspace del que no eres miembro responde
 *     403, no filtra contenido.
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

const { POST: linkGoalTask } = await import('@/app/api/goals/[goalId]/tasks/route')
const { GET: search }        = await import('@/app/api/search/route')

const GOAL = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'
const TASK = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const WS   = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.adminResults = []
})

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/goals/x/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST goals/[goalId]/tasks anti-IDOR cross-workspace', () => {
  it('tarea de otro workspace no se enlaza (404)', async () => {
    state.adminResults = [
      { data: { workspace_id: 'ws-1' }, error: null },        // goalWorkspace: goal -> ws-1
      { data: { profile_id: 'user-1' }, error: null },        // goalWorkspace: user es miembro
      { data: { id: TASK, title: 'T', status: null, project: { workspace_id: 'ws-2' } }, error: null }, // tarea vive en ws-2
    ]
    const res = await linkGoalTask(jsonReq({ task_id: TASK }), { params: { goalId: GOAL } })
    expect(res.status).toBe(404)
  })

  it('tarea del mismo workspace se enlaza (201)', async () => {
    state.adminResults = [
      { data: { workspace_id: 'ws-1' }, error: null },        // goalWorkspace: goal -> ws-1
      { data: { profile_id: 'user-1' }, error: null },        // goalWorkspace: user es miembro
      { data: { id: TASK, title: 'T', status: null, project: { workspace_id: 'ws-1' } }, error: null }, // misma ws
      { data: { id: 'link-1' }, error: null },                // upsert del enlace
    ]
    const res = await linkGoalTask(jsonReq({ task_id: TASK }), { params: { goalId: GOAL } })
    expect(res.status).toBe(201)
  })
})

describe('GET search membresia de workspace', () => {
  it('no miembro del workspace recibe 403', async () => {
    state.adminResults = [
      { data: null, error: null },  // workspace_members: sin membresia
    ]
    const req = new NextRequest(`http://localhost/api/search?q=hola&workspace_id=${WS}`)
    const res = await search(req)
    expect(res.status).toBe(403)
  })
})
