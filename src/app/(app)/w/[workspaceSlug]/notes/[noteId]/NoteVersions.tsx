'use client'

/**
 * Historial de versiones (Circuito A4). Botón en la barra de la nota que abre
 * un panel con los snapshots del contenido, cada uno con opción de restaurar.
 * Al restaurar se recarga la página para reflejar el contenido restaurado en el
 * editor (el editor es no controlado tras montar).
 */
import { useState, useCallback } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { History, RotateCcw, Loader2, X } from 'lucide-react'
import { getInitials, timeAgo } from '@/lib/utils'

interface Version {
  id: string
  title: string
  created_at: string
  editor: { display_name: string; avatar_url: string | null } | null
}

interface NoteVersionsProps {
  noteId: string
}

export function NoteVersions({ noteId }: NoteVersionsProps) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/versions`)
      if (res.ok) setVersions(await res.json())
    } catch {
      // el historial es secundario, no romper la nota
    } finally {
      setLoading(false)
    }
  }, [noteId])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) load()
  }

  async function restore(v: Version) {
    if (!confirm('¿Restaurar esta versión? El estado actual se guardará como una versión más antes de sobrescribir.')) return
    setRestoringId(v.id)
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${v.id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Versión restaurada')
      // Recargar para que el editor tome el contenido restaurado.
      window.location.reload()
    } catch {
      toast.error('Error al restaurar la versión')
      setRestoringId(null)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        title="Historial de versiones"
        className="flex items-center gap-1.5 text-xs px-2 py-1 bg-muted/50 hover:bg-muted text-foreground rounded-md transition-colors"
      >
        <History className="w-3.5 h-3.5" />
        Historial
      </button>

      {open && (
        <div className="absolute top-8 right-0 z-50 w-80 bg-popover border border-border rounded-lg shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-foreground">Historial de versiones</span>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Cerrar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {loading ? (
              <p className="text-xs text-muted-foreground px-3 py-4 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…
              </p>
            ) : versions.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-4">
                Aún no hay versiones. Se crean al editar el contenido.
              </p>
            ) : (
              versions.map((v, i) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors group"
                >
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center text-[9px] font-medium">
                    {v.editor?.avatar_url ? (
                      <Image src={v.editor.avatar_url} alt={v.editor.display_name} width={24} height={24} className="object-cover" />
                    ) : (
                      getInitials(v.editor?.display_name ?? '?')
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">
                      {v.editor?.display_name ?? 'Usuario'}
                      {i === 0 && <span className="ml-1.5 text-[10px] text-muted-foreground">(actual)</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(v.created_at)}</p>
                  </div>
                  {i !== 0 && (
                    <button
                      onClick={() => restore(v)}
                      disabled={restoringId === v.id}
                      title="Restaurar esta versión"
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all p-1 rounded hover:bg-background disabled:opacity-50"
                    >
                      {restoringId === v.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RotateCcw className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
