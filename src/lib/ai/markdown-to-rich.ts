/**
 * Markdown (subconjunto) -> HTML de Tiptap.
 *
 * Por que existe: KERN redacta documentos (SOPs, minutas, guias) y hay que
 * guardarlos en `notes.content`, que es HTML del editor. Pedirle al modelo que
 * emita ese HTML a mano es fragil: se equivoca en la estructura exacta de una
 * checklist de Tiptap (label + input + div) y el documento nace roto o plano.
 * Los modelos, en cambio, escriben Markdown de forma muy confiable. Asi que el
 * modelo escribe Markdown y la conversion correcta se hace UNA vez, aqui, en
 * codigo que se puede probar.
 *
 * Es un subconjunto deliberado, no un parser de Markdown completo: solo lo que
 * el editor sabe representar (encabezados, listas, checklists, citas, codigo,
 * tablas simples, negritas, enlaces). Lo que no reconoce cae a parrafo, que
 * siempre es una salida valida: nunca se pierde texto.
 *
 * La salida SIEMPRE debe pasar por `sanitizeRichText` antes de guardarse. Este
 * modulo escapa el HTML de entrada, pero el saneado es la barrera real.
 */

/** Escapa el texto del usuario/modelo: nada de HTML crudo se cuela al documento. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Marcas dentro de una linea. El orden importa: el codigo va primero para que
 * lo que este dentro de backticks no se reinterprete como negrita o enlace.
 */
function inline(text: string): string {
  let out = esc(text)

  // `codigo`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  // **negrita** y __negrita__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // *cursiva* (no toca los ** ya consumidos)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // ~~tachado~~
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  // [texto](url); solo http(s) y mailto, el resto se deja como texto plano.
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>')

  return out
}

/** Un item de checklist con la estructura EXACTA que Tiptap sabe volver a leer. */
function taskItem(checked: boolean, text: string): string {
  return (
    `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}">` +
    `<label><input type="checkbox"${checked ? ' checked' : ''}><span></span></label>` +
    `<div><p>${inline(text)}</p></div>` +
    `</li>`
  )
}

type ListKind = 'ul' | 'ol' | 'task' | null

/**
 * Convierte Markdown a HTML compatible con el editor.
 * Devuelve string vacio si no hay contenido util.
 */
export function markdownToRichText(md: string): string {
  if (!md || !md.trim()) return ''

  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []

  let list: ListKind = null
  let inCode = false
  let codeBuffer: string[] = []
  let quoteBuffer: string[] = []

  const closeList = () => {
    if (list === 'ul') out.push('</ul>')
    else if (list === 'ol') out.push('</ol>')
    else if (list === 'task') out.push('</ul>')
    list = null
  }
  const flushQuote = () => {
    if (quoteBuffer.length === 0) return
    out.push(`<blockquote><p>${quoteBuffer.map(inline).join('<br>')}</p></blockquote>`)
    quoteBuffer = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    // ── Bloque de codigo ────────────────────────────────────────────────────
    if (/^\s*```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${esc(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        closeList(); flushQuote()
        inCode = true
      }
      continue
    }
    if (inCode) { codeBuffer.push(raw); continue }

    // ── Linea en blanco: cierra lo que este abierto ─────────────────────────
    if (line.trim() === '') { closeList(); flushQuote(); continue }

    // ── Cita ────────────────────────────────────────────────────────────────
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) { closeList(); quoteBuffer.push(quote[1]); continue }
    flushQuote()

    // ── Separador ───────────────────────────────────────────────────────────
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr>'); continue }

    // ── Encabezado ──────────────────────────────────────────────────────────
    const head = line.match(/^(#{1,6})\s+(.*)$/)
    if (head) {
      closeList()
      // Se baja un nivel: el h1 del documento es su TITULO, que vive en su
      // propio campo. Un h1 dentro del cuerpo competiria con el.
      const level = Math.min(head[1].length + 1, 6)
      out.push(`<h${level}>${inline(head[2])}</h${level}>`)
      continue
    }

    // ── Checklist (antes que la lista normal: "- [ ]" tambien empieza con "-") ──
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/)
    if (task) {
      if (list !== 'task') { closeList(); out.push('<ul data-type="taskList">'); list = 'task' }
      out.push(taskItem(task[1].toLowerCase() === 'x', task[2]))
      continue
    }

    // ── Lista con vinetas ───────────────────────────────────────────────────
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li><p>${inline(bullet[1])}</p></li>`)
      continue
    }

    // ── Lista numerada ──────────────────────────────────────────────────────
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ordered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li><p>${inline(ordered[1])}</p></li>`)
      continue
    }

    // ── Fila de tabla ───────────────────────────────────────────────────────
    // Se ignora la fila separadora (|---|---|) y se pinta la primera fila como
    // encabezado. Tablas simples, sin celdas combinadas: es lo que el modelo
    // produce y lo unico que se puede reconstruir sin ambiguedad.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim())
      const prev = out[out.length - 1] ?? ''
      if (!prev.startsWith('<table') && !prev.startsWith('<tr')) {
        closeList()
        out.push('<table><tbody>')
        out.push(`<tr>${cells.map(c => `<th><p>${inline(c)}</p></th>`).join('')}</tr>`)
      } else {
        out.push(`<tr>${cells.map(c => `<td><p>${inline(c)}</p></td>`).join('')}</tr>`)
      }
      continue
    }
    // Cerrar tabla al salir de ella.
    if (out.length && out[out.length - 1].startsWith('<tr')) out.push('</tbody></table>')

    // ── Parrafo (caso por defecto: nunca se pierde texto) ───────────────────
    closeList()
    out.push(`<p>${inline(line.trim())}</p>`)
  }

  // Cerrar todo lo que quedo abierto al terminar el documento.
  if (inCode && codeBuffer.length) out.push(`<pre><code>${esc(codeBuffer.join('\n'))}</code></pre>`)
  flushQuote()
  closeList()
  if (out.length && out[out.length - 1].startsWith('<tr')) out.push('</tbody></table>')

  return out.join('')
}
