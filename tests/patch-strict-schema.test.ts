/**
 * Regresion de mass-assignment: los PATCH endurecidos usan zod .strict(), asi que
 * una clave fuera de la lista blanca en el body (intento de escribir columnas
 * server-derived como workspace_id, created_by, org_id, is_archived ajeno, etc.)
 * debe cortar con 422 ANTES de tocar la DB. Este archivo fija ese contrato para
 * que un futuro cambio de schema a modo laxo no reabra el hueco en silencio.
 *
 * Todo corre sobre el admin client (bypass RLS); la validacion es la primera
 * barrera. En projects/teams/tasks/whiteboards, y en goals/sprints/time-entries/
 * charter/automations/checklist-items/notes, el parse ocurre antes de cualquier
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

// auth.ts y team-access.ts usan React cache() a nivel de modulo, que no existe
// en el entorno de vitest. Rutas como automations los importan (directa o
// transitivamente), asi que se mockean para que la coleccion no reviente al
// importar. El parse del body corre ANTES de estos guards, asi que el stub no
// altera lo que se prueba (el 422 por schema .strict()).
vi.mock('@/lib/auth', () => ({
  getCachedUser: async () => state.user,
}))

vi.mock('@/lib/team-access', () => ({
  canManageProject: async () => ({ ok: true }),
}))

const { PATCH: patchProject }    = await import('@/app/api/projects/[projectId]/route')
const { PATCH: patchTeam }       = await import('@/app/api/teams/[teamId]/route')
const { PATCH: patchTask }       = await import('@/app/api/tasks/[taskId]/route')
const { PATCH: patchWhiteboard } = await import('@/app/api/whiteboards/[whiteboardId]/route')
const { PATCH: patchWorkspace }  = await import('@/app/api/workspaces/[workspaceId]/route')
const { PATCH: patchSpace }      = await import('@/app/api/spaces/[spaceId]/route')
const { PATCH: patchGoal }       = await import('@/app/api/goals/[goalId]/route')
const { PATCH: patchSprint }     = await import('@/app/api/sprints/[sprintId]/route')
const { PATCH: patchTimeEntry }  = await import('@/app/api/time-entries/[entryId]/route')
const { PATCH: patchCharter }    = await import('@/app/api/projects/[projectId]/charter/route')
const { PATCH: patchAutomation } = await import('@/app/api/projects/[projectId]/automations/[automationId]/route')
const { PATCH: patchChecklistItem } = await import('@/app/api/tasks/[taskId]/checklist-items/[itemId]/route')
const { PATCH: patchNote }       = await import('@/app/api/notes/[noteId]/route')

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

  // ── Rutas spread-into-update fuera del set original (parse antes del acceso) ──
  it('goals/[goalId]: clave desconocida -> 422', async () => {
    const res = await patchGoal(
      req({ title: 'Meta', workspace_id: 'ws-otra' }),
      { params: { goalId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('sprints/[sprintId]: clave desconocida -> 422', async () => {
    const res = await patchSprint(
      req({ name: 'Sprint', team_id: 'team-otra' }),
      { params: { sprintId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('time-entries/[entryId]: clave desconocida -> 422', async () => {
    const res = await patchTimeEntry(
      req({ note: 'x', profile_id: 'user-otro' }),
      { params: { entryId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('projects/[projectId]/charter: clave desconocida -> 422', async () => {
    const res = await patchCharter(
      req({ scope: 'x', workspace_id: 'ws-otra' }),
      { params: { projectId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('automations/[automationId]: clave desconocida -> 422', async () => {
    const res = await patchAutomation(
      req({ name: 'Regla', project_id: 'proj-otra' }),
      { params: { projectId: ID, automationId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('tasks/[taskId]/checklist-items/[itemId]: clave desconocida -> 422', async () => {
    const res = await patchChecklistItem(
      req({ title: 'Item', task_id: 'task-otra' }),
      { params: { taskId: ID, itemId: ID } },
    )
    expect(res.status).toBe(422)
  })

  it('notes/[noteId]: clave desconocida -> 422', async () => {
    const res = await patchNote(
      req({ title: 'Nota', created_by: 'user-otro' }),
      { params: { noteId: ID } },
    )
    expect(res.status).toBe(422)
  })
})
