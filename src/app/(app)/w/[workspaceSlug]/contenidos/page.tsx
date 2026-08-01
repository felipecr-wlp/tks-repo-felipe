/**
 * Planificador de contenido: la galeria de lo que se va a publicar.
 *
 * Tres columnas y nada mas: por aprobar, aprobados, publicados. Lo que hoy vive
 * en un chat ("¿ya quedo esa imagen?", "cambiale el texto", "¿eso ya salio?")
 * aqui tiene un lugar donde se ve de un golpe.
 *
 * Server component. Resuelve el workspace por membresia (anti-RLS-loop), y sobre
 * todo decide QUE se firma:
 *
 *   - Solo la PORTADA de cada pieza, y solo su miniatura. Una galeria con 40
 *     piezas a 1MB serian 40MB por visita; con portadas de ~30KB son ~1.2MB.
 *   - Las demas imagenes y las versiones completas se piden al abrir la pieza
 *     (GET /api/content/items/[id]/assets). Lo que nadie abre, no se descarga.
 *
 * Las correcciones si viajan enteras: son texto, pesan nada, y tenerlas de
 * entrada es lo que permite mostrar "faltan 2 por atender" sin una segunda
 * vuelta al servidor.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { normalizeInstalled } from '@/lib/features'
import { isContentManager } from '@/lib/content/access'
import { CONTENT_ASSETS_BUCKET, type ContentStatus } from '@/lib/content/catalog'
import { ContenidosClient, type Pieza, type Correccion } from './ContenidosClient'

/** Vida de la firma de una portada. Alcanza para una jornada de trabajo. */
const THUMB_URL_TTL = 60 * 60 * 4

/** Techo de piezas en pantalla. Mas que esto no se revisa de un vistazo. */
const MAX_PIEZAS = 150

export const metadata = { title: 'Contenidos · WLO' }

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function ContenidosPage({ params }: PageProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  type WsFromMember = {
    workspaces: { id: string; name: string; installed_features: string[] | null } | null
  }
  const { data: row } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name, installed_features )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // Segundo candado, aparte del layout. El layout se apoya en el header
  // `x-pathname` que pone el middleware; si ese header faltara, la herramienta
  // sin instalar quedaria accesible por URL. Aqui no hay de donde agarrarse.
  const instaladas = normalizeInstalled(workspace.installed_features)
  if (!instaladas.includes('contenidos')) redirect(`/w/${params.workspaceSlug}`)

  const isManager = await isContentManager(admin, workspace.id, user.id)

  // ── Piezas ─────────────────────────────────────────────────────────────────
  type ItemRow = {
    id: string
    title: string
    caption: string | null
    network: string
    format: string | null
    status: ContentStatus
    rating: number | null
    scheduled_for: string | null
    published_at: string | null
    published_url: string | null
    created_by: string | null
    created_at: string
    autor: { id: string; display_name: string } | null
  }

  const { data: itemRows } = (await admin
    .from('content_items')
    .select(
      'id, title, caption, network, format, status, rating, scheduled_for, published_at, published_url, created_by, created_at, autor:profiles!content_items_created_by_fkey ( id, display_name )',
    )
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(MAX_PIEZAS)) as { data: ItemRow[] | null; error: unknown }

  const items = itemRows ?? []
  const ids = items.map((i) => i.id)

  // ── Portadas ───────────────────────────────────────────────────────────────
  // Se traen TODAS las filas de imagen (son cuatro columnas de texto, pesan
  // nada) para saber cuantas tiene cada pieza, pero solo se FIRMA la de posicion
  // mas baja: la portada. Firmar las demas aqui haria que el navegador se bajara
  // megabytes que casi nadie mira.
  type AssetRow = { item_id: string; thumb_path: string; width: number | null; height: number | null; position: number }
  const portadaPorItem = new Map<string, AssetRow>()
  const totalPorItem = new Map<string, number>()

  if (ids.length > 0) {
    const { data: assetRows } = (await admin
      .from('content_assets')
      .select('item_id, thumb_path, width, height, position')
      .in('item_id', ids)
      .order('position', { ascending: true })
      .limit(1500)) as { data: AssetRow[] | null; error: unknown }

    for (const a of assetRows ?? []) {
      totalPorItem.set(a.item_id, (totalPorItem.get(a.item_id) ?? 0) + 1)
      if (!portadaPorItem.has(a.item_id)) portadaPorItem.set(a.item_id, a)
    }
  }

  const portadas = [...portadaPorItem.values()]
  const urlPorRuta = new Map<string, string>()
  if (portadas.length > 0) {
    const { data: signed } = await admin.storage
      .from(CONTENT_ASSETS_BUCKET)
      .createSignedUrls(
        portadas.map((a) => a.thumb_path),
        THUMB_URL_TTL,
      )
    // Emparejado POR RUTA, nunca por indice: si una firma falla, emparejar por
    // posicion le pondria a una pieza la portada de otra.
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlPorRuta.set(s.path, s.signedUrl)
    }
  }

  // ── Correcciones ───────────────────────────────────────────────────────────
  type NoteRow = {
    id: string
    item_id: string
    body: string
    kind: string
    resolved_at: string | null
    created_at: string
    autor: { id: string; display_name: string } | null
  }
  const correccionesPorItem = new Map<string, Correccion[]>()

  if (ids.length > 0) {
    const { data: noteRows } = (await admin
      .from('content_notes')
      .select(
        'id, item_id, body, kind, resolved_at, created_at, autor:profiles!content_notes_author_id_fkey ( id, display_name )',
      )
      .in('item_id', ids)
      .order('created_at', { ascending: true })
      .limit(1000)) as { data: NoteRow[] | null; error: unknown }

    for (const n of noteRows ?? []) {
      const lista = correccionesPorItem.get(n.item_id) ?? []
      lista.push({
        id: n.id,
        body: n.body,
        kind: n.kind === 'nota' ? 'nota' : 'correccion',
        resolved_at: n.resolved_at,
        created_at: n.created_at,
        autor: n.autor?.display_name ?? 'Alguien',
      })
      correccionesPorItem.set(n.item_id, lista)
    }
  }

  const piezas: Pieza[] = items.map((i) => {
    const portada = portadaPorItem.get(i.id)
    return {
      id: i.id,
      title: i.title,
      caption: i.caption,
      network: i.network,
      format: i.format,
      status: i.status,
      rating: i.rating,
      scheduled_for: i.scheduled_for,
      published_at: i.published_at,
      published_url: i.published_url,
      autor: i.autor?.display_name ?? 'Alguien',
      puedeBorrar: i.created_by === user.id || isManager,
      cover_url: portada ? (urlPorRuta.get(portada.thumb_path) ?? null) : null,
      cover_w: portada?.width ?? null,
      cover_h: portada?.height ?? null,
      imagenes: totalPorItem.get(i.id) ?? 0,
      correcciones: correccionesPorItem.get(i.id) ?? [],
    }
  })

  return (
    <ContenidosClient
      workspaceId={workspace.id}
      isManager={isManager}
      piezasIniciales={piezas}
    />
  )
}
