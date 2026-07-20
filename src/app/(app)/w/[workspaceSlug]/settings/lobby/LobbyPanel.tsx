'use client'

/**
 * Panel de la sala de espera. Por cada usuario en espera, el admin elige rol,
 * departamento (opcional) y equipo (opcional) y lo ubica en este workspace.
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Lock, UserCheck } from 'lucide-react'

interface WaitingUser {
  profile_id: string
  display_name: string
  email: string
  avatar_url: string | null
  created_at: string
}
interface Department {
  id: string
  name: string
  is_restricted: boolean
}
interface Team {
  id: string
  name: string
  space_id: string | null
}

const ROLES = [
  { value: 'member', label: 'Miembro' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'viewer', label: 'Solo lectura' },
]

export function LobbyPanel({
  workspaceId,
  workspaceName,
  initialWaiting,
  departments,
  teams,
}: {
  workspaceId: string
  workspaceName: string
  initialWaiting: WaitingUser[]
  departments: Department[]
  teams: Team[]
}) {
  const router = useRouter()
  const [waiting, setWaiting] = useState<WaitingUser[]>(initialWaiting)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Clock size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Sala de espera</h2>
          <p className="text-sm text-muted-foreground">
            Usuarios de tu organización que aún no tienen acceso. Ubícalos en{' '}
            <span className="font-medium text-foreground">{workspaceName}</span>,
            un departamento y un equipo.
          </p>
        </div>
      </div>

      {waiting.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-10 text-center">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-muted text-muted-foreground mb-3">
            <UserCheck size={20} />
          </div>
          <p className="text-sm font-medium text-foreground">No hay nadie esperando</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cuando alguien se registre con el dominio de tu organización aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {waiting.map((u) => (
            <LobbyRow
              key={u.profile_id}
              user={u}
              workspaceId={workspaceId}
              departments={departments}
              teams={teams}
              onPlaced={() => {
                setWaiting((prev) => prev.filter((p) => p.profile_id !== u.profile_id))
                router.refresh()
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LobbyRow({
  user,
  workspaceId,
  departments,
  teams,
  onPlaced,
}: {
  user: WaitingUser
  workspaceId: string
  departments: Department[]
  teams: Team[]
  onPlaced: () => void
}) {
  const [role, setRole] = useState('member')
  const [spaceId, setSpaceId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [saving, setSaving] = useState(false)

  // Equipos filtrados por el departamento elegido. Sin depto: solo equipos sueltos.
  const filteredTeams = useMemo(() => {
    if (!spaceId) return teams.filter((t) => !t.space_id)
    return teams.filter((t) => t.space_id === spaceId)
  }, [teams, spaceId])

  const assign = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: user.profile_id,
          role,
          space_id: spaceId || null,
          team_id: teamId || null,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Error al ubicar al usuario')
      toast.success(`${user.display_name} fue ubicado`)
      onPlaced()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
      setSaving(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold uppercase">
          {user.display_name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{user.display_name}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Rol
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={saving}
            className="px-2.5 py-1.5 text-sm text-foreground border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Departamento
          <select
            value={spaceId}
            onChange={(e) => { setSpaceId(e.target.value); setTeamId('') }}
            disabled={saving}
            className="px-2.5 py-1.5 text-sm text-foreground border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">Sin departamento</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}{d.is_restricted ? ' (aislado)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Equipo
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            disabled={saving}
            className="px-2.5 py-1.5 text-sm text-foreground border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">Sin equipo</option>
            {filteredTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between">
        {spaceId && departments.find((d) => d.id === spaceId)?.is_restricted ? (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <Lock size={12} /> Departamento aislado
          </span>
        ) : <span />}
        <button
          type="button"
          onClick={assign}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <UserCheck size={15} />
          {saving ? 'Ubicando...' : 'Ubicar'}
        </button>
      </div>
    </div>
  )
}
