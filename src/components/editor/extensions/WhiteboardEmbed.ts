/**
 * Bloque de pizarra incrustada, estilo Confluence/Notion.
 *
 * NO reinventa la pizarra: cada bloque REFERENCIA una pizarra Excalidraw real
 * (tabla `whiteboards` + API `/api/whiteboards/[id]`), guardando solo su `id`.
 * Asi el contenido de la nota se mantiene minimo (un id) y se reutiliza toda la
 * infraestructura que ya existe (autosave, permisos, pagina de pantalla completa
 * con colaboracion en vivo). El lienzo se renderiza inline via un NodeView React.
 *
 * Es un nodo `atom` (hoja): ProseMirror lo trata como una unidad indivisible y no
 * intenta editar dentro; el NodeView maneja sus propios eventos (Excalidraw).
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { WhiteboardNodeView } from '../WhiteboardNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    whiteboardEmbed: {
      setWhiteboard: (attrs: { id: string }) => ReturnType
    }
  }
}

export const WhiteboardEmbed = Node.create({
  name: 'whiteboardEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
      height: {
        default: 460,
        parseHTML: (el) => {
          const h = parseInt((el as HTMLElement).getAttribute('data-height') ?? '', 10)
          return Number.isFinite(h) ? h : 460
        },
        renderHTML: (attrs) => ({ 'data-height': attrs.height }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-whiteboard]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-whiteboard': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WhiteboardNodeView)
  },

  addCommands() {
    return {
      setWhiteboard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
