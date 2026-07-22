/**
 * Test 5: POST /api/sprints/[sprintId]/close reporta bien el carry-over.
 * Dado un sprint con tareas en estado NO 'done' y otras 'done', la respuesta
 * debe traer carried = numero de incompletas y done = numero de completas.
 * Se mockea la cadena de Supabase completa (sin DB real).
 *
 * Orden de llamadas admin.from() en el camino feliz (carry_to = null):
 *   1) sprints select   -> sprint a cerrar
 *   2) team_members     -> membresia del usuario
 *   3) tasks select     -> lista de tareas del sprint (array)
 *   4) tasks update     -> mueve incompletas al backlog
 *   5) sprints update   -> cierra el sprint
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeSupabaseMock, type QueryResult } from './helpers/supabaseMock'

const state: { user: { id: string } | null; adminResults: QueryResult[] } = {
  user: null,
  adminResults: [],
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => makeSupabaseMock({ user: state.user, results: [] }),
  createAdminClient: () => makeSupabaseMock({ user: state.user, results: state.adminResults }),
}))

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: async () => null,
}))

const { POST } = await import('@/app/api/sprints/[sprintId]/close/route')

const SPRINT_UUID = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

function req(body?: unknown) {
  return new NextRequest('http://localhost/api/sprints/x/close', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  state.user = null
  state.adminResults = []
})

describe('POST /api/sprints/[sprintId]/close', () => {
  it('test 5: carried = incompletas y done = completas', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      // 1) sprint a cerrar
      { data: { id: SPRINT_UUID, team_id: 'team-1', status: 'active' }, error: null },
      // 2) membresia
      { data: { role: 'admin' }, error: null },
      // 3) tareas: 2 incompletas (todo / in_progress) + 3 done
      {
        data: [
          { id: 't1', status: { category: 'todo' } },
          { id: 't2', status: { category: 'in_progress' } },
          { id: 't3', status: { category: 'done' } },
          { id: 't4', status: { category: 'done' } },
          { id: 't5', status: { category: 'done' } },
        ],
        error: null,
      },
      // 4) update de reubicacion de incompletas
      { data: null, error: null },
      // 5) cierre del sprint
      { data: { id: SPRINT_UUID, name: 'Sprint 1', status: 'completed' }, error: null },
    ]

    const res = await POST(req({ carry_to: null }), { params: { sprintId: SPRINT_UUID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.carried).toBe(2)
    expect(json.done).toBe(3)
    expect(json.carry_to).toBeNull()
  })

  it('las canceladas NO se arrastran ni cuentan como done', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { id: SPRINT_UUID, team_id: 'team-1', status: 'active' }, error: null },
      { data: { role: 'admin' }, error: null },
      // 1 incompleta (todo) + 1 cancelada + 2 done. Solo la todo se arrastra.
      {
        data: [
          { id: 't1', status: { category: 'todo' } },
          { id: 't2', status: { category: 'cancelled' } },
          { id: 't3', status: { category: 'done' } },
          { id: 't4', status: { category: 'done' } },
        ],
        error: null,
      },
      { data: null, error: null }, // update de reubicacion
      { data: { id: SPRINT_UUID, name: 'Sprint 1', status: 'completed' }, error: null },
    ]

    const res = await POST(req({ carry_to: null }), { params: { sprintId: SPRINT_UUID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.carried).toBe(1) // solo la todo, la cancelada se queda
    expect(json.done).toBe(2)
  })

  it('guarda 422: sprintId invalido no toca la DB', async () => {
    const res = await POST(req({}), { params: { sprintId: 'no-uuid' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'ID inválido' })
  })
})
