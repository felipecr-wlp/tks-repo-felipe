'use client'

/**
 * Dialogo de confirmacion reutilizable (reemplaza confirm() nativo).
 * API global imperativa al estilo sonner: se importa en cualquier lado y se
 * usa como `if (!(await confirmDialog({ ... }))) return`. El host se monta una
 * sola vez en el layout raiz, junto al <Toaster />.
 *
 * Accesibilidad: role="alertdialog", aria-modal, Escape para cancelar,
 * click-outside para cancelar, autofocus en Cancelar cuando es destructivo.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AlertTriangle } from 'lucide-react'

type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmState = (ConfirmOptions & { id: number; resolve: (value: boolean) => void }) | null

let state: ConfirmState = null
let counter = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return state
}

function getServerSnapshot(): ConfirmState {
  return null
}

/** Abre el dialogo y resuelve true si el usuario confirma, false si cancela. */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts
  return new Promise<boolean>((resolve) => {
    // Si ya hay uno abierto, se cancela el anterior antes de reemplazarlo.
    if (state) {
      const prev = state.resolve
      state = null
      prev(false)
    }
    state = { ...options, id: ++counter, resolve }
    emit()
  })
}

function settle(result: boolean) {
  if (!state) return
  const resolve = state.resolve
  state = null
  emit()
  resolve(result)
}

export function ConfirmDialogHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!current) return
    const focusTimer = setTimeout(() => {
      const target = current.destructive ? cancelRef.current : confirmRef.current
      target?.focus()
    }, 0)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        settle(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [current])

  if (!current) return null

  const destructive = !!current.destructive

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
        onClick={() => settle(false)}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="fixed left-1/2 top-1/2 z-[91] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="mt-0.5 shrink-0 rounded-full bg-destructive/10 p-2">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            </div>
          )}
          <div className="flex-1">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-semibold text-popover-foreground"
            >
              {current.title ?? (destructive ? 'Confirmar acción' : 'Confirmar')}
            </h2>
            <p
              id="confirm-dialog-message"
              className="mt-1 text-sm text-muted-foreground"
            >
              {current.message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => settle(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => settle(true)}
            className={
              destructive
                ? 'rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                : 'rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            }
          >
            {current.confirmLabel ?? (destructive ? 'Eliminar' : 'Confirmar')}
          </button>
        </div>
      </div>
    </>
  )
}
