/**
 * Saneado de HTML de texto enriquecido (anti stored-XSS).
 *
 * El contenido rico (descripcion de tareas, cuerpo de notas) se escribe con el
 * editor Tiptap y se guarda como HTML. La vista in-app de notas lo re-parsea con
 * Tiptap (que descarta lo que no este en su esquema), pero dos vistas lo pintan
 * CRUDO via dangerouslySetInnerHTML: la pagina de impresion de notas (server) y
 * la descripcion de tarea en solo lectura (client). Un atacante autenticado
 * podria mandar por la API un cuerpo con `<img src=x onerror=...>` y ejecutarlo
 * en la sesion de otros miembros. El CSP usa script-src 'unsafe-inline', asi que
 * NO frena esos handlers: el saneado en render es la barrera real.
 *
 * isomorphic-dompurify corre en server (jsdom) y en browser (DOMParser) con el
 * mismo resultado. DOMPurify ya quita por defecto <script>, manejadores on* y
 * URIs javascript:; aqui ademas fijamos una allowlist alineada con la salida de
 * Tiptap y forzamos rel/target seguros en los enlaces.
 */
import DOMPurify from 'isomorphic-dompurify'

// Tags que produce nuestro editor Tiptap (starter-kit + link + table + task-list
// + mention). Nada de <script>, <style>, <iframe>, <object>, <embed>, <form>.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'blockquote', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'class',
  'colspan', 'rowspan',
  // task-list / mention de Tiptap
  'data-type', 'data-id', 'data-label', 'data-checked',
]

let hookRegistered = false

/** Fuerza enlaces seguros: sin javascript:, siempre rel=noopener noreferrer. */
function registerLinkHook() {
  if (hookRegistered) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('rel', 'noopener noreferrer nofollow')
      if (node.getAttribute('target') === '_blank') {
        node.setAttribute('target', '_blank')
      }
    }
  })
  hookRegistered = true
}

/**
 * Devuelve una version segura del HTML de texto enriquecido. Si el valor es
 * vacio/nulo, devuelve string vacio.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return ''
  registerLinkHook()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Bloquea data: y demas esquemas raros en href/src; solo http(s), mailto, tel.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  })
}
