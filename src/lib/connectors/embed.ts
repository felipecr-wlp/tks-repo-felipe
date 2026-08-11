/**
 * Reglas de embebido de herramientas del marketplace.
 *
 * Una herramienta externa se pinta dentro de WLO en un iframe. Dos candados
 * distintos, y hacen falta LOS DOS:
 *
 *   1. El CSP (`frame-src`), que arma next.config.js con la misma lista de este
 *      archivo. Ese es el candado real: lo hace cumplir el navegador y no hay
 *      codigo de WLO que lo pueda saltar.
 *   2. Esta funcion, que se consulta antes de renderizar. Es el candado
 *      cortes: sin el, un origen no autorizado igual se bloquea, pero se ve como
 *      un recuadro en blanco sin explicacion y nadie entiende que paso.
 *
 * Por que la lista vive en un JSON y no en la base de datos: el CSP se calcula
 * al construir la app, asi que una fila nueva en `connector_apps` no puede
 * cambiarlo. Si el permiso viviera en la base, cualquiera que pueda escribir esa
 * tabla podria hacer que WLO corra una pagina ajena adentro de si misma. Que
 * agregar un origen sea un cambio de codigo revisado es el punto, no un estorbo.
 *
 * El sandbox del iframe se define aqui tambien para que no se escriba a mano en
 * cada pantalla, que es como termina relajandose sin que nadie lo note.
 */
import origenes from './embed-origins.json'

export const EMBED_ORIGINS: string[] = origenes.origins

/**
 * Sandbox de todo iframe de herramienta.
 *
 * Lo que SI se concede: correr scripts, navegar dentro del propio marco, abrir
 * dialogos y formularios. Es lo minimo para que una herramienta sirva de algo.
 *
 * Lo que NO se concede, y son las omisiones importantes:
 *   - `allow-same-origin`: sin el, el iframe queda en un origen opaco. No puede
 *     leer cookies ni localStorage de WLO, que es exactamente lo que separa
 *     "herramienta invitada" de "codigo con la sesion de quien la abrio".
 *   - `allow-top-navigation`: no puede sacar a nadie de WLO a otra pagina.
 *   - `allow-popups-to-escape-sandbox`: lo que abra hereda el encierro.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals'

/** Origen de una URL, o null si no es una URL https valida. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

/** true solo si el origen de esa URL esta en la allowlist del CSP. */
export function isEmbeddable(url: string): boolean {
  // El CSP es dinamico (middleware consulta la DB). Aqui solo validamos HTTPS.
  return originOf(url) !== null
}

/**
 * URL final del iframe: base de la app + la ruta que declaro, con el workspace
 * como parametro para que la herramienta sepa donde esta parada.
 *
 * Devuelve null si el origen no esta autorizado. Que la funcion que ARMA la URL
 * sea la misma que valida evita el error clasico de validar una cosa y renderizar
 * otra: aqui no hay dos strings que puedan separarse.
 */
export function buildEmbedUrl(
  baseUrl: string,
  embedPath: string | null,
  params: {
    workspaceId: string
    installId: string
    /** Info del usuario que abrio la herramienta. No es secreta: los miembros
     *  del workspace ya pueden verse entre ellos. Va en la URL para que la
     *  herramienta sepa quien la usa sin necesidad de token ni API. El userId
     *  es el profile_id: las herramientas que guardan contenido por usuario
     *  (flujos, documentos) necesitan una identidad estable para marcar al
     *  dueno, y el nombre por si solo se repite entre personas. */
    user?: { userId: string | null; name: string | null; email: string | null; role: string | null }
    /** Miembros del workspace para compartir. Se pasan aqui para que la
     *  herramienta no tenga que llamar a la API de conectores para algo que
     *  WLO ya sabe. La lista se trunca a 50 miembros. */
    members?: { id: string; name: string; role: string }[]
  },
): string | null {
  const origin = originOf(baseUrl)
  if (!origin) return null

  const path = embedPath && embedPath.startsWith('/') ? embedPath : `/${embedPath ?? ''}`
  const u = new URL(path, origin)
  // El origen manda sobre lo que diga embed_path: si alguien guarda ahi una URL
  // absoluta a otro dominio, `new URL(path, origin)` la respetaria. Se corta.
  if (u.origin !== origin) return null

  u.searchParams.set('workspace_id', params.workspaceId)
  u.searchParams.set('install_id', params.installId)

  if (params.user) {
    if (params.user.userId) u.searchParams.set('user_id', params.user.userId)
    if (params.user.name) u.searchParams.set('user_name', params.user.name)
    if (params.user.role) u.searchParams.set('user_role', params.user.role)
  }

  if (params.members && params.members.length > 0) {
    u.searchParams.set('members', JSON.stringify(params.members.slice(0, 50)))
  }

  return u.toString()
}
