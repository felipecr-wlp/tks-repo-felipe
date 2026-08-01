/**
 * POST /api/content/items/[itemId]/notes
 * Pide una correccion (o deja una nota) sobre una pieza.
 *
 * Pedir correcciones lo puede hacer cualquier miembro: la revision mejora cuando
 * mas ojos la miran, y una correccion no obliga a nadie, solo queda pendiente.
 * Lo que si es de mando es aprobar, y eso vive en la ruta de la pieza.
 *
 * ── Por que pedir una correccion regresa la pieza a revision ────────────────
 * Si se pudiera pedir una correccion sobre algo ya "aprobado" y el estado no se
 * moviera, la pieza saldria publicada con el error que alguien ya habia
 * señalado. El estado tiene que reflejar la realidad: si hay algo que corregir,
 * no esta aprobado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadItemAccess } from '@/lib/content/access'

/**
 * `author_id` no esta en el esquema a proposito: la autoria sale de la sesion.
 * Si se aceptara del body, cualquiera podria firmar una correccion con el nombre
 * de otro, y una correccion sin autor confiable no la atiende nadie.
 */
const notaSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  kind: z.enum(['correccion', 'nota']).default('correccion'),
})

export async function POST(request: NextRequest, { params }: { params: { itemId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.itemId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const acceso = await loadItemAccess(admin, params.itemId, user.id)
  if (!acceso || !acceso.isMember) {
    return NextResponse.json({ error: 'Contenido no encontrado' }, { status: 404 })
  }

  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = notaSchema.safeParse(crudo)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Escribe qué hay que corregir' }, { status: 422 })
  }
  const cuerpo = parsed.data.body
  const kind = parsed.data.kind

  const { data: note, error } = await admin
    .from('content_notes')
    .insert({ item_id: params.itemId, author_id: user.id, body: cuerpo, kind })
    .select('id, body, kind, resolved_at, created_at')
    .single()

  if (error || !note) {
    console.error('[content notes] insert error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la corrección' }, { status: 500 })
  }

  // Una correccion sobre algo ya aprobado lo devuelve a revision, con su firma
  // limpia. Una 'nota' no mueve nada: es contexto, no una peticion.
  let nuevoEstado: string | null = null
  if (kind === 'correccion' && acceso.status === 'aprobado') {
    const { error: upError } = await admin
      .from('content_items')
      .update({
        status: 'por_aprobar',
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.itemId)
    if (upError) console.error('[content notes] reopen error:', upError)
    else nuevoEstado = 'por_aprobar'
  }

  return NextResponse.json({ note, status: nuevoEstado }, { status: 201 })
}
