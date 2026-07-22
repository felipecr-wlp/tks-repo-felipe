/**
 * Tests de autorizacion sobre GET /api/cv/[profileId] (fix de seguridad S1).
 *
 * El CV interno se sirve con admin client (bypass RLS), asi que la unica barrera
 * es el codigo del handler. La invariante critica: solo se puede leer el CV de un
 * perfil de la MISMA org que el solicitante. Estos tests fijan esa barrera para
 * que nunca vuelva a filtrarse PII (email, historial) cross-org.
 *
 * Se mockea @/lib/supabase/server y @/lib/rate-limit. Todos los casos cubiertos
 * responden ANTES de llegar a la RPC de reputacion, asi que no hace falta mockearla.
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

const { GET } = await import('@/app/api/cv/[profileId]/route')

const VALID_UUID = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

function req() {
  return new NextRequest('http://localhost/api/cv/x')
}

beforeEach(() => {
  state.user = null
  state.adminResults = []
})

describe('GET /api/cv/[profileId]', () => {
  it('UUID invalido devuelve 422 antes de la DB', async () => {
    const res = await GET(req(), { params: { profileId: 'no-es-uuid' } })
    expect(res.status).toBe(422)
  })

  it('sin usuario autenticado devuelve 401', async () => {
    state.user = null
    const res = await GET(req(), { params: { profileId: VALID_UUID } })
    expect(res.status).toBe(401)
  })

  it('perfil objetivo de OTRA org devuelve 404 y no filtra el email', async () => {
    state.user = { id: 'user-1' }
    // (1) org del solicitante, (2) perfil objetivo de otra org.
    state.adminResults = [
      { data: { org_id: 'org-A' }, error: null },
      { data: { id: VALID_UUID, display_name: 'Ajeno', avatar_url: null, email: 'secreto@otra.org', org_role: 'member', org_id: 'org-B' }, error: null },
    ]
    const res = await GET(req(), { params: { profileId: VALID_UUID } })
    expect(res.status).toBe(404)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('secreto@otra.org')
  })

  it('si el solicitante no tiene org devuelve 404 (no puede resolver la barrera)', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { org_id: null }, error: null },
      { data: { id: VALID_UUID, display_name: 'X', avatar_url: null, email: 'x@x.org', org_role: 'member', org_id: 'org-A' }, error: null },
    ]
    const res = await GET(req(), { params: { profileId: VALID_UUID } })
    expect(res.status).toBe(404)
  })

  it('perfil inexistente devuelve 404', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { org_id: 'org-A' }, error: null },
      { data: null, error: null },
    ]
    const res = await GET(req(), { params: { profileId: VALID_UUID } })
    expect(res.status).toBe(404)
  })
})
