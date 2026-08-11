/**
 * Host de una herramienta externa: la pinta dentro de WLO, encerrada.
 *
 * Tres candados, y hacen falta los tres porque cada uno cubre lo que el otro no:
 *
 *   1. Membresia del workspace. Sin ella no se llega ni a saber si la herramienta
 *      esta instalada.
 *   2. Instalada Y encendida en ESTE workspace. Que exista en el catalogo no
 *      alcanza: instalar es la decision de este workspace, no la de otro.
 *   3. Origen en la allowlist del CSP. Este es el unico que hace cumplir el
 *      navegador, y por eso es el que manda. Se comprueba tambien aqui para poder
 *      decir por que no carga, en vez de dejar un recuadro en blanco.
 *
 * El sandbox va sin `allow-same-origin` a proposito: el iframe queda en un origen
 * opaco y no puede leer cookies ni localStorage de WLO. Una herramienta invitada
 * no debe poder actuar con la sesion de quien la abrio. Esa sola palabra es la
 * diferencia entre embeber y entregar la cuenta.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { buildEmbedUrl, EMBED_SANDBOX, isEmbeddable } from '@/lib/connectors/embed'
import { ALL_SCOPES, scopeDef } from '@/lib/connectors/scopes'
import { analizarScope } from '@/lib/connectors/diagnostico'
import { ToolInfoButton } from './ToolInfoButton'

export const metadata = { title: 'Herramienta - WLO' }

export default async function AppEmbedPage({
  params,
}: {
  params: { workspaceSlug: string; appId: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) notFound()

  const admin = createAdminClient()

  const { data: app } = (await admin
    .from('connector_apps')
    .select('id, name, description, base_url, embed_path, kind, status, requested_scopes')
    .eq('id', params.appId)
    .maybeSingle()) as {
    data: {
      id: string; name: string; description: string | null; base_url: string
      embed_path: string | null; kind: string; status: string; requested_scopes: string[] | null
    } | null
  }

  if (!app || app.kind !== 'embed' || app.status === 'draft') notFound()

  const { data: install } = (await admin
    .from('connector_installs')
    .select('id, enabled, granted_scopes, token_prefix, token_expires_at')
    .eq('workspace_id', ctx.workspace.id)
    .eq('app_id', app.id)
    .maybeSingle()) as {
    data: {
      id: string; enabled: boolean; granted_scopes: string[] | null
      token_prefix: string | null; token_expires_at: string | null
    } | null
  }

  if (!install || !install.enabled) notFound()

  // Info del usuario actual y miembros del workspace para pasarselo a la
  // herramienta en la URL. Asi no necesita token ni API para saber quien la
  // abrio ni con quien compartir.
  const { data: profileRow } = (await admin
    .from('profiles')
    .select('display_name, email')
    .eq('id', ctx.userId)
    .maybeSingle()) as { data: { display_name: string | null; email: string | null } | null }

  const { data: membersData } = (await admin
    .from('workspace_members')
    .select('profile_id, role, profiles ( display_name, email )')
    .eq('workspace_id', ctx.workspace.id)
    .limit(50)) as {
    data: { profile_id: string; role: string; profiles: { display_name: string | null; email: string | null } | null }[] | null
  }

  const members = (membersData ?? []).map(m => ({
    id: m.profile_id,
    name: m.profiles?.display_name ?? m.profiles?.email ?? m.profile_id,
    role: m.role,
  }))

  const url = buildEmbedUrl(app.base_url, app.embed_path, {
    workspaceId: ctx.workspace.id,
    installId: install.id,
    user: {
      userId: ctx.userId,
      name: profileRow?.display_name ?? profileRow?.email ?? null,
      email: profileRow?.email ?? null,
      role: ctx.role,
    },
    members,
  })

  const embeddable = isEmbeddable(app.base_url)
  const scopes = (app.requested_scopes ?? []).filter(s => ALL_SCOPES.includes(s))
    .map(s => ({
      scope: s,
      label: scopeDef(s)?.label ?? s,
      risk: (scopeDef(s)?.risk ?? 'medio') as 'bajo' | 'medio' | 'alto',
      granted: (install.granted_scopes ?? []).includes(s),
    }))
  const pendingScopes = scopes.filter(s => !s.granted).map(s => s.scope)

  const toolInfo = {
    name: app.name,
    description: app.description,
    baseUrl: app.base_url,
    kind: app.kind,
    status: app.status,
    embedPath: app.embed_path,
    embeddable,
    installId: install.id,
    enabled: install.enabled,
    tokenPrefix: install.token_prefix,
    tokenExpires: install.token_expires_at,
    scopes,
    pendingScopes,
    requestedCount: app.requested_scopes?.length ?? 0,
    grantedCount: (install.granted_scopes ?? []).length,
    // Despliegue de cada permiso que pidio la herramienta, para que "Detalles"
    // pueda decir si detras hay un canal real y en que direccion.
    scopeAnalysis: scopes.map((s) => analizarScope(s.scope)).filter((a): a is NonNullable<typeof a> => a !== null),
    workspaceId: ctx.workspace.id,
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <Link
          href={`/w/${params.workspaceSlug}/marketplace`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Marketplace
        </Link>
        <span className="text-sm font-medium text-foreground">{app.name}</span>
        <div className="flex-1" />
        <ToolInfoButton tool={toolInfo} />
      </div>

      {url ? (
        <iframe
          src={url}
          title={app.name}
          sandbox={EMBED_SANDBOX}
          referrerPolicy="no-referrer"
          className="flex-1 w-full border-0"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-amber-500" />
            <h2 className="mt-3 text-sm font-semibold text-foreground">
              Esta herramienta no se puede abrir aqui dentro
            </h2>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Su dominio no esta en la lista de los que WLO puede mostrar por dentro. No es un fallo
              de la herramienta: agregar un dominio a esa lista es un cambio de codigo con revision,
              justamente para que una fila en la base de datos no pueda autorizarse sola a correr
              dentro de la app. Abrela en su propia pestana o pide que se agregue el dominio.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
