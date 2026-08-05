/**
 * Tests del PATCH de una actividad del reporte diario, en la parte que se puede
 * romper SIN QUE NADIE SE ENTERE.
 *
 * El handler nacio sabiendo hacer una sola cosa (cerrar un bloqueo) y ahora hace
 * dos (cerrar un bloqueo y guardar el detalle largo). Los tres fallos de abajo
 * comparten la misma forma: la pantalla se ve bien y el dato no llega.
 *
 *  1. La guarda "solo los bloqueos se resuelven" tiene que colgar de `resolved`,
 *     no de la ruta. Si vuelve a colgar de la ruta, guardar el detalle de un
 *     AVANCE muere con un 422 que habla de bloqueos: un mensaje que no tiene
 *     nada que ver con lo que la persona intentaba hacer, sobre la accion mas
 *     comun de la pantalla.
 *
 *  2. Un cuerpo vacio tiene que ser 422, no 200. Un 200 que no toco nada es el
 *     peor de los dos mundos: el cliente se queda creyendo que guardo. Es
 *     exactamente la clase de silencio que este repo persigue.
 *
 *  3. El detalle se sanea en el SERVIDOR y se devuelve ya saneado. El editor del
 *     cliente no es una barrera (cualquiera llama esta ruta con curl) y el HTML
 *     se pinta despues con dangerouslySetInnerHTML para el autor y para su
 *     mando. Ese es el camino entero de un stored XSS.
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

// El aviso de bloqueo resuelto manda notificaciones. Aqui no se prueba eso y
// dejarlo vivo mezclaria el fallo de una notificacion con el del guardado.
vi.mock('@/lib/daily-report-blockers', () => ({
  notifyBlockerResolved: async () => undefined,
}))

const { PATCH } = await import('@/app/api/daily-reports/entries/[entryId]/route')

const ENTRY = '3f1a9c2e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'
const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/daily-reports/entries/${ENTRY}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

/** La fila que devuelve el primer .from(): la actividad con su reporte. */
function entrada(category: string, resolvedAt: string | null = null): QueryResult {
  return {
    data: {
      id: ENTRY,
      category,
      content: 'Optimicé dos páginas',
      resolved_at: resolvedAt,
      report: {
        id: 'rep-1',
        profile_id: USER,
        workspace_id: 'ws-1',
        report_date: '2026-08-05',
      },
    },
    error: null,
  }
}

beforeEach(() => {
  state.user = null
  state.adminResults = []
})

describe('PATCH daily-reports/entries/[entryId]', () => {
  it('guarda el detalle de un AVANCE sin chocar con la guarda de bloqueos', async () => {
    state.user = { id: USER }
    state.adminResults = [entrada('avance'), { data: null, error: null }]

    const res = await PATCH(req({ details: '<p>Quedó en staging</p>' }), { params: { entryId: ENTRY } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.error).toBeUndefined()
    expect(body.details).toBe('<p>Quedó en staging</p>')
  })

  it('sigue rechazando `resolved` sobre algo que no es un bloqueo', async () => {
    state.user = { id: USER }
    state.adminResults = [entrada('avance'), { data: null, error: null }]

    const res = await PATCH(req({ resolved: true }), { params: { entryId: ENTRY } })

    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Solo los bloqueos se resuelven')
  })

  it('un cuerpo vacio es 422, nunca un 200 que no guardo nada', async () => {
    state.user = { id: USER }
    state.adminResults = [entrada('avance'), { data: null, error: null }]

    const res = await PATCH(req({}), { params: { entryId: ENTRY } })

    expect(res.status).toBe(422)
  })

  it('el detalle se sanea en el servidor y se devuelve ya saneado', async () => {
    state.user = { id: USER }
    state.adminResults = [entrada('avance'), { data: null, error: null }]

    const res = await PATCH(
      req({ details: '<p>Listo<script>alert(1)</script></p><img src=x onerror=alert(1)>' }),
      { params: { entryId: ENTRY } }
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.details).not.toContain('<script')
    expect(body.details).not.toContain('onerror')
    expect(body.details).toContain('Listo')
  })

  it('un detalle que solo son etiquetas vacias se guarda como null, no como detalle en blanco', async () => {
    state.user = { id: USER }
    state.adminResults = [entrada('avance'), { data: null, error: null }]

    const res = await PATCH(req({ details: '<p></p>' }), { params: { entryId: ENTRY } })

    expect(res.status).toBe(200)
    expect((await res.json()).details).toBeNull()
  })

  it('el detalle de un reporte ajeno es 403, aunque quien llame sea mando', async () => {
    state.user = { id: 'otra-persona' }
    state.adminResults = [entrada('avance'), { data: null, error: null }]

    const res = await PATCH(req({ details: '<p>corrijo tu día</p>' }), { params: { entryId: ENTRY } })

    expect(res.status).toBe(403)
  })
})
