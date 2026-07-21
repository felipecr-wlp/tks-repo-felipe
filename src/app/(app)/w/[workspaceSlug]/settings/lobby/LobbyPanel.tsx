'use client'

/**
 * Panel de la sala de espera. Por cada usuario en espera, el admin elige rol,
 * departamento (opcional) y equipo (opcional) y lo ubica en este workspace.
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Lock, UserCheck, DoorOpen, Building2, PawPrint, Sparkles } from 'lucide-react'

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
    <div className="space-y-6">
      <LobbyEntrance workspaceName={workspaceName} waiting={waiting.length} />

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

/**
 * Entrada del "edificio": dos puertas que se abren al cargar y revelan al husky
 * dando la bienvenida (bob + saludo + globo de diálogo). Puro CSS, sin libs.
 * Respeta prefers-reduced-motion (las animaciones se desactivan).
 */
function LobbyEntrance({ workspaceName, waiting }: { workspaceName: string; waiting: number }) {
  return (
    <div className="lobby-entrance relative overflow-hidden rounded-2xl border border-border">
      {/* Fondo del vestíbulo */}
      <div className="lobby-bg absolute inset-0" />
      {/* Tapete de bienvenida */}
      <div className="lobby-mat absolute left-1/2 bottom-0 -translate-x-1/2" />

      {/* Contenido revelado detrás de las puertas */}
      <div className="lobby-reveal relative z-10 flex flex-col items-center text-center gap-2 px-6 pt-8 pb-10">
        <div className="lobby-husky-stage relative">
          <div className="lobby-bubble">
            <Sparkles size={12} className="inline-block -mt-0.5 mr-1" />
            ¡Bienvenido!
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatars/husky.png"
            alt="Husky de bienvenida"
            width={112}
            height={112}
            className="lobby-husky w-28 h-28 object-contain drop-shadow-lg"
          />
          <div className="lobby-shadow" />
        </div>

        <h2 className="text-lg font-semibold text-foreground mt-1">
          Bienvenido al lobby de {workspaceName}
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Esta es la entrada del edificio. Aquí recibes a la gente nueva y le das
          su lugar: rol, departamento y equipo. El husky vigila la puerta.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
            <DoorOpen size={13} /> Recepción abierta
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
            <Building2 size={13} /> {workspaceName}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">
            <PawPrint size={13} />
            {waiting > 0
              ? `${waiting} ${waiting === 1 ? 'persona esperando' : 'personas esperando'}`
              : 'Sin fila en la puerta'}
          </span>
        </div>
      </div>

      {/* Puertas que se abren al montar */}
      <div className="lobby-door lobby-door-left absolute inset-y-0 left-0 w-1/2 z-20" aria-hidden="true">
        <span className="lobby-handle lobby-handle-left" />
      </div>
      <div className="lobby-door lobby-door-right absolute inset-y-0 right-0 w-1/2 z-20" aria-hidden="true">
        <span className="lobby-handle lobby-handle-right" />
      </div>

      <style jsx>{`
        .lobby-entrance {
          min-height: 260px;
        }
        .lobby-bg {
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(37, 99, 235, 0.12), transparent 60%),
            linear-gradient(180deg, hsl(var(--muted) / 0.5), hsl(var(--card)));
        }
        /* Tapete de bienvenida (trapecio en perspectiva) */
        .lobby-mat {
          width: 190px;
          height: 46px;
          background: linear-gradient(180deg, #fed500, #f5c400);
          clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%);
          opacity: 0.85;
          box-shadow: 0 -1px 0 rgba(0, 0, 0, 0.05) inset;
        }
        .lobby-reveal {
          animation: lobby-fade 0.6s ease 0.75s both;
        }
        /* Husky: bob suave continuo + entrada con salto */
        .lobby-husky {
          transform-origin: 50% 90%;
          animation:
            lobby-drop 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.85s both,
            lobby-bob 2.8s ease-in-out 1.6s infinite;
        }
        .lobby-shadow {
          position: absolute;
          left: 50%;
          bottom: -6px;
          width: 74px;
          height: 12px;
          transform: translateX(-50%);
          background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.22), transparent 70%);
          animation: lobby-shadow 2.8s ease-in-out 1.6s infinite;
        }
        /* Globo de diálogo */
        .lobby-bubble {
          position: absolute;
          top: -6px;
          right: -14px;
          z-index: 2;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 600;
          color: #fff;
          background: #2563eb;
          border-radius: 9999px;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
          animation: lobby-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.8s both;
        }
        .lobby-bubble::after {
          content: '';
          position: absolute;
          left: 14px;
          bottom: -4px;
          width: 8px;
          height: 8px;
          background: #2563eb;
          transform: rotate(45deg);
          border-radius: 1px;
        }
        /* Puertas de vidrio con marco */
        .lobby-door {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04)),
            linear-gradient(115deg, #cbd5e1, #94a3b8);
          border: 2px solid rgba(148, 163, 184, 0.7);
        }
        :global(.dark) .lobby-door {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)),
            linear-gradient(115deg, #334155, #1e293b);
          border-color: rgba(51, 65, 85, 0.9);
        }
        .lobby-door-left {
          border-right-width: 1px;
          transform-origin: left center;
          animation: lobby-open-left 1s cubic-bezier(0.7, 0, 0.3, 1) 0.2s forwards;
        }
        .lobby-door-right {
          border-left-width: 1px;
          transform-origin: right center;
          animation: lobby-open-right 1s cubic-bezier(0.7, 0, 0.3, 1) 0.2s forwards;
        }
        .lobby-handle {
          position: absolute;
          top: 50%;
          width: 6px;
          height: 44px;
          border-radius: 9999px;
          background: linear-gradient(180deg, #e2e8f0, #94a3b8);
          transform: translateY(-50%);
        }
        .lobby-handle-left { right: 8px; }
        .lobby-handle-right { left: 8px; }

        @keyframes lobby-open-left {
          to { transform: perspective(900px) rotateY(-105deg); }
        }
        @keyframes lobby-open-right {
          to { transform: perspective(900px) rotateY(105deg); }
        }
        @keyframes lobby-fade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes lobby-drop {
          0% { opacity: 0; transform: translateY(-28px) scale(0.9); }
          60% { transform: translateY(4px) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes lobby-bob {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-7px) rotate(2deg); }
        }
        @keyframes lobby-shadow {
          0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.55; }
          50% { transform: translateX(-50%) scaleX(0.82); opacity: 0.35; }
        }
        @keyframes lobby-pop {
          from { opacity: 0; transform: scale(0.4) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lobby-door-left, .lobby-door-right,
          .lobby-reveal, .lobby-husky, .lobby-shadow, .lobby-bubble {
            animation: none !important;
          }
          .lobby-door-left { transform: perspective(900px) rotateY(-105deg); }
          .lobby-door-right { transform: perspective(900px) rotateY(105deg); }
          .lobby-reveal { opacity: 1; transform: none; }
        }
      `}</style>
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
