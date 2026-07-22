/**
 * Tests de autorizacion sobre DELETE /api/projects/[projectId]/task-templates/[templateId].
 *
 * Barreras que se fijan (todas en admin client, bypass RLS):
 *  - UUID invalido de projectId o templateId -> 422.
 *  - Sin sesion -> 401.
 *  - No miembro del proyecto -> 403.
 *  - Anti-IDOR: una plantilla que NO pertenece a este proyecto -> 404, aunque el
 *    templateId sea un UUID valido de otro proyecto (el select acota por project_id).
 *  - Miembro no creador y no manager -> 403.
 *  - Manager del proyecto -> borra (success).
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

const { DELETE } = await import('@/app/api/projects/[projectId]/task-templates/[templateId]/route')

const PROJECT = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'
const TEMPLATE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function req() {
  return new NextRequest('http://localhost/api/projects/x/task-templates/y', { method: 'DELETE' })
}

beforeEach(() => {
  state.user = null
  state.adminResults = []
})

describe('DELETE task-templates/[templateId]', () => {
  it('UUID invalido devuelve 422', async () => {
    const res = await DELETE(req(), { params: { projectId: 'malo', templateId: TEMPLATE } })
    expect(res.status).toBe(422)
  })

  it('sin usuario devuelve 401', async () => {
    state.user = null
    const res = await DELETE(req(), { params: { projectId: PROJECT, templateId: TEMPLATE } })
    expect(res.status).toBe(401)
  })

  it('no miembro del proyecto devuelve 403', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [{ data: null, error: null }] // membership null
    const res = await DELETE(req(), { params: { projectId: PROJECT, templateId: TEMPLATE } })
    expect(res.status).toBe(403)
  })

  it('anti-IDOR: plantilla de otro proyecto devuelve 404', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { role: 'member' }, error: null }, // es miembro
      { data: null, error: null },               // plantilla no encontrada en ESTE proyecto
    ]
    const res = await DELETE(req(), { params: { projectId: PROJECT, templateId: TEMPLATE } })
    expect(res.status).toBe(404)
  })

  it('miembro no creador y no manager devuelve 403', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { role: 'member' }, error: null },
      { data: { id: TEMPLATE, created_by: 'otro-user' }, error: null },
    ]
    const res = await DELETE(req(), { params: { projectId: PROJECT, templateId: TEMPLATE } })
    expect(res.status).toBe(403)
  })

  it('manager del proyecto puede borrar', async () => {
    state.user = { id: 'user-1' }
    state.adminResults = [
      { data: { role: 'manager' }, error: null },
      { data: { id: TEMPLATE, created_by: 'otro-user' }, error: null },
      { data: null, error: null }, // delete ok
    ]
    const res = await DELETE(req(), { params: { projectId: PROJECT, templateId: TEMPLATE } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})
