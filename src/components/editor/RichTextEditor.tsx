'use client'

/**
 * Editor rico basado en Tiptap.
 * Soporta: bold, italic, headings, listas, links, code, task lists.
 *
 * Lazy-load: este componente y sus deps (~80KB) deben importarse via
 * `next/dynamic` en el padre para no inflar el bundle inicial.
 */
import { useEditor, EditorContent } from '@tiptap/react'
import type { Extension, Node as TiptapNode } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { useCallback, useEffect, useRef } from 'react'
import { Table2, Megaphone, ListCollapse, PenTool } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SlashMenu } from './SlashMenu'
import { Callout } from './extensions/Callout'
import { Details, DetailsSummary, DetailsContent } from './extensions/Details'
import { WhiteboardEmbed } from './extensions/WhiteboardEmbed'

interface RichTextEditorProps {
  /** Contenido inicial (HTML o JSON serializado como string) */
  value: string
  /** Se llama al hacer blur con el HTML actual, y con debounce si autosaveMs>0 */
  onSave: (html: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /**
   * Si se define (>0), autoguarda mientras se escribe con este debounce en ms,
   * ademas del guardado al blur. Sin esta prop el comportamiento es el de antes
   * (solo blur), para no cambiar el guardado de descripciones de tareas.
   */
  autosaveMs?: number
  /** Se llama en cuanto el contenido cambia (para marcar "sin guardar"). */
  onDirty?: () => void
  /**
   * Conjunto de bloques disponibles. 'basic' (default) = formato de texto para
   * descripciones de tareas. 'full' = wiki Confluence-like: agrega tablas,
   * callouts y toggles. Se separa para no inflar el editor de tareas.
   */
  blocks?: 'basic' | 'full'
  /**
   * Workspace de la nota. Requerido para crear pizarras incrustadas (el bloque
   * de pizarra crea un registro en `whiteboards` de este workspace). Solo lo
   * pasan las notas; las descripciones de tareas no lo necesitan.
   */
  workspaceId?: string
}

// Extensiones extra del modo 'full' (tablas, callouts, toggles, pizarra). Se
// definen fuera del componente para no recrearlas en cada render.
const FULL_BLOCK_EXTENSIONS: (Extension | TiptapNode)[] = [
  Table.configure({ resizable: true, HTMLAttributes: { class: 'wiki-table' } }),
  TableRow,
  TableHeader,
  TableCell,
  Callout,
  Details,
  DetailsSummary,
  DetailsContent,
  WhiteboardEmbed,
]

// Selectores de contenedor que estilizan los bloques 'full' sin tocar
// globals.css (asi no colisiona con el sistema visual global de Fable).
const FULL_BLOCK_CLASSES = cn(
  // Tablas
  '[&_table]:w-full [&_table]:my-3 [&_table]:border-collapse [&_table]:text-sm',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-semibold [&_th]:text-left',
  '[&_.selectedCell]:bg-accent/40',
  // Callouts (color por variante via data-variant)
  '[&_[data-callout]]:my-3 [&_[data-callout]]:rounded-lg [&_[data-callout]]:border-l-4 [&_[data-callout]]:px-3 [&_[data-callout]]:py-2',
  '[&_[data-variant=info]]:border-l-sky-400 [&_[data-variant=info]]:bg-sky-50 dark:[&_[data-variant=info]]:bg-sky-950/40',
  '[&_[data-variant=warn]]:border-l-amber-400 [&_[data-variant=warn]]:bg-amber-50 dark:[&_[data-variant=warn]]:bg-amber-950/40',
  '[&_[data-variant=success]]:border-l-emerald-400 [&_[data-variant=success]]:bg-emerald-50 dark:[&_[data-variant=success]]:bg-emerald-950/40',
  '[&_[data-variant=tip]]:border-l-violet-400 [&_[data-variant=tip]]:bg-violet-50 dark:[&_[data-variant=tip]]:bg-violet-950/40',
  // Toggles (details/summary nativos)
  '[&_details]:my-3 [&_details]:rounded-lg [&_details]:border [&_details]:border-border [&_details]:px-3 [&_details]:py-2',
  '[&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:outline-none [&_summary]:marker:text-muted-foreground',
  '[&_[data-details-content]]:mt-2 [&_[data-details-content]]:pl-1',
)

export function RichTextEditor({
  value,
  onSave,
  placeholder = 'Escribe una descripción...',
  className,
  autoFocus = false,
  autosaveMs = 0,
  onDirty,
  blocks = 'basic',
  workspaceId,
}: RichTextEditorProps) {
  const full = blocks === 'full'

  // Crea una pizarra real en este workspace y devuelve su id, para que el bloque
  // de pizarra incrustada la referencie. Reutiliza la API /api/whiteboards.
  // Solo disponible cuando hay workspaceId (notas), no en descripciones de tarea.
  const createWhiteboard = useCallback(async (): Promise<string | null> => {
    if (!workspaceId) return null
    try {
      const res = await fetch('/api/whiteboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, title: 'Pizarra' }),
      })
      if (!res.ok) throw new Error()
      const j = await res.json()
      return (j?.id as string) ?? null
    } catch {
      toast.error('No se pudo crear la pizarra')
      return null
    }
  }, [workspaceId])
  // Refs para no capturar closures viejas dentro de los callbacks de Tiptap.
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const htmlOf = (html: string) => (html === '<p></p>' || html === '' ? '' : html)

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
      ...(full ? FULL_BLOCK_EXTENSIONS : []),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none outline-none',
          'min-h-[80px] px-3 py-2',
          '[&_p]:my-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1',
          '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5',
          full && FULL_BLOCK_CLASSES,
        ),
      },
    },
    onUpdate: ({ editor }) => {
      // Marca "sin guardar" en cuanto el contenido cambia.
      onDirtyRef.current?.()
      // Autosave mientras se escribe, solo si autosaveMs>0. Sin esta prop, el
      // guardado sigue siendo únicamente al blur (comportamiento de tareas).
      if (autosaveMs > 0) {
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
        autosaveTimer.current = setTimeout(() => {
          onSaveRef.current(htmlOf(editor.getHTML()))
        }, autosaveMs)
      }
    },
    onBlur: ({ editor }) => {
      // Al perder foco, cancelamos cualquier autosave pendiente y guardamos ya.
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
      }
      onSaveRef.current(htmlOf(editor.getHTML()))
    },
    immediatelyRender: false,
  })

  // Limpieza del timer de autosave al desmontar, para no guardar sobre un
  // editor muerto ni filtrar timeouts.
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [])

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
      <Toolbar
        editor={editor}
        full={full}
        onCreateWhiteboard={full && workspaceId ? createWhiteboard : undefined}
      />
      <EditorContent editor={editor} />
      <SlashMenu
        editor={editor}
        onCreateWhiteboard={full && workspaceId ? createWhiteboard : undefined}
      />
    </div>
  )
}

// ── Toolbar minimalista ─────────────────────────────────────────────────────
type Editor = ReturnType<typeof useEditor>

function Toolbar({
  editor,
  full = false,
  onCreateWhiteboard,
}: {
  editor: Editor
  full?: boolean
  onCreateWhiteboard?: () => Promise<string | null>
}) {
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

      {full && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            className={btn(editor.isActive('table'))}
            title="Insertar tabla"
          >
            <Table2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCallout({ variant: 'info' }).run()}
            className={btn(editor.isActive('callout'))}
            title="Callout / nota destacada"
          >
            <Megaphone className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().setDetails().run()}
            className={btn(editor.isActive('details'))}
            title="Toggle colapsable"
          >
            <ListCollapse className="w-3.5 h-3.5" />
          </button>
          {onCreateWhiteboard && (
            <button
              type="button"
              onClick={async () => {
                const id = await onCreateWhiteboard()
                if (id) editor.chain().focus().setWhiteboard({ id }).run()
              }}
              className={btn(false)}
              title="Insertar pizarra"
            >
              <PenTool className="w-3.5 h-3.5" />
            </button>
          )}
        </>
      )}
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
