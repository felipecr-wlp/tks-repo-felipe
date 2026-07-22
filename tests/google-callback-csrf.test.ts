/**
 * Regresion CSRF del callback de Google OAuth.
 * GET /api/google/callback recibe ?code y ?state de Google. El state DEBE
 * coincidir con la cookie httpOnly g_oauth_state que fijo /connect; si no, es una
 * peticion forjada (CSRF) y la ruta debe abortar ANTES de intercambiar el code por
 * tokens. Contratos que este test fija:
 *
 *  1) Sin cookie de state -> redirect a google=state_mismatch, sin canjear code.
 *  2) state que no coincide con la cookie -> igual.
 *  3) Google devuelve ?error=... -> redirect google=error, sin canjear code.
 *
 * getOAuthClient y createClient se mockean para LANZAR: si el canje de token o el
 * arranque de sesion se ejecutaran en estos caminos, el test revienta. Asi queda
 * probado que la barrera corta antes de cualquier trabajo con tokens/DB.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('googleapis', () => ({ google: {} }))

vi.mock('@/lib/google/client', () => ({
  getOAuthClient: () => { throw new Error('no debe canjear el code sin state valido') },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => { throw new Error('no debe arrancar sesion antes de validar state') },
  createAdminClient: () => { throw new Error('no debe tocar la DB antes de validar state') },
}))

const { GET } = await import('@/app/api/google/callback/route')

function req(query: Record<string, string>, cookie?: string) {
  const u = new URL('http://localhost/api/google/callback')
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return new NextRequest(u, { method: 'GET', headers })
}

describe('GET google/callback: barrera CSRF de state', () => {
  it('sin cookie de state -> state_mismatch, no canjea code', async () => {
    const res = await GET(req({ code: 'abc', state: 'attacker' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('google=state_mismatch')
  })

  it('state que no coincide con la cookie -> state_mismatch', async () => {
    const res = await GET(req({ code: 'abc', state: 'attacker' }, 'g_oauth_state=real-value'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('google=state_mismatch')
  })

  it('error de Google -> google=error, no canjea code', async () => {
    const res = await GET(req({ error: 'access_denied' }, 'g_oauth_state=real-value'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('google=error')
  })
})
