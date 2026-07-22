'use client'

/* Panel admin de la Academia: aprobar solicitudes, ver la matriz de acceso y
   certificados, y asignar acceso directo por persona/curso. */
import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X, Award, UserPlus, Trash2 } from 'lucide-react'

interface Profile {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
}
interface PendingReq {
  id: string
  courseId: string
  note: string | null
  createdAt: string
  profile: Profile
}
interface MatrixRow {
  profile: Profile
  access: string[]
  certified: string[]
}
interface Member {
  id: string
  display_name: string
  email: string
  avatar_url: string | null
}
interface CourseLite {
  id: string
  title: string
  track: string
}

function initials(name: string | null | undefined) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function AcademyAdminPanel({
  workspaceId,
  pending,
  matrix,
  members,
  courses,
}: {
  workspaceId: string
  pending: PendingReq[]
  matrix: MatrixRow[]
  members: Member[]
  courses: CourseLite[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [selMember, setSelMember] = useState('')
  const [selCourse, setSelCourse] = useState('')
  const courseTitle = (id: string) => courses.find((c) => c.id === id)?.title ?? id

  async function decide(requestId: string, action: 'approve' | 'reject') {
    setBusy(requestId + action)
    try {
      const res = await fetch(`/api/academy/access/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, workspaceId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Error')
      }
      toast.success(action === 'approve' ? 'Acceso concedido' : 'Solicitud rechazada')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(null)
    }
  }

  async function grant(profileId: string, courseId: string, action: 'grant' | 'revoke') {
    if (!profileId || !courseId) {
      toast.error('Elige persona y curso')
      return
    }
    setBusy(profileId + courseId + action)
    try {
      const res = await fetch('/api/academy/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, courseId, action }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Error')
      }
      toast.success(action === 'grant' ? 'Acceso asignado' : 'Acceso revocado')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(null)
    }
  }

  const Avatar = ({ p }: { p: Profile }) =>
    p.avatar_url ? (
      <Image
        src={p.avatar_url}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 rounded-full object-cover"
      />
    ) : (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
        {initials(p.display_name || p.email)}
      </span>
    )

  return (
    <div className="space-y-8 py-4">
      {/* Solicitudes pendientes */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Solicitudes pendientes {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No hay solicitudes pendientes.
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <Avatar p={r.profile} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {r.profile.display_name || r.profile.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Solicita: <span className="font-medium">{courseTitle(r.courseId)}</span>
                    {r.note ? ` · "${r.note}"` : ''}
                  </p>
                </div>
                <button
                  onClick={() => decide(r.id, 'approve')}
                  disabled={busy === r.id + 'approve'}
                  className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> Aprobar
                </button>
                <button
                  onClick={() => decide(r.id, 'reject')}
                  disabled={busy === r.id + 'reject'}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Rechazar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Asignacion directa */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Asignar acceso directo
        </h2>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <select
            value={selMember}
            onChange={(e) => setSelMember(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Persona...</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
          <select
            value={selCourse}
            onChange={(e) => setSelCourse(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Curso...</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => grant(selMember, selCourse, 'grant')}
            disabled={busy === selMember + selCourse + 'grant'}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Asignar
          </button>
        </div>
      </section>

      {/* Matriz de acceso */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quién tiene acceso
        </h2>
        {matrix.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nadie tiene acceso asignado todavía.
          </p>
        ) : (
          <div className="space-y-2">
            {matrix.map((row) => (
              <div key={row.profile.id} className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-3">
                  <Avatar p={row.profile} />
                  <p className="text-sm font-medium text-foreground">
                    {row.profile.display_name || row.profile.email}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {row.access.map((cid) => {
                    const certified = row.certified.includes(cid)
                    return (
                      <span
                        key={cid}
                        className="group inline-flex items-center gap-1 rounded-full border border-border bg-background py-1 pl-2.5 pr-1 text-xs text-foreground"
                      >
                        {certified && <Award className="h-3 w-3 text-emerald-500" />}
                        {courseTitle(cid)}
                        <button
                          onClick={() => grant(row.profile.id, cid, 'revoke')}
                          disabled={busy === row.profile.id + cid + 'revoke'}
                          title="Revocar acceso"
                          className="rounded-full p-0.5 text-muted-foreground opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
