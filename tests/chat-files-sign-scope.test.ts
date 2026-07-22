/**
 * Regresion anti-IDOR de la firma de archivos de chat.
 * GET /api/teams/[teamId]/chat-files/sign?paths=<a>,<b>,... re-firma signed URLs
 * temporales para adjuntos del chat. Como el cliente manda los paths en la query,
 * la ruta DEBE filtrar cualquier path que no pertenezca al equipo del URL antes de
 * firmar. Contratos que este test fija:
 *
 *  1) Sin sesion -> 401.
 *  2) Path de OTRO equipo (prefijo team/<otro>/) -> se descarta; no se firma nada
 *     y la ruta corta ANTES de tocar el storage (files: []). Sin esta barrera un
 *     miembro de un equipo podria firmar adjuntos de cualquier otro: IDOR.
 *  3) Path con traversal ".." -> se descarta igual.
 *  4) Path del equipo correcto pero SIN acceso (canAccessTeamById false) -> 403,
 *     antes de firmar.
 *
 * El stub de createAdminClient lanza al intentar firmar, asi que si algun cambio
 * futuro firmara un path filtrado o no autorizado, el test revienta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const state: {
  user: { id: string } | null
  canAccess: boolean
} = { user: null, canAccess: true }

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: async () => null,
}))

vi.mock('@/lib/team-access', () => ({
  canAccessTeamById: async () => state.canAccess,
}))

vi.mock('@/lib/chat-files', () => ({
  CHAT_FILES_BUCKET: 'chat-files',
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  // Firmar es la unica operacion; si se intenta sobre un path filtrado o sin
  // acceso, el test debe fallar.
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          throw new Error('no debe firmarse un path filtrado o no autorizado')
        },
      }),
    },
  }),
}))

const { GET } = await import('@/app/api/teams/[teamId]/chat-files/sign/route')

const TEAM = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'
const OTHER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function req(paths: string) {
  const u = new URL('http://localhost/api/x')
  u.searchParams.set('paths', paths)
  return new NextRequest(u, { method: 'GET' })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.canAccess = true
})

describe('GET chat-files/sign: barrera anti-IDOR de paths', () => {
  it('sin sesion -> 401', async () => {
    state.user = null
    const res = await GET(req(`team/${TEAM}/a.png`), { params: { teamId: TEAM } })
    expect(res.status).toBe(401)
  })

  it('path de otro equipo -> se descarta, no se firma (files: [])', async () => {
    const res = await GET(req(`team/${OTHER}/secreto.pdf`), { params: { teamId: TEAM } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ files: [] })
  })

  it('path con traversal ".." -> se descarta (files: [])', async () => {
    const res = await GET(req(`team/${TEAM}/../../etc/passwd`), { params: { teamId: TEAM } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ files: [] })
  })

  it('path del equipo correcto pero sin acceso -> 403, antes de firmar', async () => {
    state.canAccess = false
    const res = await GET(req(`team/${TEAM}/a.png`), { params: { teamId: TEAM } })
    expect(res.status).toBe(403)
  })
})
