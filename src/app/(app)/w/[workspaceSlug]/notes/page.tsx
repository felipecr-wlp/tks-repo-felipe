/**
 * /w/[slug]/notes, vista "home" del wiki.
 * El tree completo está en el sidebar (layout). Esta página muestra welcome + recientes.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { timeAgo } from '@/lib/utils'
import { NoteIcon } from '@/lib/note-icons'
import { NotesActionsBar } from './NotesActionsBar'

interface NotesPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Wiki · WLO' }

interface RecentNote {
  id: string
  title: string
  icon: string | null
  updated_at: string
  author: { display_name: string | null } | null
}

export default async function NotesPage({ params }: NotesPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

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

  // Recientes (top 6, sin privadas de otros). El filtro de privadas va en la
  // consulta (antes del limit), no en JS despues: si se filtrara despues, una
  // nota privada ajena entre las mas recientes gastaria un slot y podria
  // esconder una nota visible mas nueva del propio usuario.
  const { data: recent } = await admin
    .from('notes')
    .select(`
      id, title, icon, updated_at, visibility, created_by,
      author:profiles ( display_name )
    `)
    .eq('workspace_id', workspace.id)
    .or(`visibility.neq.private,visibility.is.null,created_by.eq.${user.id}`)
    .order('updated_at', { ascending: false })
    .limit(6) as { data: (RecentNote & { visibility: string; created_by: string | null })[] | null; error: unknown }

  const visibleRecent = recent ?? []

  const hasNotes = visibleRecent.length > 0

  return (
    <div className="px-8 py-10 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Wiki de {workspace.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Documentación, SOPs, ideas y todo lo que tu equipo necesita saber.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-8">
        <NotesActionsBar workspaceId={workspace.id} workspaceSlug={params.workspaceSlug} />
        {!hasNotes && (
          <p className="text-xs text-muted-foreground">
            o usa el <strong>+</strong> en el árbol a la izquierda para empezar.
          </p>
        )}
      </div>

      {hasNotes && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Actividad reciente
          </h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {visibleRecent.map(n => (
              <Link
                key={n.id}
                href={`/w/${params.workspaceSlug}/notes/${n.id}`}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
              >
                <NoteIcon icon={n.icon} size={16} className="flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {n.title || 'Sin título'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {n.author?.display_name ?? 'Usuario'} · actualizada {timeAgo(n.updated_at)}
                  </p>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-0 group-hover:opacity-100 text-muted-foreground transition-opacity">
                  <polyline points="5 3 9 7 5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!hasNotes && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Tu wiki está vacío</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Empieza con una plantilla, SOP, brief, minutas, decisión, wiki, o desde cero.
          </p>
        </div>
      )}
    </div>
  )
}
