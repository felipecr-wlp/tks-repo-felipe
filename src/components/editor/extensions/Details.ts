/**
 * Toggle / Details, bloque colapsable tipo Notion / Confluence.
 * Se compone de tres nodos: `details` (contenedor), `detailsSummary` (el titulo
 * clickeable) y `detailsContent` (el cuerpo que se muestra/oculta).
 *
 * Se serializa a HTML nativo <details><summary>..</summary><div>..</div>, asi
 * el colapsar/expandir lo maneja el navegador sin JavaScript extra, tanto en el
 * editor como en cualquier vista de solo lectura. El estado abierto se persiste
 * en el atributo `open`.
 */
import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    details: {
      setDetails: () => ReturnType
    }
  }
}

export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).hasAttribute('open'),
        renderHTML: (attrs) => (attrs.open ? { open: 'open' } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { open: true },
              content: [
                { type: 'detailsSummary', content: [{ type: 'text', text: 'Toggle' }] },
                { type: 'detailsContent', content: [{ type: 'paragraph' }] },
              ],
            })
            .run(),
    }
  },
})

export const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', HTMLAttributes, 0]
  },
})

export const DetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-details-content]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-details-content': '' }), 0]
  },
})
