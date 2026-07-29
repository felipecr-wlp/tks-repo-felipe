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
import { useCallback, useEffect, useRef, useState } from 'react'
import { Table2, Megaphone, ListCollapse, PenTool, ExternalLink } from 'lucide-react'
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
   * Densidad visual. 'compact' (default) es la caja chica de las descripciones
   * de tarea: borde, texto pequeño, interlineado apretado. 'page' es el lienzo
   * de una nota: sin caja, tipografía de documento y aire entre párrafos, con
   * la barra de formato pegada arriba mientras se lee.
   */
  density?: 'compact' | 'page'
  /**
   * Workspace de la nota. Requerido para crear pizarras incrustadas (el bloque
   * de pizarra crea un registro en `whiteboards` de este workspace). Solo lo
   * pasan las notas; las descripciones de tareas no lo necesitan.
   */
  workspaceId?: string
  /**
   * Nota que hospeda al editor. La pizarra incrustada la referencia para HEREDAR
   * su alcance: si la nota se comparte con un departamento, el dibujo va con
   * ella. Sin esto la pizarra nacería privada y sus lectores verían un hueco.
   */
  noteId?: string
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

// Tipografia de DOCUMENTO (density='page'). El editor venia con la misma escala
// que una descripcion de tarea: 13px, parrafos pegados y encabezados casi del
// mismo tamaño que el cuerpo. Eso es lo que hacia que una nota se leyera como un
// campo de formulario en vez de como una pagina. Aqui se separa la jerarquia:
// cuerpo 16px con interlineado de lectura, H2 y H3 que de verdad se ven titulos,
// y aire entre bloques.
const PAGE_TYPOGRAPHY = cn(
  'text-[16px] leading-[1.75] text-foreground',
  '[&_p]:my-[0.85em]',
  '[&_h2]:text-[1.6em] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-[1.6em] [&_h2]:mb-[0.5em] [&_h2]:leading-tight',
  '[&_h3]:text-[1.25em] [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mt-[1.3em] [&_h3]:mb-[0.4em] [&_h3]:leading-snug',
  '[&_ul]:my-[0.8em] [&_ol]:my-[0.8em] [&_li]:my-[0.25em]',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  '[&_hr]:my-[2em] [&_hr]:border-border',
  // Los bloques anchos (tablas, pizarras, imagenes) pueden salirse de la columna
  // de texto y usar todo el lienzo. Es lo que hace que se sienta amplio.
  '[&_table]:!my-[1.4em] [&_table]:!text-[0.95em]',
  '[&_[data-whiteboard]]:my-[1.5em]',
  '[&_img]:rounded-lg [&_img]:my-[1.4em]',
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
  density = 'compact',
  workspaceId,
  noteId,
}: RichTextEditorProps) {
  const full = blocks === 'full'
  const page = density === 'page'

  // Crea una pizarra real en este workspace y devuelve su id, para que el bloque
  // de pizarra incrustada la referencie. Reutiliza la API /api/whiteboards.
  // Solo disponible cuando hay workspaceId (notas), no en descripciones de tarea.
  const createWhiteboard = useCallback(async (): Promise<string | null> => {
    if (!workspaceId) return null
    try {
      const res = await fetch('/api/whiteboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          title: 'Pizarra',
          // Queda atada a la nota: su alcance es el de la nota, siempre.
          note_id: noteId ?? null,
        }),
      })
      if (!res.ok) throw new Error()
      const j = await res.json()
      return (j?.id as string) ?? null
    } catch {
      toast.error('No se pudo crear la pizarra')
      return null
    }
  }, [workspaceId, noteId])
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
          'prose max-w-none outline-none',
          page ? 'prose-base min-h-[60vh] px-0 py-4' : 'prose-sm min-h-[80px] px-3 py-2',
          !page && '[&_p]:my-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1',
          !page && '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5',
          full && FULL_BLOCK_CLASSES,
          page && PAGE_TYPOGRAPHY,
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
      page
        ? 'bg-transparent'
        : 'border border-input rounded-lg bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow',
      className,
    )}>
      <Toolbar
        editor={editor}
        full={full}
        page={page}
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

// Normaliza una URL: si no trae protocolo (ni es mailto/tel/ruta relativa),
// antepone https:// para que el enlace no quede roto.
function normalizeHref(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return /^(https?:|mailto:|tel:|\/|#)/i.test(t) ? t : `https://${t}`
}

// Boton de enlace con popover inline: input de URL + preview clicable, en vez de
// un modal bloqueante. Enter aplica, Escape/click-fuera cierra.
function LinkButton({ editor, className }: { editor: NonNullable<Editor>; className: string }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => inputRef.current?.select())
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    setUrl((editor.getAttributes('link').href as string) ?? '')
    setOpen(true)
  }

  const apply = () => {
    const href = normalizeHref(url)
    if (href === '') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setOpen(false)
  }

  const remove = () => {
    editor.chain().focus().unsetLink().run()
    setOpen(false)
  }

  const preview = normalizeHref(url)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className={className}
        title="Agregar enlace"
        aria-label="Agregar o editar enlace"
        aria-expanded={open}
      >
        <LinkIcon />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-border bg-popover p-2.5 shadow-overlay">
          <input
            ref={inputRef}
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); apply() }
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
            }}
            placeholder="https://..."
            aria-label="URL del enlace"
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {preview && (
            <a
              href={preview}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{preview}</span>
            </a>
          )}
          <div className="mt-2 flex items-center justify-end gap-1.5">
            {editor.isActive('link') && (
              <button
                type="button"
                onClick={remove}
                className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-accent transition-colors"
              >
                Quitar
              </button>
            )}
            <button
              type="button"
              onClick={apply}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Toolbar({
  editor,
  full = false,
  page = false,
  onCreateWhiteboard,
}: {
  editor: Editor
  full?: boolean
  page?: boolean
  onCreateWhiteboard?: () => Promise<string | null>
}) {
  if (!editor) return null
  const btn = (active: boolean) =>
    cn(
      'p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors',
      active && 'bg-accent text-foreground',
    )

  return (
    // En una nota la barra se queda pegada arriba: el formato sigue a la mano
    // aunque el documento sea largo, en vez de perderse al primer scroll.
    <div className={cn(
      'flex flex-wrap items-center gap-0.5',
      page
        ? 'sticky top-0 z-20 -mx-2 px-2 py-1.5 mb-1 bg-background/85 backdrop-blur-sm border-b border-border/60 rounded-md'
        : 'px-1.5 py-1 border-b border-border',
    )}>
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
      <LinkButton editor={editor} className={btn(editor.isActive('link'))} />


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
