'use client'

/**
 * Editor rico basado en Tiptap.
 * Soporta: bold, italic, headings, listas, links, code, task lists.
 *
 * Lazy-load: este componente y sus deps (~80KB) deben importarse via
 * `next/dynamic` en el padre para no inflar el bundle inicial.
 */
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { SlashMenu } from './SlashMenu'

interface RichTextEditorProps {
  /** Contenido inicial (HTML o JSON serializado como string) */
  value: string
  /** Se llama al hacer blur con el HTML actual */
  onSave: (html: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

export function RichTextEditor({
  value,
  onSave,
  placeholder = 'Escribe una descripción...',
  className,
  autoFocus = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        bulletList: { HTMLAttributes: { class: 'list-disc pl-5 space-y-0.5' } },
        orderedList: { HTMLAttributes: { class: 'list-decimal pl-5 space-y-0.5' } },
        codeBlock: { HTMLAttributes: { class: 'bg-muted rounded p-2 text-xs font-mono' } },
        code: { HTMLAttributes: { class: 'bg-muted rounded px-1 py-0.5 text-xs font-mono' } },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-primary underline underline-offset-2' },
      }),
      Placeholder.configure({ placeholder }),
      TaskList.configure({ HTMLAttributes: { class: 'space-y-1' } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { class: 'flex items-start gap-2' } }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none outline-none',
          'min-h-[80px] px-3 py-2',
          '[&_p]:my-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1',
          '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5',
        ),
      },
    },
    onBlur: ({ editor }) => {
      const html = editor.getHTML()
      // Si el contenido es solo `<p></p>` vacío, mandamos string vacío
      const isEmpty = html === '<p></p>' || html === ''
      onSave(isEmpty ? '' : html)
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus('end')
  }, [editor, autoFocus])

  // Sync value externo solo si el editor está vacío y entran datos nuevos
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current === '<p></p>' && value && value !== '<p></p>') {
      editor.commands.setContent(value, false)
    }
  }, [editor, value])

  if (!editor) return null

  return (
    <div className={cn(
      'border border-input rounded-lg bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow',
      className,
    )}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <SlashMenu editor={editor} />
    </div>
  )
}

// ── Toolbar minimalista ─────────────────────────────────────────────────────
type Editor = ReturnType<typeof useEditor>

function Toolbar({ editor }: { editor: Editor }) {
  if (!editor) return null
  const btn = (active: boolean) =>
    cn(
      'p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors',
      active && 'bg-accent text-foreground',
    )

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive('bold'))}
        title="Negrita (⌘+B)"
      >
        <BoldIcon />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive('italic'))}
        title="Cursiva (⌘+I)"
      >
        <ItalicIcon />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={btn(editor.isActive('strike'))}
        title="Tachado"
      >
        <StrikeIcon />
      </button>
      <div className="w-px h-4 bg-border mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btn(editor.isActive('heading', { level: 2 }))}
        title="Encabezado 2"
      >
        <span className="text-xs font-bold px-1">H2</span>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btn(editor.isActive('heading', { level: 3 }))}
        title="Encabezado 3"
      >
        <span className="text-xs font-bold px-1">H3</span>
      </button>
      <div className="w-px h-4 bg-border mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive('bulletList'))}
        title="Lista"
      >
        <ListIcon />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive('orderedList'))}
        title="Lista numerada"
      >
        <OrderedListIcon />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={btn(editor.isActive('taskList'))}
        title="Lista de tareas"
      >
        <CheckListIcon />
      </button>
      <div className="w-px h-4 bg-border mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={btn(editor.isActive('code'))}
        title="Código inline"
      >
        <CodeIcon />
      </button>
      <button
        type="button"
        onClick={() => {
          const url = window.prompt('URL del enlace:', editor.getAttributes('link').href ?? '')
          if (url === null) return
          if (url === '') editor.chain().focus().unsetLink().run()
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }}
        className={btn(editor.isActive('link'))}
        title="Agregar enlace"
      >
        <LinkIcon />
      </button>
    </div>
  )
}

// ── Icons ───────────────────────────────────────────────────────────────────
function BoldIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M3 2h4.5a2.25 2.25 0 010 4.5H3V2zM3 6.5h5a2.25 2.25 0 010 4.5H3V6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
}
function ItalicIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 2h6M2 11h6M8 2L5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
}
function StrikeIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5h9M4 3h5a2 2 0 010 4M9 10H4a2 2 0 010-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
}
function ListIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="2" cy="3" r=".7" fill="currentColor" /><circle cx="2" cy="6.5" r=".7" fill="currentColor" /><circle cx="2" cy="10" r=".7" fill="currentColor" /><path d="M5 3h6M5 6.5h6M5 10h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
}
function OrderedListIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 3h6M5 6.5h6M5 10h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><text x="0.5" y="4" fontSize="3.5" fill="currentColor">1</text><text x="0.5" y="7.5" fontSize="3.5" fill="currentColor">2</text><text x="0.5" y="11" fontSize="3.5" fill="currentColor">3</text></svg>
}
function CheckListIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" /><rect x="1.5" y="8.5" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" /><path d="M2.3 3l.6.6L4 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 3h5M6.5 10h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
}
function CodeIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4 3L1 6.5l3 3.5M9 3l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function LinkIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5.5 7.5a2 2 0 002.83 0l2-2a2 2 0 10-2.83-2.83L7 3.7M7.5 5.5a2 2 0 00-2.83 0l-2 2a2 2 0 002.83 2.83L6 9.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
