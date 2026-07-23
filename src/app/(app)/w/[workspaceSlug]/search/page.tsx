/**
 * Página de resultados de búsqueda global.
 * Lee `?q=` y muestra resultados agrupados (Tareas, Proyectos, Notas, Equipos,
 * Personas) con conteos, estado vacío y un filtro por tipo.
 *
 * El servidor resuelve el workspace (igual que el resto de páginas del árbol) y
 * delega el fetch + interacción al cliente, que consume /api/search?full=1
 * (mismo endpoint con visibilidad de espacios restringidos preservada).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SearchResults } from './SearchResults'

interface SearchPageProps {
  params: { workspaceSlug: string }
  searchParams: { q?: string; type?: string }
}

export default async function SearchPage({ params, searchParams }: SearchPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace desde membership (anti-RLS-loop), igual que my-tasks.
  type WsFromMember = { workspaces: { id: string; name: string; slug: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name, slug )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  const q = (searchParams.q ?? '').trim()
  const type = searchParams.type ?? 'all'

  return (
    <SearchResults
      workspaceSlug={workspace.slug}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      initialQuery={q}
      initialType={type}
    />
  )
}
