/**
 * Pagina de Calendario del workspace — vista mensual conectada a Google Calendar.
 *
 * El server solo valida sesion + membresia y detecta si el usuario ya tiene una
 * conexion de Google (para elegir entre la vista o el estado vacio con CTA).
 * Los eventos los pide el cliente a /api/calendar/events (nunca tocamos tokens
 * en el front).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CalendarView from './CalendarView'

interface CalendarPageProps {
  params: { workspaceSlug: string }
}

export default async function CalendarPage({ params }: CalendarPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Validar membresia al workspace (anti-IDOR por slug).
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  if (!row?.workspaces) redirect('/')

  // Detectar si ya hay conexion de Google (solo para el estado inicial de la UI).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conn } = await (admin as any)
    .from('google_connections')
    .select('email, scopes')
    .eq('profile_id', user.id)
    .maybeSingle()

  const hasCalendarScope = Boolean(
    conn?.scopes?.some((s: string) => s.includes('calendar')),
  )

  return (
    <CalendarView
      basePath={`/w/${params.workspaceSlug}/calendar`}
      initiallyConnected={hasCalendarScope}
      connectedEmail={conn?.email ?? null}
    />
  )
}
