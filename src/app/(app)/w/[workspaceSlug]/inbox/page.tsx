/**
 * Bandeja de notificaciones del workspace.
 * Muestra todas las notificaciones del usuario, agrupadas por estado (leído/no leído).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InboxList } from './InboxList'

interface InboxPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Bandeja · WLO' }

type NotificationRow = {
  id: string
  type: string
  object_type: string | null
  object_id: string | null
  object_title: string | null
  is_read: boolean
  created_at: string
  snoozed_until: string | null
  subject: { id: string; display_name: string; avatar_url: string | null } | null
}

export default async function InboxPage({ params }: InboxPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Workspace desde membership ────────────────────────────────────────────
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

  // ── Cargar notificaciones del usuario en este workspace ───────────────────
  // Se ocultan las pospuestas (snooze) cuya hora aun no llega: snoozed_until es
  // null (nunca pospuesta) o ya quedo en el pasado (reaparece sola, sin cron).
  const nowIso = new Date().toISOString()
  const { data: notifications, error: loadError } = await admin
    .from('notifications')
    .select(`
      id, type, object_type, object_id, object_title, is_read, created_at, snoozed_until,
      subject:profiles ( id, display_name, avatar_url )
    `)
    .eq('recipient_id', user.id)
    .eq('workspace_id', workspace.id)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(100) as { data: NotificationRow[] | null; error: unknown }

  return (
    <div className="px-8 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Bandeja</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tus notificaciones en {workspace.name}
        </p>
      </div>

      <InboxList
        initial={notifications ?? []}
        workspaceSlug={params.workspaceSlug}
        currentUserId={user.id}
        loadError={Boolean(loadError)}
      />
    </div>
  )
}
