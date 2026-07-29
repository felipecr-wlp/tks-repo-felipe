/**
 * /w/[slug]/t/[teamSlug]/docs, los documentos del equipo.
 *
 * Es la carpeta del departamento del equipo vista desde el equipo. Dos bloques
 * y nada mas: lo que MANDA (reglas, procedimientos, capacitaciones) arriba, y
 * las notas sueltas abajo. El detalle de por que no hay un permiso nuevo aqui
 * esta en `src/lib/team-docs.ts`.
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveTeamForViewer } from '@/lib/team-access'
import { NoteIcon } from '@/lib/note-icons'
import { coverTint } from '@/lib/note-cover'
import { timeAgo } from '@/lib/utils'
import { BookOpen, FileText, Lock, ShieldCheck } from 'lucide-react'
import { NotesActionsBar } from '../../../notes/NotesActionsBar'
import {
  loadTeamDocs,
  isProcessDoc,
  DOC_KIND_LABEL,
  DOC_STATUS_META,
  type TeamDoc,
} from '@/lib/team-docs'

interface Props {
  params: { workspaceSlug: string; teamSlug: string }
}

export const metadata = { title: 'Documentos del equipo · WLO' }

export default async function TeamDocsPage({ params }: Props) {
  const res = await resolveTeamForViewer(params.workspaceSlug, params.teamSlug)
  if (!res.ok && res.reason === 'no-auth') redirect('/auth/login')
  if (!res.ok) notFound()
  const { userId, workspace, team } = res.ctx

  const admin = createAdminClient()

  const { data: space } = await admin
    .from('spaces')
    .select('name, is_restricted')
    .eq('id', team.space_id ?? '')
    .maybeSingle() as { data: { name: string; is_restricted: boolean } | null; error: unknown }

  const docs = await loadTeamDocs(admin, workspace.id, team.space_id, userId)
  const processes = docs.filter(isProcessDoc)
  const notes = docs.filter(d => !isProcessDoc(d))

  const teamBase = `/w/${params.workspaceSlug}/t/${params.teamSlug}`

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Link href={teamBase} className="hover:text-foreground transition-colors">
              {team.name}
            </Link>
            <span>/</span>
            <span className="text-foreground/70">Documentos</span>
          </p>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Documentos del equipo
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Reglas, procedimientos y notas que este equipo comparte.
            {space && (
              <>
                {' '}Lo que se publica aquí lo ve <strong className="text-foreground font-medium">{space.name}</strong>
                {space.is_restricted ? ' y nadie más.' : '.'}
              </>
            )}
          </p>
        </div>

        {team.space_id && (
          <div className="flex-shrink-0">
            <NotesActionsBar
              workspaceId={workspace.id}
              workspaceSlug={params.workspaceSlug}
              spaceId={team.space_id}
              label="Nuevo documento"
            />
          </div>
        )}
      </div>

      {!team.space_id ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground mb-1">
            Este equipo todavía no tiene departamento
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Los documentos se comparten por departamento. Asigna uno a este equipo
            en Configuración, Departamentos, y esta carpeta se llena sola.
          </p>
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <BookOpen className="w-9 h-9 mx-auto mb-3 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground mb-1">
            Todavía no hay nada escrito
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Empieza por lo que el equipo repite cada semana: una regla, un
            procedimiento, la forma correcta de hacer algo. Se escribe una vez y
            deja de explicarse en el chat.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <DocSection
            title="Reglas y procesos"
            hint="Lo que el equipo debe seguir. Se escribe una vez y aplica para todos."
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            docs={processes}
            workspaceSlug={params.workspaceSlug}
            emptyHint="Sin reglas ni procedimientos todavía. Créalos con la plantilla SOP."
          />
          <DocSection
            title="Notas del equipo"
            hint="Acuerdos, minutas y documentos de trabajo compartidos con el departamento."
            icon={<FileText className="w-3.5 h-3.5" />}
            docs={notes}
            workspaceSlug={params.workspaceSlug}
            emptyHint="Sin notas compartidas todavía."
          />
        </div>
      )}
    </div>
  )
}

function DocSection({
  title, hint, icon, docs, workspaceSlug, emptyHint,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  docs: TeamDoc[]
  workspaceSlug: string
  emptyHint: string
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          {icon}
          {title}
          <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
            ({docs.length})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground/80 mt-1">{hint}</p>
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg px-4 py-6 text-center">
          {emptyHint}
        </p>
      ) : (
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {docs.map(d => (
            <Link
              key={d.id}
              href={`/w/${workspaceSlug}/notes/${d.id}`}
              className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
            >
              {/* Mismo color que la portada del documento (ver note-cover.ts). */}
              <span
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-neutral-700"
                style={{ background: coverTint(d.id) }}
              >
                <NoteIcon icon={d.icon} size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {d.title || 'Sin título'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {DOC_KIND_LABEL[d.doc_kind] ?? 'Documento'}
                  {' · '}
                  {d.author?.display_name ?? 'Usuario'}
                  {' · '}
                  {timeAgo(d.updated_at)}
                </p>
              </div>
              {d.sop_status && DOC_STATUS_META[d.sop_status] && (
                <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${DOC_STATUS_META[d.sop_status].className}`}>
                  {DOC_STATUS_META[d.sop_status].label}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
