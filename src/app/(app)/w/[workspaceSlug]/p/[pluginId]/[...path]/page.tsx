/**
 * Cargador generico de plugins.
 *
 * Es la pieza que permite que un modulo (Flows es el primer candidato) deje de
 * ser codigo nativo de WLO. En vez de vivir en `src/app/.../flows/`, el modulo
 * se publica en SU PROPIA URL, se registra esa URL en `connector_apps.base_url`
 * y se instala en el workspace con una fila de `connector_installs`. A partir de
 * ahi su autor lo actualiza desplegando lo suyo, sin que WLO tenga que
 * desplegar nada. Ese era el objetivo entero.
 *
 * ── Por que un iframe y no cargar su JavaScript aqui ───────────────────────
 * Bajar el codigo del plugin y ejecutarlo dentro de WLO seria ejecutar codigo
 * que no paso por revision, con la sesion del usuario a la mano. El iframe deja
 * ese codigo en el origen de su autor, donde el navegador ya sabe aislarlo.
 * `tests/marketplace-tools-invariant.test.ts` (arista D) explica el mismo punto
 * desde el otro lado: por eso tampoco hay descompresion de paquetes ni escritura
 * a disco, que ademas en Vercel es de solo lectura salvo /tmp.
 *
 * ── El orden de las comprobaciones no es casual ────────────────────────────
 * sesion -> membresia del workspace -> instalacion activa -> URL valida. Si la
 * membresia se comprobara despues de leer el install, un miembro de OTRO
 * workspace podria confirmar que aqui hay un plugin instalado con solo mirar si
 * la respuesta cambia. Se usa `notFound()` y no un 403 por lo mismo: quien no es
 * miembro no debe poder distinguir "no existe" de "existe y no te toca".
 *
 * Todas las lecturas van por el cliente admin, que se salta RLS, asi que la
 * puerta REAL es este archivo. Nada de esto es una formalidad.
 */
import { notFound, redirect } from 'next/navigation'
import { Puzzle } from 'lucide-react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { construirUrlDeEmbed } from '@/lib/plugins/embed'

interface PluginPageProps {
  params: { workspaceSlug: string; pluginId: string; path?: string[] }
}

export default async function PluginPage({ params }: PluginPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  type WsFromMember = { workspaces: { id: string; slug: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, slug )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) notFound()

  // Instalado Y habilitado. Deshabilitar un plugin tiene que apagarlo de
  // verdad, no solo esconder su enlace del menu.
  const { data: install } = await admin
    .from('connector_installs')
    .select('id')
    .eq('workspace_id', workspace.id)
    .eq('app_id', params.pluginId)
    .eq('enabled', true)
    .limit(1)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  if (!install) notFound()

  const { data: app } = await admin
    .from('connector_apps')
    .select('name, base_url')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: { name: string; base_url: string } | null; error: unknown }

  if (!app) notFound()

  const embed = construirUrlDeEmbed(app.base_url, {
    workspaceId: workspace.id,
    workspaceSlug: params.workspaceSlug,
    subPath: params.path?.join('/') ?? '',
  })

  // El plugin existe y esta instalado, pero su URL no sirve. Se dice cual es el
  // problema en vez de dejar un marco en blanco: el sintoma "no carga" sin
  // motivo es exactamente lo que hace que estas cosas se depuren a ciegas.
  if (!embed.ok) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <Puzzle className="h-10 w-10 opacity-20" />
        <p className="text-base font-semibold text-foreground">{app.name}</p>
        <p className="max-w-md text-sm">{embed.motivo}</p>
        <a
          href={`/w/${params.workspaceSlug}/settings/conectores`}
          className="mt-2 text-xs text-primary hover:underline"
        >
          Revisar la configuración de conectores
        </a>
      </div>
    )
  }

  // `sandbox` sin `allow-top-navigation`: un plugin no puede sacar al usuario de
  // WLO a otro sitio. `allow-same-origin` aqui es seguro SOLO porque
  // `construirUrlDeEmbed` ya rechazo que el plugin se sirva desde el propio
  // origen de WLO; si esa regla se cae, esta linea deja de proteger.
  return (
    <div className="h-full w-full">
      <iframe
        src={embed.url}
        title={app.name}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  )
}
