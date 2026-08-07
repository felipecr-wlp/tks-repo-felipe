import 'server-only'
import type { createAdminClient } from '@/lib/supabase/server'
import { ALL_SCOPES, scopeDef } from './scopes'
import { isEmbeddable, originOf } from './embed'

/**
 * Catalogo de herramientas externas visto DESDE un workspace.
 *
 * Existe como funcion y no como consulta suelta porque lo piden dos bocas: la
 * pantalla del marketplace (componente de servidor) y GET /api/connectors/apps.
 * Si cada una armara su propia consulta terminarian discrepando, y la discrepancia
 * seria justo en el campo que importa: cuales permisos figuran como concedidos.
 * Una pantalla que dice "concedido" y una API que dice que no es un bug de
 * seguridad disfrazado de detalle visual.
 */

type Admin = ReturnType<typeof createAdminClient>

export interface CatalogScope {
  scope: string
  label: string
  risk: 'bajo' | 'medio' | 'alto'
  granted: boolean
}

export interface CatalogApp {
  id: string
  name: string
  description: string | null
  icon: string | null
  kind: string
  status: string
  origin: string | null
  embeddable: boolean
  requested_scopes: CatalogScope[]
  install: {
    id: string
    enabled: boolean
    granted_scopes: string[]
    token_prefix: string | null
    token_expires_at: string | null
    pending_scopes: string[]
    manifest: Record<string, unknown> | null
  } | null
}

interface AppRow {
  id: string
  name: string
  description: string | null
  base_url: string
  icon: string | null
  kind: string
  status: string
  embed_path: string | null
  requested_scopes: string[] | null
}

interface InstallRow {
  id: string
  app_id: string
  enabled: boolean
  granted_scopes: string[] | null
  token_prefix: string | null
  token_expires_at: string | null
  manifest: Record<string, unknown> | null
}

/**
 * La misma tabla vista desde la REVISION, que es el angulo contrario al del
 * catalogo: aqui SI entran los borradores, porque revisar es justamente mirar lo
 * que todavia no se lista en ningun lado.
 *
 * Trae de mas a proposito tres cosas que el catalogo no necesita y quien revisa
 * si: cuantos workspaces ya la instalaron (retirar algo instalado no es lo mismo
 * que retirar algo que nadie usa), si su origen esta en la allowlist del CSP (una
 * herramienta 'embed' fuera de la lista se aprueba igual y despues no carga, y
 * eso se descubre tarde), y que scopes pidio que no existen en el catalogo (se
 * ignoran en todos lados, asi que quien revisa creeria que concedio algo).
 */
export interface ReviewApp {
  id: string
  name: string
  description: string | null
  base_url: string
  origin: string | null
  icon: string | null
  kind: string
  status: string
  embed_path: string | null
  created_at: string
  requested_scopes: CatalogScope[]
  scopes_desconocidos: string[]
  embeddable: boolean
  instalaciones: number
  propuesta_por: string | null
}

interface ReviewRow extends AppRow {
  created_at: string
  owner_profile_id: string | null
}

export async function loadReviewQueue(admin: Admin): Promise<ReviewApp[]> {
  const { data: apps } = (await admin
    .from('connector_apps')
    .select('id, name, description, base_url, icon, kind, status, embed_path, requested_scopes, created_at, owner_profile_id')
    .order('created_at', { ascending: false })) as unknown as { data: ReviewRow[] | null }

  const filas = apps ?? []
  if (filas.length === 0) return []

  const ownerIds = [...new Set(filas.map((a) => a.owner_profile_id).filter((x): x is string => !!x))]

  const [{ data: installs }, { data: perfiles }] = await Promise.all([
    admin
      .from('connector_installs')
      .select('app_id') as unknown as Promise<{ data: { app_id: string }[] | null }>,
    ownerIds.length > 0
      ? (admin
          .from('profiles')
          .select('id, display_name')
          .in('id', ownerIds) as unknown as Promise<{ data: { id: string; display_name: string | null }[] | null }>)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ])

  const cuenta = new Map<string, number>()
  for (const i of installs ?? []) cuenta.set(i.app_id, (cuenta.get(i.app_id) ?? 0) + 1)
  const nombre = new Map((perfiles ?? []).map((p) => [p.id, p.display_name]))

  return filas.map((a) => {
    const pedidos = a.requested_scopes ?? []
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      base_url: a.base_url,
      origin: originOf(a.base_url),
      icon: a.icon,
      kind: a.kind,
      status: a.status,
      embed_path: a.embed_path,
      created_at: a.created_at,
      requested_scopes: pedidos
        .filter((s) => ALL_SCOPES.includes(s))
        .map((s) => ({
          scope: s,
          label: scopeDef(s)?.label ?? s,
          risk: scopeDef(s)?.risk ?? ('medio' as const),
          granted: false,
        })),
      scopes_desconocidos: pedidos.filter((s) => !ALL_SCOPES.includes(s)),
      embeddable: isEmbeddable(a.base_url),
      instalaciones: cuenta.get(a.id) ?? 0,
      propuesta_por: a.owner_profile_id ? (nombre.get(a.owner_profile_id) ?? null) : null,
    }
  })
}

export async function loadCatalog(admin: Admin, workspaceId: string): Promise<CatalogApp[]> {
  const [{ data: apps }, { data: installs }] = await Promise.all([
    admin
      .from('connector_apps')
      .select('id, name, description, base_url, icon, kind, status, embed_path, requested_scopes')
      // Un borrador no se lista: nadie reviso a donde apunta todavia.
      .neq('status', 'draft')
      .order('name') as unknown as Promise<{ data: AppRow[] | null }>,
    admin
      .from('connector_installs')
      .select('id, app_id, enabled, granted_scopes, token_prefix, token_expires_at, manifest')
      .eq('workspace_id', workspaceId) as unknown as Promise<{ data: InstallRow[] | null }>,
  ])

  const porApp = new Map((installs ?? []).map((i) => [i.app_id, i]))

  return (apps ?? []).map((a) => {
    const inst = porApp.get(a.id)
    // Un scope que ya no existe en el catalogo se cae de la lista. Si se mostrara,
    // la pantalla pediria aceptar algo que ninguna ruta va a reconocer despues.
    const pedidos = (a.requested_scopes ?? []).filter((s) => ALL_SCOPES.includes(s))
    const concedidos = inst?.granted_scopes ?? []

    return {
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      kind: a.kind,
      status: a.status,
      origin: originOf(a.base_url),
      // Que la fila diga 'embed' no basta: si su origen no esta en la allowlist
      // del CSP el navegador la deja en blanco. Se resuelve aqui para que la
      // pantalla no ofrezca abrir algo que no va a cargar.
      embeddable: a.kind === 'embed' && isEmbeddable(a.base_url),
      requested_scopes: pedidos.map((s) => ({
        scope: s,
        label: scopeDef(s)?.label ?? s,
        risk: scopeDef(s)?.risk ?? ('medio' as const),
        granted: concedidos.includes(s),
      })),
      install: inst
        ? {
            id: inst.id,
            enabled: inst.enabled,
            granted_scopes: concedidos,
            token_prefix: inst.token_prefix,
            token_expires_at: inst.token_expires_at,
            pending_scopes: pedidos.filter((s) => !concedidos.includes(s)),
            manifest: inst.manifest ?? null,
          }
        : null,
    }
  })
}
