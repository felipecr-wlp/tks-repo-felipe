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

/**
 * `cache` de React solo existe bajo la condicion de resolucion "react-server";
 * en el runtime de vitest el entry normal de react no lo exporta y sale
 * `TypeError: cache is not a function`. La ruta no lo usa directamente: le llega
 * por `@/lib/team-access` -> `@/lib/auth`, que envuelve `getCachedUser` en el.
 *
 * Este archivo dejo de coleccionar el dia que la ruta gano ese import, y ahi
 * esta lo peligroso: un suite que no ARRANCA no reporta cero fallos, no reporta
 * NADA. Los tres casos de abajo llevaban tiempo sin vigilar nada y el rojo se
 * leia como "otro test roto mas".
 *
 * Se sustituye SOLO la memoizacion, no la autorizacion: `cache(fn)` pasa a ser
 * `fn`, que es lo que hace de todos modos la primera vez que se llama.
 * `@/lib/team-access` y `@/lib/auth` siguen siendo los de verdad, que es justo
 * lo que estos tests tienen que ejercitar. Mockear `@/lib/auth` entero habria
 * sido mas corto y habria apagado la cadena que se quiere probar.
 */
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return { ...react, cache: (fn: unknown) => fn }
})

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
