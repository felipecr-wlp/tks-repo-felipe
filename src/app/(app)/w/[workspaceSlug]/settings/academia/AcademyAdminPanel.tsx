'use client'

/* Panel admin de la Academia: aprobar solicitudes, asignar acceso por persona
   (toggles por curso + presets por rol) y ver la matriz de quien tiene que. */
import { useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X, Award, Trash2, Inbox, GraduationCap, Users, Layers } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useT } from '@/lib/i18n/LanguageProvider'

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
interface Preset {
  key: string
  label: string
  courseIds: string[]
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
  presets,
}: {
  workspaceId: string
  pending: PendingReq[]
  matrix: MatrixRow[]
  members: Member[]
  courses: CourseLite[]
  presets: Preset[]
}) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [selMember, setSelMember] = useState('')
  const courseTitle = (id: string) => courses.find((c) => c.id === id)?.title ?? id
  const allCourseIds = useMemo(() => courses.map((c) => c.id), [courses])

  // Accesos y certificados por persona (derivados de la matriz).
  const accessByProfile = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const row of matrix) m.set(row.profile.id, new Set(row.access))
    return m
  }, [matrix])
  const certByProfile = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const row of matrix) m.set(row.profile.id, new Set(row.certified))
    return m
  }, [matrix])

  // Cursos agrupados por track (respetando el orden de aparicion).
  const groupedCourses = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, CourseLite[]>()
    for (const c of courses) {
      if (!map.has(c.track)) {
        map.set(c.track, [])
        order.push(c.track)
      }
      map.get(c.track)!.push(c)
    }
    return order.map((track) => ({ track, items: map.get(track)! }))
  }, [courses])

  const selAccess = selMember ? accessByProfile.get(selMember) ?? new Set<string>() : new Set<string>()
  const selCerts = selMember ? certByProfile.get(selMember) ?? new Set<string>() : new Set<string>()
  const selMemberObj = members.find((m) => m.id === selMember)

  async function decide(requestId: string, action: 'approve' | 'reject') {
    setBusy(true)
    try {
      const res = await fetch(`/api/academy/access/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, workspaceId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('acadA.error'))
      }
      toast.success(action === 'approve' ? t('acadA.accessGranted') : t('acadA.requestRejected'))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('acadA.error'))
    } finally {
      setBusy(false)
    }
  }

  async function grant(profileId: string, courseIds: string[], action: 'grant' | 'revoke') {
    if (!profileId) {
      toast.error(t('acadA.choosePersonFirst'))
      return
    }
    if (courseIds.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/academy/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, courseIds, action }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('acadA.error'))
      }
      const n = courseIds.length
      toast.success(
        action === 'grant'
          ? n === 1
            ? t('acadA.accessAssigned')
            : `${n} ${t('acadA.coursesAssignedSuffix')}`
          : n === 1
            ? t('acadA.accessRevoked')
            : `${n} ${t('acadA.accessesRevokedSuffix')}`,
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('acadA.error'))
    } finally {
      setBusy(false)
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
          {t('acadA.pendingRequests')} {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            compact
            icon={<Inbox className="h-5 w-5" />}
            title={t('acadA.noPendingTitle')}
            description={t('acadA.noPendingDesc')}
          />
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
                    {t('acadA.requests')} <span className="font-medium">{courseTitle(r.courseId)}</span>
                    {r.note ? ` · "${r.note}"` : ''}
                  </p>
                </div>
                <button
                  onClick={() => decide(r.id, 'approve')}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> {t('acadA.approve')}
                </button>
                <button
                  onClick={() => decide(r.id, 'reject')}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> {t('acadA.reject')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Asignar acceso por persona */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Users className="h-4 w-4" /> {t('acadA.assignByPerson')}
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('acadA.assignByPersonDesc')}
        </p>

        <div className="rounded-xl border border-border bg-card p-3">
          <select
            value={selMember}
            onChange={(e) => setSelMember(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('acadA.selectPerson')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
                {m.email ? ` (${m.email})` : ''}
              </option>
            ))}
          </select>

          {!selMember ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('acadA.selectPersonHint')}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {/* Presets por rol */}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" /> {t('acadA.applyRole')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => grant(selMember, p.courseIds, 'grant')}
                      disabled={busy}
                      title={p.courseIds.map(courseTitle).join(', ')}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      + {p.label}
                      <span className="ml-1 text-muted-foreground">({p.courseIds.length})</span>
                    </button>
                  ))}
                  <button
                    onClick={() => grant(selMember, allCourseIds, 'revoke')}
                    disabled={busy || selAccess.size === 0}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    {t('acadA.removeAll')}
                  </button>
                </div>
              </div>

              {/* Cursos por track (toggles) */}
              <div className="space-y-3">
                {groupedCourses.map(({ track, items }) => (
                  <div key={track}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {track}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((c) => {
                        const has = selAccess.has(c.id)
                        const certified = selCerts.has(c.id)
                        return (
                          <button
                            key={c.id}
                            onClick={() => grant(selMember, [c.id], has ? 'revoke' : 'grant')}
                            disabled={busy}
                            className={
                              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ' +
                              (has
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground')
                            }
                          >
                            {has ? <Check className="h-3.5 w-3.5" /> : null}
                            {c.title}
                            {certified && <Award className="h-3 w-3 text-emerald-500" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {selMemberObj && (
                <p className="text-xs text-muted-foreground">
                  {selAccess.size === 0
                    ? `${selMemberObj.display_name} ${t('acadA.noCoursesAssigned')}`
                    : `${selMemberObj.display_name} ${t('acadA.hasPrefix')} ${selAccess.size} ${selAccess.size === 1 ? t('acadA.courseOne') : t('acadA.courseMany')}`}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Matriz de acceso */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('acadA.whoHasAccess')}
        </h2>
        {matrix.length === 0 ? (
          <EmptyState
            compact
            icon={<GraduationCap className="h-5 w-5" />}
            title={t('acadA.noAccessTitle')}
            description={t('acadA.noAccessDesc')}
          />
        ) : (
          <div className="space-y-2">
            {matrix.map((row) => (
              <div key={row.profile.id} className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-3">
                  <Avatar p={row.profile} />
                  <p className="text-sm font-medium text-foreground">
                    {row.profile.display_name || row.profile.email}
                  </p>
                  <button
                    onClick={() => setSelMember(row.profile.id)}
                    className="ml-auto text-xs font-medium text-primary hover:underline"
                  >
                    {t('acadA.edit')}
                  </button>
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
                          onClick={() => grant(row.profile.id, [cid], 'revoke')}
                          disabled={busy}
                          title={t('acadA.revokeAccess')}
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
