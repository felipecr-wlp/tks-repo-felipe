'use client'

/**
 * "Agregar existente", trae al departamento del equipo notas que YA existen.
 *
 * Por que hace falta: hasta ahora la carpeta del equipo solo se podia llenar
 * creando documentos desde cero. Pero la regla del equipo casi nunca nace ahi:
 * alguien ya la escribio como nota suelta y solo hay que ponerla donde el
 * equipo la vea. Sin esto, la unica salida era copiar y pegar, que duplica el
 * documento y parte la historia en dos.
 *
 * No hay endpoint nuevo ni permiso nuevo: mover una nota a un departamento es
 * exactamente el PATCH que ya existe (`space_id` + `visibility: 'space'`), con
 * su propia barrera de reestructuracion en el servidor (autor o admin). Aqui
 * solo se filtra la lista a lo que esa barrera va a aceptar, para no ofrecer
 * botones que terminarian en 403.
 *
 * Se MUEVE, no se copia: el documento sigue siendo uno solo y su historial de
 * versiones queda intacto.
 */
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Search, X, Loader2, FileText } from 'lucide-react'
import { NoteIcon } from '@/lib/note-icons'
import { coverTint } from '@/lib/note-cover'
import { timeAgo, cn } from '@/lib/utils'

interface Candidate {
  id: string
  title: string
  icon: string | null
  cover: string | null
  space_id: string | null
  created_by: string | null
  updated_at: string
  author: { display_name: string | null } | null
}

interface Props {
  workspaceId: string
  /** Departamento del equipo. Sin el no hay a donde mover, y el boton no se pinta. */
  spaceId: string
  spaceName: string | null
  currentUserId: string
  /** Admin de workspace u org: puede mover documentos ajenos. */
  isAdmin: boolean
  variant?: 'primary' | 'subtle'
}

export function AddExistingDocs({
  workspaceId,
  spaceId,
  spaceName,
  currentUserId,
  isAdmin,
  variant = 'subtle',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const abrir = useCallback(async () => {
    setOpen(true)
    setQuery('')
    setSelected(new Set())
    if (candidates) return
    setLoading(true)
    try {
      const res = await fetch(`/api/notes?workspace_id=${workspaceId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar la lista')
      const todas = (data.notes ?? []) as Candidate[]
      // Fuera las que ya estan aqui (no hay nada que mover) y las ajenas si no
      // se es admin: el servidor las rechazaria igual.
      setCandidates(
        todas.filter(n => n.space_id !== spaceId && (isAdmin || n.created_by === currentUserId)),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }, [candidates, workspaceId, spaceId, isAdmin, currentUserId])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function agregar() {
    if (selected.size === 0) return
    setSaving(true)
    const ids = [...selected]
    let ok = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/notes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // Mover Y abrir: una nota en el departamento pero todavia privada
          // seguiria invisible para el equipo, que es justo lo que se venia a
          // resolver.
          body: JSON.stringify({ space_id: spaceId, visibility: 'space' }),
        })
        if (res.ok) ok++
      } catch { /* se reporta abajo con el conteo */ }
    }
    setSaving(false)
    setOpen(false)
    setCandidates(null)
    setSelected(new Set())

    if (ok === ids.length) {
      toast.success(ok === 1 ? 'Documento agregado al equipo' : `${ok} documentos agregados al equipo`)
    } else if (ok === 0) {
      toast.error('No se pudo agregar. Solo el autor o un admin puede mover un documento.')
    } else {
      toast.warning(`Se agregaron ${ok} de ${ids.length}. El resto necesita permiso del autor o un admin.`)
    }
    router.refresh()
  }

  const filtradas = (candidates ?? []).filter(n =>
    query.trim() === '' || (n.title || '').toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <>
      <button
        onClick={abrir}
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium rounded-lg transition-colors',
          variant === 'primary'
            ? 'px-3 py-2 border border-border text-foreground hover:bg-accent'
            : 'px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
      >
        <Plus className="w-3.5 h-3.5" />
        Agregar existente
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-[10vh] bg-black/40"
          onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="w-full max-w-lg bg-popover border border-border rounded-xl shadow-raised overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Agregar documentos existentes</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Se mueven a {spaceName ? <strong className="text-foreground font-medium">{spaceName}</strong> : 'este departamento'} y quedan visibles para el equipo.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar por título..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded-lg outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="max-h-[45vh] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cargando documentos...
                </div>
              ) : filtradas.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <FileText className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {query.trim()
                      ? 'Ningún documento coincide con esa búsqueda.'
                      : 'No hay documentos que puedas mover aquí. Solo aparecen los que escribiste tú, salvo que seas admin.'}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtradas.map(n => {
                    const marcada = selected.has(n.id)
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => toggle(n.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
                        >
                          <span
                            className={cn(
                              'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
                              marcada ? 'bg-primary border-primary' : 'border-border',
                            )}
                          >
                            {marcada && (
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
                              </svg>
                            )}
                          </span>
                          <span
                            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-neutral-700"
                            style={{ background: coverTint(n.id, n.cover) }}
                          >
                            <NoteIcon icon={n.icon} size={14} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-foreground truncate">
                              {n.title || 'Sin título'}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {n.author?.display_name ?? 'Usuario'} · {timeAgo(n.updated_at)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/30">
              <p className="text-xs text-muted-foreground">
                {selected.size === 0 ? 'Ninguno seleccionado' : `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={agregar}
                  disabled={selected.size === 0 || saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Agregar al equipo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
