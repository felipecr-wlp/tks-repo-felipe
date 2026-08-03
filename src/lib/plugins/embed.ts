/**
 * Construccion y validacion de la URL que se monta en el <iframe> de un plugin.
 *
 * ── Por que esto vive fuera del page.tsx ────────────────────────────────────
 * Un Server Component no se puede probar sin renderizar medio arbol. Las tres
 * reglas de abajo son de seguridad, no cosmeticas, asi que tienen que poder
 * romperse en un test unitario. Por eso la decision "monto o no monto" es una
 * funcion pura y el page.tsx solo la obedece.
 *
 * ── Las tres reglas, y de que agujero sale cada una ─────────────────────────
 *
 * (1) SOLO https (salvo localhost). Con http, cualquiera en la red del usuario
 *     reescribe el plugin al vuelo y lo que se pinta dentro del workspace ya no
 *     es lo que publico su autor.
 *
 * (2) NUNCA el mismo origen que WLO. Esta es la fina y la que mas duele si se
 *     pasa. El iframe se monta con `sandbox="allow-scripts allow-same-origin"`.
 *     Con contenido de OTRO origen esa pareja es inofensiva: `allow-same-origin`
 *     solo le devuelve al iframe SU propio origen, y la politica de mismo origen
 *     del navegador le sigue impidiendo tocar el DOM del padre. Pero si el
 *     `base_url` apunta a WLO mismo, el iframe pasa a ser same-origin DE VERDAD
 *     con el padre: entonces `allow-scripts` + `allow-same-origin` equivale a no
 *     tener sandbox, y el plugin puede leer la sesion y actuar como el usuario.
 *     El sandbox no avisa de esto: sigue puesto en el HTML y no protege nada.
 *
 * (3) La query se arma con `URL`, no pegando `?a=b` con plantillas. Un
 *     `base_url` legitimo puede traer ya su propia query (`...?tenant=wlp`) y la
 *     concatenacion la convertia en `?tenant=wlp?workspace_id=...`: el segundo
 *     `?` se vuelve parte del valor y el plugin recibe un workspace que no
 *     existe. Falla como "el plugin no carga mis datos", que no se parece en
 *     nada a su causa.
 *
 * ── Lo que esto NO resuelve, a proposito ───────────────────────────────────
 * `workspace_id` viaja como parametro plano, sin firma. Sirve para que el
 * plugin sepa DONDE esta pintando, no para que pruebe QUIEN es: cualquiera
 * puede escribir esa URL a mano. Mientras el plugin sea de solo pintar da
 * igual. El dia que necesite leer o escribir datos de WLO, el camino es el que
 * ya existe en `src/lib/connectors/` (una key `pck_live_...` con scopes), no
 * confiar en este parametro.
 */

export type ResultadoEmbed =
  | { ok: true; url: string }
  | { ok: false; motivo: string }

export interface DatosEmbed {
  workspaceId: string
  workspaceSlug: string
  /** Segmentos despues del id del plugin, ya unidos con "/". Puede ir vacio. */
  subPath?: string
}

/** Origen propio de WLO, para poder rechazarlo (regla 2). */
function origenDeWlo(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

function esLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function construirUrlDeEmbed(
  baseUrl: string | null | undefined,
  datos: DatosEmbed,
  origenPropio: string | null = origenDeWlo(),
): ResultadoEmbed {
  const raw = (baseUrl || '').trim()
  if (!raw) return { ok: false, motivo: 'El plugin no tiene una URL registrada.' }

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, motivo: 'La URL registrada del plugin no es valida.' }
  }

  // Regla 1: https, con la unica excepcion de desarrollo local.
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && esLocal(u.hostname))) {
    return { ok: false, motivo: 'La URL del plugin debe ser https.' }
  }

  // Regla 2: jamas el mismo origen que WLO (ver el bloque de arriba).
  if (origenPropio && u.origin === origenPropio) {
    return { ok: false, motivo: 'Un plugin no puede servirse desde el propio WLO.' }
  }

  // Regla 3: parametros por URL, respetando la query que ya trajera el base_url.
  u.searchParams.set('workspace_id', datos.workspaceId)
  u.searchParams.set('workspace_slug', datos.workspaceSlug)
  u.searchParams.set('path', datos.subPath || '')

  return { ok: true, url: u.toString() }
}
