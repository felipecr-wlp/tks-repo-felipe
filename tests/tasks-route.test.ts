/**
 * Tests 2, 3 y 4 sobre GET /api/tasks/[taskId].
 *  2. UUID invalido -> 422 antes de tocar la DB.
 *  3. Sin sesion (auth.getUser sin user) -> 401.
 *  4. Robustez de lectura: si el select de membresia devuelve
 *     { data: null, error } la ruta responde 500, NO 403.
 *
 * Se mockea @/lib/supabase/server para controlar auth y la cadena de queries.
 * @/lib/rate-limit se mockea por seguridad aunque GET no lo use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeSupabaseMock, type QueryResult } from './helpers/supabaseMock'

// Estado controlable por cada test antes de importar/llamar la ruta.
const state: {
  user: { id: string } | null
  clientResults: QueryResult[]
  adminResults: QueryResult[]
} = { user: null, clientResults: [], adminResults: [] }

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    makeSupabaseMock({ user: state.user, results: state.clientResults }),
  createAdminClient: () =>
    makeSupabaseMock({ user: state.user, results: state.adminResults }),
}))

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: async () => null,
}))

// Import dinamico DESPUES de registrar los mocks.
const { GET } = await import('@/app/api/tasks/[taskId]/route')

const VALID_UUID = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

function req() {
  return new NextRequest('http://localhost/api/tasks/x')
}

beforeEach(() => {
  state.user = null
  state.clientResults = []
  state.adminResults = []
})

describe('GET /api/tasks/[taskId]', () => {
  it('test 2: UUID invalido devuelve 422 antes de la DB', async () => {
    const res = await GET(req(), { params: { taskId: 'no-es-uuid' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'ID inválido' })
  })

  it('test 3: sin usuario autenticado devuelve 401', async () => {
    state.user = null // auth.getUser sin user
    const res = await GET(req(), { params: { taskId: VALID_UUID } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'No autenticado' })
  })

  it('test 4: error en lectura de membresia devuelve 500, no 403', async () => {
    state.user = { id: 'user-1' }
    // admin.from() se llama 2 veces: (1) tarea encontrada, (2) membresia con error.
    state.adminResults = [
      { data: { id: VALID_UUID, project_id: 'proj-1' }, error: null },
      { data: null, error: { code: '08006', message: 'db down' } },
    ]
    const res = await GET(req(), { params: { taskId: VALID_UUID } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Error al verificar acceso' })
  })
})
