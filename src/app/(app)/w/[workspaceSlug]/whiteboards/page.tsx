/**
 * /w/[slug]/whiteboards, lista de pizarras del workspace.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { timeAgo } from '@/lib/utils'
import { NewWhiteboardButton } from './NewWhiteboardButton'
import { getServerT } from '@/lib/i18n/server'

interface PageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Pizarras · WLO' }

interface BoardRow {
  id: string
  title: string
  visibility: string
  updated_at: string
  created_by: string | null
  author: { display_name: string | null } | null
}

export default async function WhiteboardsPage({ params }: PageProps) {
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

  // El filtro de privadas se hace en la consulta (antes del limit) para que el
  // tope de 100 aplique sobre filas ya visibles: una privada ajena nunca ocupa
  // un lugar. Se conservan las privadas propias y las de visibilidad nula.
  const { data: rawBoards } = await admin
    .from('whiteboards')
    .select(`
      id, title, visibility, updated_at, created_by,
      author:profiles ( display_name )
    `)
    .eq('workspace_id', workspace.id)
    .or(`visibility.neq.private,visibility.is.null,created_by.eq.${user.id}`)
    .order('updated_at', { ascending: false })
    .limit(100) as { data: BoardRow[] | null; error: unknown }

  const boards = rawBoards ?? []
  const t = getServerT()

  return (
    <div className="px-8 py-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t('wb.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('wb.subtitlePrefix')} {workspace.name}
          </p>
        </div>
        <NewWhiteboardButton workspaceId={workspace.id} workspaceSlug={params.workspaceSlug} />
      </div>

      {boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="14" rx="2" />
              <path d="M7 21h10M9 17v4M15 17v4" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">{t('wb.emptyTitle')}</h3>
          <p className="text-sm text-muted-foreground mb-5">
            {t('wb.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {boards.map(b => (
            <Link
              key={b.id}
              href={`/w/${params.workspaceSlug}/whiteboards/${b.id}`}
              className="group bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all flex flex-col min-h-[140px]"
            >
              <div className="flex items-start gap-2 mb-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="14" rx="2" />
                    <path d="M7 21h10M9 17v4M15 17v4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {b.title || t('search.untitled')}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {b.author?.display_name ?? t('act.user')}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-auto">
                {t('wb.updatedPrefix')} {timeAgo(b.updated_at)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
