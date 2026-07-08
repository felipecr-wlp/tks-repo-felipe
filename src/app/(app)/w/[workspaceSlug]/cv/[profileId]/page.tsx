/**
 * CV interno de un perfil: historial de proyectos + reputacion agregada.
 *
 * Pieza central de la nueva logica: cada quien va construyendo un CV con los
 * proyectos en los que ha participado (rol, titulo, contribucion) y una
 * reputacion agregada por sus compañeros, SIEMPRE con k-anonimato (promedios
 * solo a partir de 3 evaluaciones; debajo del umbral solo se ve el conteo).
 *
 * Cuando el visitante ve SU PROPIO CV, cada proyecto ofrece "Calificar
 * compañeros" (modal anonimo). En CVs ajenos esa accion no aparece.
 *
 * Server component: resuelve workspace por membresia (anti-RLS-loop) y usa el
 * admin client para leer el CV (es interno a la organizacion, por diseno).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Crown, FolderGit2, Star, ShieldCheck, Award } from 'lucide-react'
import { CvProjects, type CvProject } from './CvProjects'

interface PageProps {
  params: { workspaceSlug: string; profileId: string }
}

type Reputation = {
  review_count: number
  avg_collaboration: number | null
  avg_quality: number | null
  avg_reliability: number | null
  avg_communication: number | null
  avg_overall: number | null
}

export default async function CvPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Perfil base
  type ProfileRow = { id: string; display_name: string | null; avatar_url: string | null; email: string | null }
  const { data: profile } = await admin
    .from('profiles')
    .select('id, display_name, avatar_url, email')
    .eq('id', params.profileId)
    .maybeSingle() as { data: ProfileRow | null }
  if (!profile) notFound()

  // Historial de proyectos (membresias enriquecidas con el proyecto)
  type MembershipRow = {
    role: string
    title: string | null
    contribution: string | null
    joined_at: string
    project: { id: string; name: string; icon: string | null; is_archived: boolean; status: string | null; lead_id: string | null } | null
  }
  const { data: memberships } = await admin
    .from('project_members')
    .select('role, title, contribution, joined_at, project:projects!project_members_project_id_fkey(id, name, icon, is_archived, status, lead_id)')
    .eq('profile_id', params.profileId)
    .order('joined_at', { ascending: false }) as { data: MembershipRow[] | null }

  const projects: CvProject[] = (memberships ?? [])
    .filter(m => m.project)
    .map(m => ({
      id:           m.project!.id,
      name:         m.project!.name,
      icon:         m.project!.icon,
      status:       m.project!.status,
      is_archived:  m.project!.is_archived,
      role:         m.role,
      title:        m.title,
      contribution: m.contribution,
      joined_at:    m.joined_at,
      is_lead:      m.project!.lead_id === params.profileId,
    }))

  // Reputacion agregada (k-anonimato dentro de la funcion). RPC devuelve 1 fila.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: repRows } = await (admin as any)
    .rpc('profile_reputation', { p_profile_id: params.profileId }) as { data: Reputation[] | null }
  const reputation: Reputation = repRows?.[0] ?? {
    review_count: 0,
    avg_collaboration: null, avg_quality: null, avg_reliability: null,
    avg_communication: null, avg_overall: null,
  }

  const stats = {
    total_projects: projects.length,
    leading:        projects.filter(p => p.is_lead).length,
    active:         projects.filter(p => !p.is_archived).length,
  }

  const isOwn = user.id === params.profileId
  const name = profile.display_name ?? profile.email ?? 'Perfil'

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <Link href={`/w/${params.workspaceSlug}/projects`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-3.5 h-3.5" /> Proyectos abiertos
      </Link>

      {/* ── Encabezado del perfil ─────────────────────────────── */}
      <div className="flex items-center gap-4">
        <Avatar url={profile.avatar_url} name={name} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground truncate">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {isOwn ? 'Tu CV interno de proyectos' : 'CV interno de proyectos'}
          </p>
        </div>
      </div>

      {/* ── Stats rapidas ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<FolderGit2 className="w-4 h-4" />} label="Proyectos" value={stats.total_projects} />
        <StatCard icon={<Crown className="w-4 h-4" />} label="Como líder" value={stats.leading} />
        <StatCard icon={<Star className="w-4 h-4" />} label="Activos" value={stats.active} />
      </div>

      {/* ── Reputacion agregada (k-anonimato) ─────────────────── */}
      <ReputationPanel reputation={reputation} />

      {/* ── Historial de proyectos + calificar compañeros ─────── */}
      <CvProjects projects={projects} isOwn={isOwn} />
    </div>
  )
}

/** Nivel derivado del score global (1..5). Solo lucide + acentos correctos. */
function levelFor(score: number): { label: string; className: string } {
  if (score >= 4.5) return { label: 'Excepcional',    className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' }
  if (score >= 4.0) return { label: 'Sólido',         className: 'bg-primary/10 text-primary border-primary/20' }
  if (score >= 3.0) return { label: 'En desarrollo',  className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' }
  return { label: 'Necesita apoyo', className: 'bg-red-500/10 text-red-600 border-red-500/20' }
}

function ReputationPanel({ reputation }: { reputation: Reputation }) {
  const enough = reputation.review_count >= 3

  // Score global = promedio de los 4 ejes (usa avg_overall del RPC; si viniera
  // null, promedia los ejes disponibles como respaldo).
  const axisVals = [
    reputation.avg_collaboration, reputation.avg_quality,
    reputation.avg_reliability, reputation.avg_communication,
  ].filter((v): v is number => v != null)
  const overall = reputation.avg_overall
    ?? (axisVals.length ? axisVals.reduce((a, b) => a + b, 0) / axisVals.length : null)

  const level = overall != null ? levelFor(overall) : null
  const rounded = overall != null ? Math.round(overall) : 0

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Reputación de compañeros</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {reputation.review_count} evaluación{reputation.review_count !== 1 ? 'es' : ''}
        </span>
      </div>

      {enough && overall != null && level ? (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,180px)_1fr] items-stretch">
          {/* Score global */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-gradient-to-b from-primary/5 to-transparent px-4 py-5 text-center">
            <p className="text-4xl font-bold text-foreground tabular-nums leading-none">{overall.toFixed(1)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">de 5.0</p>
            <div className="flex items-center gap-0.5 mt-2.5" aria-hidden>
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} className={`w-3.5 h-3.5 ${n <= rounded ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
              ))}
            </div>
            <span className={`mt-3 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border ${level.className}`}>
              <Award className="w-3 h-3" /> {level.label}
            </span>
          </div>

          {/* Barras por eje */}
          <div className="flex flex-col justify-center gap-3">
            <AxisBar label="Colaboración"  value={reputation.avg_collaboration} />
            <AxisBar label="Calidad"       value={reputation.avg_quality} />
            <AxisBar label="Confiabilidad" value={reputation.avg_reliability} />
            <AxisBar label="Comunicación"  value={reputation.avg_communication} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <p className="text-sm text-muted-foreground">
            Se necesitan al menos 3 evaluaciones para mostrar promedios. Así se protege el anonimato de quien califica.
          </p>
          {reputation.review_count > 0 && (
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">
              {reputation.review_count} de 3 evaluaciones recibidas.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** Barra horizontal de un eje (0..5). */
function AxisBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0
  const pct = Math.max(0, Math.min(100, (v / 5) * 100))
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{value != null ? value.toFixed(1) : '·'}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="w-16 h-16 rounded-full object-cover flex-shrink-0" />
  }
  return (
    <span className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl font-medium text-muted-foreground flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
