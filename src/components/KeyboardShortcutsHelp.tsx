'use client'

/**
 * Overlay de ayuda de atajos de teclado.
 * Se abre con "?" (Shift+/) en cualquier parte, excepto mientras se escribe
 * en un input, textarea o elemento contenteditable. Cierra con Escape o clic
 * en el fondo. Solo lista atajos que existen de verdad en la app (verificados).
 */
import { useEffect, useRef, useState } from 'react'
import { Keyboard, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Shortcut = { keys: string[]; label: string }
type Group = { title: string; items: Shortcut[] }

// Atajos reales verificados en el código:
// - Cmd/Ctrl+K: CommandPalette.tsx (búsqueda global)
// - C: GlobalNewTaskModal.tsx (nueva tarea, workspace-wide)
// - /: KanbanBoard.tsx (enfocar la búsqueda del tablero)
// - ?: este mismo overlay
const GROUPS: Group[] = [
  {
    title: 'General',
    items: [
      { keys: ['Cmd', 'K'], label: 'Abrir la búsqueda global' },
      { keys: ['?'], label: 'Mostrar esta ayuda de atajos' },
    ],
  },
  {
    title: 'Navegación',
    items: [
      { keys: ['C'], label: 'Crear una tarea nueva' },
      { keys: ['/'], label: 'Enfocar la búsqueda del tablero' },
    ],
  },
]

/** true si el foco está en un campo editable (input, textarea, contenteditable). */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Listener global: "?" abre, Escape cierra. Guarda window/document via useEffect.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
        return
      }
      // "?" es Shift+/ en la mayoría de teclados: chequeamos e.key directo.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Enfocar el panel al abrir para accesibilidad de teclado.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => panelRef.current?.focus())
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Atajos de teclado"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl',
          'outline-none focus:outline-none'
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Keyboard className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Atajos de teclado</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-foreground">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className={cn(
                            'inline-flex min-w-[1.5rem] items-center justify-center rounded-md',
                            'border border-border bg-muted px-1.5 py-0.5',
                            'text-xs font-medium text-muted-foreground'
                          )}
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            Presiona <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">Esc</kbd> para cerrar.
          </p>
        </div>
      </div>
    </div>
  )
}
