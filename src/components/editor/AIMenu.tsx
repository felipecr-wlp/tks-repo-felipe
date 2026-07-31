'use client'

/**
 * Boton de IA de la barra del editor de Notas.
 *
 * Trabaja sobre LO SELECCIONADO. Si no hay seleccion, toma la nota entera: es
 * lo que la gente espera al pedir "resume esto" sin haber marcado nada.
 *
 * Nunca escribe solo. El resultado se muestra aparte y hay que apretar
 * "Reemplazar" para que entre al documento, porque una nota es trabajo de
 * alguien y perderlo por un boton mal apretado no se perdona. Descartar cierra
 * sin tocar nada, y siempre queda el Ctrl+Z de Tiptap como ultima red.
 */
import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, Check, X, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/react'
import { cn } from '@/lib/utils'
import { markdownToRichText } from '@/lib/ai/markdown-to-rich'

type Action = 'improve' | 'grammar' | 'concise' | 'summarize' | 'expand'

const OPTIONS: Array<{ key: Action; label: string; hint: string }> = [
  { key: 'improve', label: 'Mejorar redacción', hint: 'Más claro y mejor escrito' },
  { key: 'grammar', label: 'Corregir ortografía', hint: 'Gramática y acentos' },
  { key: 'concise', label: 'Hacer más corto', hint: 'Lo mismo, con menos texto' },
  { key: 'summarize', label: 'Resumir', hint: 'Las ideas principales' },
  { key: 'expand', label: 'Ampliar', hint: 'Desarrollar la idea' },
]

// El mismo tope que valida el servidor. Se corta aca tambien para dar un aviso
// util en vez de un 422 seco.
const MAX_CHARS = 8000

export function AIMenu({ editor, className }: { editor: Editor; className?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Action | null>(null)
  const [result, setResult] = useState<string | null>(null)
  // Rango sobre el que se pidio el cambio. Se congela al lanzar la peticion
  // porque el cursor puede moverse mientras el modelo responde.
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [lastAction, setLastAction] = useState<Action | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false)
    setResult(null)
    setRange(null)
    setBusy(null)
    setLastAction(null)
  }

  async function run(action: Action) {
    const { from, to } = editor.state.selection
    const hasSelection = from !== to
    const text = hasSelection
      ? editor.state.doc.textBetween(from, to, '\n')
      : editor.getText()
    const target = hasSelection
      ? { from, to }
      : { from: 0, to: editor.state.doc.content.size }

    const clean = text.trim()
    if (!clean) {
      toast.error('No hay texto que trabajar.')
      return
    }
    if (clean.length > MAX_CHARS) {
      toast.error(`El texto es muy largo (${clean.length} caracteres). Selecciona un fragmento de máximo ${MAX_CHARS}.`)
      return
    }

    setBusy(action)
    setLastAction(action)
    setResult(null)
    setRange(target)
    try {
      const res = await fetch('/api/ai/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, text: clean }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo procesar el texto.')
      setResult(String(data.text ?? '').trim())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión con la IA.')
      setRange(null)
    } finally {
      setBusy(null)
    }
  }

  function replace() {
    if (!result || !range) return
    // El modelo responde en markdown ligero. Se convierte a HTML del editor con
    // el mismo puente que usa KERN, que ya limita etiquetas y links.
    const html = markdownToRichText(result)
    editor
      .chain()
      .focus()
      .insertContentAt(range, html)
      .run()
    close()
  }

  const label = lastAction ? OPTIONS.find((o) => o.key === lastAction)?.label : null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className={cn(className, open && 'bg-accent text-foreground')}
        title="Escribir con IA (mejorar, corregir, resumir)"
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-72 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          {!result && (
            <>
              <p className="px-3 pt-2.5 pb-1.5 text-[11px] text-muted-foreground">
                {editor.state.selection.empty
                  ? 'Se aplicará a toda la nota. Selecciona texto para trabajar solo un fragmento.'
                  : 'Se aplicará al texto seleccionado.'}
              </p>
              <div className="pb-1.5">
                {OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => run(o.key)}
                    disabled={busy !== null}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    {busy === o.key ? (
                      <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-primary" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground truncate">{o.label}</span>
                      <span className="block text-[11px] text-muted-foreground leading-tight">{o.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {result && (
            <div className="flex flex-col">
              <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-primary flex-shrink-0" />
                <span className="text-[11px] font-medium text-foreground truncate">{label}</span>
              </div>
              <div className="mx-3 mb-2 max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 px-2.5 py-2">
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{result}</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 pb-3">
                <button
                  type="button"
                  onClick={replace}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  <Check size={13} />
                  Reemplazar
                </button>
                <button
                  type="button"
                  onClick={() => lastAction && run(lastAction)}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                  title="Pedir otra versión"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  Otra
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X size={13} />
                  Descartar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
