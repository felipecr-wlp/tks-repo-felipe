/**
 * Callout, bloque destacado tipo Notion / Confluence.
 * Contiene bloques (parrafos, listas) y tiene una variante de color:
 * info (azul), warn (ambar), success (verde), tip (violeta).
 *
 * Se serializa a <div data-callout data-variant="..."> para persistir en el
 * content de la nota. El color lo aplica el editor via selectores de contenedor
 * ([&_[data-callout]]) para no depender de globals.css (evita chocar con Fable).
 */
import { Node, mergeAttributes } from '@tiptap/core'

export type CalloutVariant = 'info' | 'warn' | 'success' | 'tip'

const VARIANTS: CalloutVariant[] = ['info', 'warn', 'success', 'tip']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { variant?: CalloutVariant }) => ReturnType
      toggleCallout: (attrs?: { variant?: CalloutVariant }) => ReturnType
      unsetCallout: () => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info' as CalloutVariant,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('data-variant')
          return VARIANTS.includes(v as CalloutVariant) ? v : 'info'
        },
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    }
  },
})
