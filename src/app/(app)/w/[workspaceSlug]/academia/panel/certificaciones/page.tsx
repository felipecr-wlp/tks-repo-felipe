/**
 * Vista del supervisor: quien espera firma y a quien se le vence.
 *
 * Es la pantalla que contesta la pregunta del auditor ("¿quien lo tiene
 * VIGENTE hoy?") y la del jefe de cuadrilla ("¿a quien tengo que recertificar
 * este mes?"). Solo admin.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import type { Certificacion } from '@/lib/academy/certificacion'
import { VistaCertificaciones, type FilaCert } from './VistaCertificaciones'

interface PageProps {
  params: { workspaceSlug: string }
}

interface CertRow extends Certificacion {
  verified_note: string | null
  profiles: { display_name: string | null; email: string } | null
}

export default async function CertificacionesPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string } | null }
  const { data: ws } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }
  if (!ws?.workspaces) redirect('/')
  if (!(await isOrgAdmin(user.id))) notFound()

  const [{ data: certs }, { data: videos }, { data: avances }] = await Promise.all([
    admin
      .from('academy_certifications')
      .select('profile_id, item_type, item_id, acknowledged_at, verified_at, verified_by, verified_note, expires_at, profiles!academy_certifications_profile_id_fkey ( display_name, email )'),
    admin
      .from('academy_videos')
      .select('id, title, requires_ack, requires_verification, valid_months')
      .or('requires_ack.eq.true,requires_verification.eq.true'),
    admin
      .from('academy_video_progress')
      .select('profile_id, video_id, completed')
      .eq('completed', true),
  ])

  const porVideo = new Map((videos ?? []).map((v) => [v.id, v]))
  // Quien completo DE VERDAD cada video. Antes se asumia `visto: true` para
  // toda fila de certificacion, y eso miente en el caso que mas importa: un
  // supervisor puede firmar a alguien que nunca abrio el video (porque lo vio
  // trabajar en campo). Con el supuesto, la pantalla afirmaba que esa persona
  // habia visto el contenido, y el supervisor no tenia como saber a quien
  // faltaba mandarle la capacitacion.
  const completadoPor = new Set((avances ?? []).map((a) => `${a.profile_id}:${a.video_id}`))

  // Se cruza avance + certificacion para poder mostrar tambien a quien YA vio
  // el video y todavia no tiene fila: sin eso, la lista de "esperando firma"
  // solo tendria a quien ya dio su acuse, y el supervisor no veria llegar el
  // trabajo hasta que la persona actuara.
  const filas: FilaCert[] = []
  const yaListado = new Set<string>()

  for (const c of (certs ?? []) as unknown as CertRow[]) {
    if (c.item_type !== 'video') continue
    const v = porVideo.get(c.item_id)
    if (!v) continue
    yaListado.add(`${c.profile_id}:${c.item_id}`)
    filas.push({
      profileId: c.profile_id,
      nombre: c.profiles?.display_name?.trim() || c.profiles?.email || c.profile_id,
      itemId: c.item_id,
      titulo: v.title,
      requiereAcuse: v.requires_ack,
      requiereFirma: v.requires_verification,
      mesesVigencia: v.valid_months,
      acknowledgedAt: c.acknowledged_at,
      verifiedAt: c.verified_at,
      verifiedNote: c.verified_note,
      expiresAt: c.expires_at,
      visto: completadoPor.has(`${c.profile_id}:${c.item_id}`),
    })
  }

  // Quien vio un video con requisitos y aun no tiene fila de certificacion.
  const nombres = new Map<string, string>()
  const idsSinFila = (avances ?? [])
    .filter((a) => porVideo.has(a.video_id) && !yaListado.has(`${a.profile_id}:${a.video_id}`))
  if (idsSinFila.length > 0) {
    const { data: perfiles } = await admin
      .from('profiles')
      .select('id, display_name, email')
      .in('id', Array.from(new Set(idsSinFila.map((a) => a.profile_id))))
    for (const p of perfiles ?? []) {
      // El correo puede ser null en un perfil a medio crear: se cae al id
      // antes que dejar la fila sin nombre y que nadie sepa de quien habla.
      nombres.set(p.id, p.display_name?.trim() || p.email || p.id)
    }
  }
  for (const a of idsSinFila) {
    const v = porVideo.get(a.video_id)!
    filas.push({
      profileId: a.profile_id,
      nombre: nombres.get(a.profile_id) ?? a.profile_id,
      itemId: a.video_id,
      titulo: v.title,
      requiereAcuse: v.requires_ack,
      requiereFirma: v.requires_verification,
      mesesVigencia: v.valid_months,
      acknowledgedAt: null,
      verifiedAt: null,
      verifiedNote: null,
      expiresAt: null,
      visto: true,
    })
  }

  return (
    <VistaCertificaciones
      workspaceSlug={params.workspaceSlug}
      filas={filas}
      miId={user.id}
      // El "ahora" lo fija el SERVIDOR: con el reloj del navegador, mover la
      // fecha de la maquina cambiaria quien aparece como vencido.
      ahoraIso={new Date().toISOString()}
    />
  )
}
