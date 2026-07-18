'use client'

/**
 * TeamsPanel, lista equipos del workspace, permite renombrar, cambiar metodologia y eliminar.
 * Crear equipos usa el flujo dedicado /w/[slug]/teams/new.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { UsersRound, Plus, Pencil, Check, X } from 'lucide-react'

interface Team {
  id: string
  name: string
  slug: string
  description: string | null
  methodology: string
  member_count: number
}

export function TeamsPanel({
  workspaceSlug,
  initialTeams,
}: {
  workspaceSlug: string
  initialTeams: Team[]
}) {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>(initialTeams)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  function startEdit(t: Team) {
    setEditing(t.id)
    setDraftName(t.name)
  }

  async function saveName(t: Team) {
    const name = draftName.trim()
    if (name.length < 2) {
      toast.error('El nombre debe tener al menos 2 caracteres')
      return
    }
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      toast.success('Equipo actualizado')
      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, name } : x)))
      setEditing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function changeMethodology(t: Team, methodology: string) {
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methodology }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, methodology } : x)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function removeTeam(t: Team) {
    if (
      !(await confirmDialog({
        message: `¿Eliminar el equipo ${t.name}? Se perderá su configuración. Los proyectos asociados pueden verse afectados.`,
        destructive: true,
        confirmLabel: 'Eliminar',
      }))
    )
      return
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error al eliminar')
      }
      toast.success('Equipo eliminado')
      setTeams((prev) => prev.filter((x) => x.id !== t.id))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {teams.length} {teams.length === 1 ? 'equipo' : 'equipos'} en el workspace.
        </p>
        <Link
          href={`/w/${workspaceSlug}/teams/new`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
        >
          <Plus size={14} /> Nuevo equipo
        </Link>
      </div>

      {teams.length === 0 ? (
        <div className="bg-muted/30 border border-border rounded-lg px-4 py-10 text-center">
          <UsersRound className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Aún no hay equipos.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {teams.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <UsersRound size={15} className="text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                {editing === t.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={80}
                      className="flex-1 px-2 py-1 text-sm border border-input rounded-md bg-background"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName(t)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                    <button
                      onClick={() => saveName(t)}
                      disabled={busy === t.id}
                      className="p-1 text-primary hover:bg-accent rounded"
                      title="Guardar"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="p-1 text-muted-foreground hover:bg-accent rounded"
                      title="Cancelar"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                    <button
                      onClick={() => startEdit(t)}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      title="Renombrar"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.member_count} {t.member_count === 1 ? 'miembro' : 'miembros'} · /{t.slug}
                </p>
              </div>

              <select
                value={t.methodology}
                onChange={(e) => changeMethodology(t, e.target.value)}
                disabled={busy === t.id}
                className="px-2 py-1 text-sm border border-input rounded-lg bg-background capitalize disabled:opacity-50"
              >
                <option value="scrum">Scrum</option>
                <option value="kanban">Kanban</option>
              </select>

              <button
                onClick={() => removeTeam(t)}
                disabled={busy === t.id}
                className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-40"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
