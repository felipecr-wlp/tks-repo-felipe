/**
 * Marca visible derivada del dominio de correo del usuario.
 *
 * WLO es multi-marca bajo una sola organizacion tenant ("Pavific"): los dominios
 * pavific.com, welovepaving.com y welovepaving.net conviven en la MISMA org
 * (via org_email_domains). El rotulo que se muestra bajo el workspace en el
 * switcher debe reflejar la marca a la que pertenece QUIEN mira (ej. Karla
 * @welovepaving.net ve "We Love Paving"), no el nombre interno del tenant.
 *
 * Mapa chico y estable para este despliegue. Si crece, migrar a una columna
 * `brand_label` en org_email_domains y leerla desde ahi. Coincide por dominio
 * exacto o subdominio (ej. ops.welovepaving.com cae a "We Love Paving").
 */
const BRAND_BY_DOMAIN: Array<{ match: string; label: string }> = [
  { match: 'welovepaving.com', label: 'We Love Paving' },
  { match: 'welovepaving.net', label: 'We Love Paving' },
  { match: 'pavific.com', label: 'Pavific' },
]

/**
 * Devuelve la marca visible para un correo, o null si el dominio no esta mapeado
 * (el llamador cae entonces al nombre de la organizacion).
 */
export function brandFromEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at === -1) return null
  const host = email.slice(at + 1).trim().toLowerCase()
  if (!host) return null
  for (const { match, label } of BRAND_BY_DOMAIN) {
    if (host === match || host.endsWith('.' + match)) return label
  }
  return null
}
