/**
 * POST /api/workspaces/[workspaceId]/tools
 * Instala o desinstala una herramienta del marketplace en este workspace.
 *
 * Es el interruptor que pide el marketplace: `{ key, install }`. Escribe en
 * `workspaces.installed_features`, la allow-list POR WORKSPACE, al reves de
 * `workspace_members.hidden_features`, que es deny-list POR PERSONA (ver
 * src/lib/features.ts).
 *
 * Dos decisiones que no son de forma:
 *
 *   1. Solo admin del workspace. Instalar cambia lo que ve TODO el equipo, no
 *      solo quien aprieta el boton.
 *   2. Desinstalar NO borra datos. Apaga la pantalla y nada mas: el contenido
 *      sigue en su tabla y vuelve entero al reinstalar. Un interruptor que borra
 *      es una trampa, y nadie lee la advertencia.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { isInstallable, normalizeInstalled } from '@/lib/features'

/**
 * `key` se valida contra el catalogo de codigo (features.ts), no contra una
 * lista de texto libre: sin ese filtro se podria escribir cualquier cadena en
 * `installed_features` y la columna se volveria un basurero sin significado.
 */
const interruptorSchema = z.object({
  // Techo antes del refine: una clave del catalogo es corta, y sin `.max` una
  // cadena enorme se bufferiza entera nada mas para ser rechazada.
  key: z.string().max(40).refine(isInstallable, 'Esa herramienta no se puede instalar'),
  install: z.boolean().default(true),
})

export async function POST(request: NextRequest, { params }: { params: { workspaceId: string } }) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = interruptorSchema.safeParse(crudo)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Esa herramienta no se puede instalar' }, { status: 422 })
  }
  const { key, install } = parsed.data

  const admin = createAdminClient()

  const { data: ws } = (await admin
    .from('workspaces')
    .select('installed_features')
    .eq('id', params.workspaceId)
    .maybeSingle()) as { data: { installed_features: string[] | null } | null }

  if (!ws) return NextResponse.json({ error: 'Workspace no encontrado' }, { status: 404 })

  // Se normaliza ANTES de escribir: asi una clave vieja que quedo en la columna
  // (herramienta retirada del catalogo) se limpia sola en el primer cambio, en
  // vez de acumularse para siempre.
  const actuales = new Set<string>(normalizeInstalled(ws.installed_features))
  if (install) actuales.add(key)
  else actuales.delete(key)

  const installed = [...actuales]

  const { error } = await admin
    .from('workspaces')
    .update({ installed_features: installed })
    .eq('id', params.workspaceId)

  if (error) {
    console.error('[workspace tools] update error:', error)
    return NextResponse.json({ error: 'No se pudo cambiar la herramienta' }, { status: 500 })
  }

  return NextResponse.json({ installed })
}
