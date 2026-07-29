/**
 * /w/[slug]/notes, vista "home" del wiki.
 * El tree completo está en el sidebar (layout). Esta página muestra welcome + recientes.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { timeAgo } from '@/lib/utils'
import { NoteIcon } from '@/lib/note-icons'
import { coverTint } from '@/lib/note-cover'
import { getServerT } from '@/lib/i18n/server'
import { NotesActionsBar } from './NotesActionsBar'
import { loadNoteViewerContext, canViewNote, noteVisibilityPrefilter } from '@/lib/note-visibility'

interface NotesPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Wiki · WLO' }

interface RecentNote {
  id: string
  title: string
  icon: string | null
  cover: string | null
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

  // Recientes (top 6). Las privadas ajenas se descartan ya en la consulta y el
  // resto del modelo (departamento, proyecto, empresa) se remata en JS, asi que
  // se pide de mas: si se pidieran justo 6, las que se ocultan dejarian huecos.
  const { data: recent } = await admin
    .from('notes')
    .select(`
      id, title, icon, cover, updated_at, visibility, created_by, space_id, project_id,
      author:profiles ( display_name )
    `)
    .eq('workspace_id', workspace.id)
    .or(noteVisibilityPrefilter(user.id))
    .order('updated_at', { ascending: false })
    .limit(60) as {
      data:
        | (RecentNote & {
            visibility: string
            created_by: string | null
            space_id: string | null
            project_id: string | null
          })[]
        | null
      error: unknown
    }

  const noteCtx = await loadNoteViewerContext(admin, workspace.id, user.id)
  const visibleRecent = (recent ?? []).filter(n => canViewNote(noteCtx, n)).slice(0, 6)

  const hasNotes = visibleRecent.length > 0
  const t = getServerT()

  return (
    <div className="px-6 sm:px-10 lg:px-12 py-10 max-w-[980px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          {t('notesHome.wikiOf')} {workspace.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('notesHome.subtitle')}
        </p>
      </div>

      <div className="flex items-center gap-3 mb-8">
        <NotesActionsBar workspaceId={workspace.id} workspaceSlug={params.workspaceSlug} />
        {!hasNotes && (
          <p className="text-xs text-muted-foreground">
            {t('notesHome.emptyHintPrefix')} <strong>+</strong> {t('notesHome.emptyHintSuffix')}
          </p>
        )}
      </div>

      {hasNotes && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t('notesHome.recentActivity')}
          </h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {visibleRecent.map(n => (
              <Link
                key={n.id}
                href={`/w/${params.workspaceSlug}/notes/${n.id}`}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
              >
                {/* Mismo color que la portada del documento (derivado del id),
                    para que la lista y el detalle se lean como la misma nota.
                    Ver src/lib/note-cover.ts. */}
                <span
                  className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-neutral-700"
                  style={{ background: coverTint(n.id, n.cover) }}
                >
                  <NoteIcon icon={n.icon} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {n.title || t('search.untitled')}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {n.author?.display_name ?? t('act.user')} · {t('notesHome.updated')} {timeAgo(n.updated_at)}
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
          <h3 className="text-sm font-semibold text-foreground mb-1">{t('notesHome.emptyTitle')}</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {t('notesHome.emptyBody')}
          </p>
        </div>
      )}
    </div>
  )
}
