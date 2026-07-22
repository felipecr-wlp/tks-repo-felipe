/**
 * Capa de acceso a datos de la Academia (server-only).
 *
 * El contenido de los cursos vive en `courses.ts` (codigo). Aqui solo se leen y
 * escriben los datos DINAMICOS por persona en Supabase: acceso, solicitudes,
 * progreso y certificados. Se usa el admin client (bypassa RLS) con checks
 * explicitos, igual que el resto de /api y los helpers de workspace.
 */
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { COURSES, COURSE_BY_ID } from './courses'
import type {
  AcademyAccess,
  AcademyAccessRequest,
  AcademyProgress,
  AcademyCertificate,
  Course,
} from './types'

/** True si el usuario es admin/owner de la organizacion (gobierna la academia). */
export async function isOrgAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null }
  return data?.org_role === 'owner' || data?.org_role === 'admin'
}

export interface CourseState {
  course: Course
  hasAccess: boolean
  requestStatus: 'none' | 'pending' | 'rejected'
  completedModules: number
  totalModules: number
  certified: boolean
  progressPct: number
}

/**
 * Estado de la academia para UN usuario: por cada curso, si tiene acceso, su
 * solicitud, cuantos modulos completo y si esta certificado. Para admins todos
 * los cursos aparecen con acceso (pueden entrar a revisar cualquiera).
 */
export const getUserAcademy = cache(async (userId: string): Promise<CourseState[]> => {
  const admin = createAdminClient()
  const orgAdmin = await isOrgAdmin(userId)

  const [{ data: access }, { data: requests }, { data: progress }, { data: certs }] =
    await Promise.all([
      admin.from('academy_access').select('course_id').eq('profile_id', userId),
      admin
        .from('academy_access_requests')
        .select('course_id, status')
        .eq('profile_id', userId),
      admin
        .from('academy_progress')
        .select('course_id, module_id, completed')
        .eq('profile_id', userId),
      admin.from('academy_certificates').select('course_id').eq('profile_id', userId),
    ])

  const accessSet = new Set((access ?? []).map((r: { course_id: string }) => r.course_id))
  const reqMap = new Map(
    (requests ?? []).map((r: { course_id: string; status: string }) => [r.course_id, r.status]),
  )
  const certSet = new Set((certs ?? []).map((r: { course_id: string }) => r.course_id))
  const doneByCourse = new Map<string, Set<string>>()
  for (const p of (progress ?? []) as Array<{
    course_id: string
    module_id: string
    completed: boolean
  }>) {
    if (!p.completed) continue
    const s = doneByCourse.get(p.course_id) ?? new Set<string>()
    s.add(p.module_id)
    doneByCourse.set(p.course_id, s)
  }

  return COURSES.map((course) => {
    const hasAccess = orgAdmin || accessSet.has(course.id)
    const totalModules = course.modules.length
    const completedModules = doneByCourse.get(course.id)?.size ?? 0
    const rawStatus = reqMap.get(course.id)
    const requestStatus: CourseState['requestStatus'] =
      rawStatus === 'pending' ? 'pending' : rawStatus === 'rejected' ? 'rejected' : 'none'
    return {
      course,
      hasAccess,
      requestStatus,
      completedModules,
      totalModules,
      certified: certSet.has(course.id),
      progressPct: totalModules ? Math.round((completedModules / totalModules) * 100) : 0,
    }
  })
})

/** True si el usuario puede entrar a un curso (acceso concedido o admin). */
export async function canAccessCourse(userId: string, courseId: string): Promise<boolean> {
  if (!COURSE_BY_ID[courseId]) return false
  if (await isOrgAdmin(userId)) return true
  const admin = createAdminClient()
  const { data } = await admin
    .from('academy_access')
    .select('id')
    .eq('profile_id', userId)
    .eq('course_id', courseId)
    .maybeSingle()
  return Boolean(data)
}

/** Progreso por modulo de un usuario en un curso (module_id -> fila). */
export async function getCourseProgress(
  userId: string,
  courseId: string,
): Promise<Record<string, AcademyProgress>> {
  const admin = createAdminClient()
  const { data } = (await admin
    .from('academy_progress')
    .select('*')
    .eq('profile_id', userId)
    .eq('course_id', courseId)) as { data: AcademyProgress[] | null }
  const map: Record<string, AcademyProgress> = {}
  for (const row of data ?? []) map[row.module_id] = row
  return map
}

/** Certificado de un usuario para un curso, o null. */
export async function getCertificate(
  userId: string,
  courseId: string,
): Promise<AcademyCertificate | null> {
  const admin = createAdminClient()
  const { data } = (await admin
    .from('academy_certificates')
    .select('*')
    .eq('profile_id', userId)
    .eq('course_id', courseId)
    .maybeSingle()) as { data: AcademyCertificate | null }
  return data
}

/* ── Admin: listado global de gestion ─────────────────────────────────────── */

export interface AdminAcademyRow {
  profile: { id: string; display_name: string | null; avatar_url: string | null; email: string | null }
  access: string[]
  certified: string[]
}

/** Solicitudes pendientes con datos de la persona (para el panel admin). */
export async function listPendingRequests(): Promise<
  Array<AcademyAccessRequest & { profile: AdminAcademyRow['profile'] }>
> {
  const admin = createAdminClient()
  const { data } = (await admin
    .from('academy_access_requests')
    .select(
      'id, profile_id, course_id, status, note, decided_by, decided_at, created_at, profile:profiles!academy_access_requests_profile_id_fkey ( id, display_name, avatar_url, email )',
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })) as {
    data: Array<AcademyAccessRequest & { profile: AdminAcademyRow['profile'] }> | null
  }
  return data ?? []
}

/** Toda la matriz de acceso + certificados por persona (panel admin). */
export async function listAccessMatrix(): Promise<AdminAcademyRow[]> {
  const admin = createAdminClient()
  const [{ data: access }, { data: certs }] = await Promise.all([
    admin
      .from('academy_access')
      .select(
        'course_id, profile:profiles!academy_access_profile_id_fkey ( id, display_name, avatar_url, email )',
      ),
    admin.from('academy_certificates').select('course_id, profile_id'),
  ])
  const byId = new Map<string, AdminAcademyRow>()
  for (const a of (access ?? []) as Array<{
    course_id: string
    profile: AdminAcademyRow['profile'] | null
  }>) {
    if (!a.profile) continue
    const row = byId.get(a.profile.id) ?? { profile: a.profile, access: [], certified: [] }
    row.access.push(a.course_id)
    byId.set(a.profile.id, row)
  }
  const certByProfile = new Map<string, string[]>()
  for (const c of (certs ?? []) as Array<{ course_id: string; profile_id: string }>) {
    const arr = certByProfile.get(c.profile_id) ?? []
    arr.push(c.course_id)
    certByProfile.set(c.profile_id, arr)
  }
  for (const [pid, list] of certByProfile) {
    const row = byId.get(pid)
    if (row) row.certified = list
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.profile.display_name ?? '').localeCompare(b.profile.display_name ?? ''),
  )
}

export type { AcademyAccess }
