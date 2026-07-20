/**
 * Crear nuevo proyecto en un equipo.
 */
import { redirect, notFound } from 'next/navigation'
import { resolveTeamForViewer } from '@/lib/team-access'
import { NewProjectForm } from './NewProjectForm'

interface NewProjectPageProps {
  params: { workspaceSlug: string; teamSlug: string }
}

export const metadata = { title: 'Nuevo proyecto · WLO' }

export default async function NewProjectPage({ params }: NewProjectPageProps) {
  // Acceso: miembro del equipo O admin del workspace (empareja el sidebar).
  const res = await resolveTeamForViewer(params.workspaceSlug, params.teamSlug)
  if (!res.ok && res.reason === 'no-auth') redirect('/auth/login')
  if (!res.ok) notFound()
  const { workspace, team } = res.ctx

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-6 pt-16">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-1">
            {workspace.name} / {team.name}
          </p>
          <h1 className="text-2xl font-semibold text-foreground">Nuevo proyecto</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Los proyectos contienen tareas, notas y archivos del equipo.
          </p>
        </div>
        <NewProjectForm
          teamId={team.id}
          workspaceSlug={params.workspaceSlug}
          teamSlug={params.teamSlug}
        />
      </div>
    </div>
  )
}
