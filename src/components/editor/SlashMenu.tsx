'use client'

/**
 * SlashMenu — menú flotante tipo Notion al escribir "/" en el editor Tiptap.
 *
 * Detecta "/" al inicio de un block vacío (o tras espacio), muestra menú
 * con bloques disponibles, navegación con teclado, inserta y borra el "/".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { cn } from '@/lib/utils'

interface SlashMenuProps {
  editor: Editor | null
}

interface SlashCommand {
  id: string
  label: string
  description: string
  keywords: string[]
  icon: string
  group: string
  command: (editor: Editor, range: { from: number; to: number }) => void
}

const COMMANDS: SlashCommand[] = [
  {
    id: 'h2',
    label: 'Encabezado grande',
    description: 'Sección principal (H2)',
    keywords: ['h2', 'heading', 'titulo', 'encabezado'],
    icon: 'H₂',
    group: 'Texto',
    command: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Encabezado mediano',
    description: 'Sub-sección (H3)',
    keywords: ['h3', 'heading', 'subtitulo'],
    icon: 'H₃',
    group: 'Texto',
    command: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'p',
    label: 'Párrafo',
    description: 'Texto normal',
    keywords: ['p', 'parrafo', 'texto'],
    icon: '¶',
    group: 'Texto',
    command: (e, r) => e.chain().focus().deleteRange(r).setNode('paragraph').run(),
  },
  {
    id: 'bullet',
    label: 'Lista con viñetas',
    description: 'Lista no ordenada',
    keywords: ['lista', 'bullet', 'list', 'punto'],
    icon: '•',
    group: 'Listas',
    command: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Lista numerada',
    description: 'Lista 1, 2, 3…',
    keywords: ['numerada', 'numeros', 'ordered', 'lista'],
    icon: '1.',
    group: 'Listas',
    command: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: 'Lista de tareas',
    description: 'Checklist con casillas',
    keywords: ['tarea', 'task', 'todo', 'checklist'],
    icon: '☐',
    group: 'Listas',
    command: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Cita',
    description: 'Bloque de cita destacado',
    keywords: ['cita', 'quote', 'blockquote'],
    icon: '❝',
    group: 'Bloques',
    command: (e, r) => e.chain().focus().deleteRange(r).setBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Bloque de código',
    description: 'Snippet preformateado',
    keywords: ['code', 'codigo', 'pre'],
    icon: '</>',
    group: 'Bloques',
    command: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Divisor',
    description: 'Línea horizontal separadora',
    keywords: ['divider', 'divisor', 'linea', 'hr', 'separador'],
    icon: '—',
    group: 'Bloques',
    command: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
]

export function SlashMenu({ editor }: SlashMenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const slashRangeRef = useRef<{ from: number; to: number } | null>(null)

  // Filtrar commands por query
  const filtered = useMemo(() => {
    if (!query) return COMMANDS
    const q = query.toLowerCase()
    return COMMANDS.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.keywords.some(k => k.includes(q))
    )
  }, [query])

  // Agrupar
  const groups = useMemo(() => {
    const map = new Map<string, SlashCommand[]>()
    filtered.forEach(c => {
      if (!map.has(c.group)) map.set(c.group, [])
      map.get(c.group)!.push(c)
    })
    return Array.from(map.entries())
  }, [filtered])

  // Reset activeIndex cuando cambia query
  useEffect(() => { setActiveIndex(0) }, [query])

  // Watch editor para detectar "/" y mostrar/ocultar menú
  useEffect(() => {
    if (!editor) return

    function update() {
      const { state } = editor!
      const { from, $from } = state.selection
      const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0')

      // Buscar "/" más cercano hacia atrás (sin espacio entre / y cursor)
      const slashIdx = text.lastIndexOf('/')
      if (slashIdx === -1) {
        setOpen(false)
        return
      }
      // Verificar que no haya espacios entre el "/" y el cursor
      const after = text.slice(slashIdx + 1)
      if (after.includes(' ') || after.includes('\n')) {
        setOpen(false)
        return
      }
      // Verificar que el "/" esté al inicio del bloque o tras un espacio/inicio de línea
      const charBefore = slashIdx === 0 ? '' : text[slashIdx - 1]
      if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
        setOpen(false)
        return
      }

      // Calcular range para borrar el "/" + query al ejecutar
      const slashFrom = from - (text.length - slashIdx)
      slashRangeRef.current = { from: slashFrom, to: from }

      setQuery(after)

      // Posicionar menú cerca del cursor
      const coords = editor!.view.coordsAtPos(from)
      setPosition({ top: coords.bottom + 6, left: coords.left })
      setOpen(true)
    }

    function close() {
      setOpen(false)
    }

    editor.on('selectionUpdate', update)
    editor.on('update', update)
    editor.on('blur', close)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('update', update)
      editor.off('blur', close)
    }
  }, [editor])

  // Keyboard nav
  useEffect(() => {
    if (!open || !editor) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        return
      }
      if (filtered.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[activeIndex]
        if (cmd && slashRangeRef.current) {
          cmd.command(editor!, slashRangeRef.current)
          setOpen(false)
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, editor, filtered, activeIndex])

  if (!open || !position || filtered.length === 0) return null

  let runningIndex = 0
  return (
    <div
      className="fixed z-[80] w-72 max-h-80 overflow-y-auto bg-popover border border-border rounded-lg shadow-2xl py-1 animate-in fade-in slide-in-from-top-1 duration-100"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}  // evitar perder focus del editor
    >
      {groups.map(([group, items]) => (
        <div key={group} className="py-1">
          <div className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {group}
          </div>
          {items.map(cmd => {
            const myIndex = runningIndex++
            const active = myIndex === activeIndex
            return (
              <button
                key={cmd.id}
                onMouseEnter={() => setActiveIndex(myIndex)}
                onClick={() => {
                  if (slashRangeRef.current && editor) {
                    cmd.command(editor, slashRangeRef.current)
                    setOpen(false)
                  }
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                  active ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span className="flex-shrink-0 w-7 h-7 rounded-md bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground">
                  {cmd.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{cmd.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{cmd.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
