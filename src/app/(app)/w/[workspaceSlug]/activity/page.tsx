/**
 * Bitácora de actividad del workspace (audit log).
 *
 * Server component: resuelve el workspace desde la membresía del usuario (igual
 * que la home) y trae el primer lote de activity_events ya renderizado, luego lo
 * pasa a ActivityFeed (cliente) que pagina con "Cargar más" contra
 * /api/workspaces/[workspaceId]/activity.
 *
 * A diferencia del bloque "Actividad" de la home (8 eventos), aquí se ve TODO el
 * historial del espacio: quién hizo qué y cuándo, en tareas, proyectos, notas y
 * pizarras.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ActivityFeed } from './ActivityFeed'
import type { WorkspaceActivityEvent } from '@/app/api/workspaces/[workspaceId]/activity/route'

const PAGE_SIZE = 40

export default async function WorkspaceActivityPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Workspace desde la membresía del usuario (anti-IDOR) ──────────────────
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // ── Primer lote (limit + 1 para saber si hay más) ─────────────────────────
  const { data } = await admin
    .from('activity_events')
    .select(`
      id,
      verb,
      object_type,
      object_id,
      object_title,
      created_at,
      subject:profiles ( id, display_name, avatar_url ),
      project:projects ( name, slug )
    `)
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .range(0, PAGE_SIZE) as { data: WorkspaceActivityEvent[] | null; error: unknown }

  const rows = data ?? []
  const hasMore = rows.length > PAGE_SIZE
  const events = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextOffset = hasMore ? PAGE_SIZE : null

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/w/${params.workspaceSlug}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver al inicio
        </Link>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Actividad del espacio
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {workspace.name} · historial de cambios en tareas, proyectos, notas y pizarras.
        </p>
      </div>

      <ActivityFeed
        workspaceId={workspace.id}
        initialEvents={events}
        initialNextOffset={nextOffset}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}
