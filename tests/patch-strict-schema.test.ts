/**
 * Regresion de mass-assignment: los PATCH endurecidos usan zod .strict(), asi que
 * una clave fuera de la lista blanca en el body (intento de escribir columnas
 * server-derived como workspace_id, created_by, org_id, is_archived ajeno, etc.)
 * debe cortar con 422 ANTES de tocar la DB. Este archivo fija ese contrato para
 * que un futuro cambio de schema a modo laxo no reabra el hueco en silencio.
 *
 * Todo corre sobre el admin client (bypass RLS); la validacion es la primera
 * barrera. En projects/teams/tasks/whiteboards el parse ocurre antes de cualquier
 * query, asi que basta con user autenticado. En workspaces/spaces la barrera de
 * admin corre antes del parse, por eso se mockea isWorkspaceAdminById.
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

// workspaces y spaces resuelven el acceso con este helper ANTES de validar el
// body; se fuerza a "admin" para llegar a la barrera del schema .strict().
vi.mock('@/lib/workspace-admin', () => ({
  isWorkspaceAdminById: async () => ({ isAdmin: true, userId: 'user-1', role: 'admin' }),
}))

const { PATCH: patchProject }    = await import('@/app/api/projects/[projectId]/route')
const { PATCH: patchTeam }       = await import('@/app/api/teams/[teamId]/route')
const { PATCH: patchTask }       = await import('@/app/api/tasks/[taskId]/route')
const { PATCH: patchWhiteboard } = await import('@/app/api/whiteboards/[whiteboardId]/route')
const { PATCH: patchWorkspace }  = await import('@/app/api/workspaces/[workspaceId]/route')
const { PATCH: patchSpace }      = await import('@/app/api/spaces/[spaceId]/route')

const ID = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.adminResults = []
})

describe('PATCH .strict() rechaza mass-assignment (422)', () => {
  it('projects/[projectId]: clave desconocida -> 422', async () => {
    const res = await patchProject(
      req({ name: 'Proyecto', workspace_id: 'ws-otra', is_archived: true }),
      { params: { projectId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('teams/[teamId]: clave desconocida -> 422', async () => {
    const res = await patchTeam(
      req({ name: 'Equipo', workspace_id: 'ws-otra' }),
      { params: { teamId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('tasks/[taskId]: clave desconocida -> 422', async () => {
    const res = await patchTask(
      req({ title: 'Tarea', created_by: 'user-otro', workspace_id: 'ws-otra' }),
      { params: { taskId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('whiteboards/[whiteboardId]: clave desconocida -> 422', async () => {
    const res = await patchWhiteboard(
      req({ title: 'Pizarra', created_by: 'user-otro' }),
      { params: { whiteboardId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('workspaces/[workspaceId]: clave desconocida -> 422', async () => {
    const res = await patchWorkspace(
      req({ name: 'WS', org_id: 'org-otra' }),
      { params: { workspaceId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('spaces/[spaceId]: clave desconocida -> 422', async () => {
    // spaceWorkspace() consulta el workspace del departamento antes del parse.
    state.adminResults = [{ data: { workspace_id: 'ws-1' }, error: null }]
    const res = await patchSpace(
      req({ name: 'Depto', workspace_id: 'ws-otra' }),
      { params: { spaceId: ID } },
    )
    expect(res.status).toBe(422)
  })
})
