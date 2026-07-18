'use client'

/**
 * Dialogo de entrada de texto reutilizable (reemplaza prompt() nativo).
 * Mismo patron imperativo que ConfirmDialog: se importa donde sea y se usa como
 * `const name = await promptDialog({ title, label, ... })` que resuelve el valor
 * (string ya .trim()) o null si el usuario cancela. El host se monta una vez en
 * el layout raiz, junto al <Toaster /> y <ConfirmDialogHost />.
 *
 * Accesibilidad: role="dialog", aria-modal, autofocus en el input, Escape para
 * cancelar, Enter para aceptar, click-outside para cancelar.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

type PromptOptions = {
  title?: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Si se define y devuelve string, se muestra como error y no cierra. */
  validate?: (value: string) => string | null
  /** Permitir aceptar con string vacio. Por defecto false (exige texto). */
  allowEmpty?: boolean
}

type PromptState = (PromptOptions & { id: number; resolve: (value: string | null) => void }) | null

let state: PromptState = null
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

function getServerSnapshot(): PromptState {
  return null
}

/** Abre el dialogo y resuelve el texto (trim) o null si cancela. */
export function promptDialog(opts: PromptOptions | string): Promise<string | null> {
  const options: PromptOptions = typeof opts === 'string' ? { label: opts } : opts
  return new Promise<string | null>((resolve) => {
    if (state) {
      const prev = state.resolve
      state = null
      prev(null)
    }
    state = { ...options, id: ++counter, resolve }
    emit()
  })
}

function settle(result: string | null) {
  if (!state) return
  const resolve = state.resolve
  state = null
  emit()
  resolve(result)
}

export function PromptDialogHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset del valor cada vez que se abre un nuevo dialogo.
  useEffect(() => {
    if (!current) return
    setValue(current.defaultValue ?? '')
    setError(null)
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(focusTimer)
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        settle(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current])

  if (!current) return null

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed && !current.allowEmpty) {
      setError('Escribe un valor.')
      return
    }
    if (current.validate) {
      const msg = current.validate(trimmed)
      if (msg) {
        setError(msg)
        return
      }
    }
    settle(trimmed)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
        onClick={() => settle(null)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        className="fixed left-1/2 top-1/2 z-[91] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-overlay animate-in fade-in zoom-in-95 duration-150"
      >
        <h2
          id="prompt-dialog-title"
          className="text-sm font-semibold text-popover-foreground"
        >
          {current.title ?? 'Escribe un valor'}
        </h2>
        {current.label && (
          <p className="mt-1 text-sm text-muted-foreground">{current.label}</p>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={current.placeholder}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(null)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current.confirmLabel ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </>
  )
}
