/**
 * Tipos compartidos de la capa SCRUM (cliente + servidor).
 */
export type ScrumStatusRef = {
  id: string
  name: string
  color: string | null
  category: string
}

export type ScrumAssignee = {
  id: string
  display_name: string
  avatar_url: string | null
}

export type ScrumTask = {
  id: string
  title: string
  priority: string
  due_date: string | null
  updated_at: string
  project_id: string
  project_name: string
  sprint_id: string | null
  story_points: number | null
  story_points_done: number | null
  area: string | null
  status: ScrumStatusRef | null
  assignee: ScrumAssignee | null
}

export type ScrumSprint = {
  id: string
  name: string
  goal: string | null
  status: 'planning' | 'active' | 'completed'
  start_date: string | null
  end_date: string | null
  created_at: string
}

export type ScrumMember = ScrumAssignee & { role: string }

export type ScrumStatus = {
  id: string
  project_id: string
  name: string
  color: string | null
  category: string
  position: number
}

export const STORY_POINTS = [1, 2, 3, 5, 8, 13, 21] as const

// Columnas SCRUM normalizadas (las categorías son consistentes entre proyectos,
// los status_id no, porque cada proyecto tiene su propio set).
export const SCRUM_COLUMNS: { category: string; label: string }[] = [
  { category: 'todo', label: 'Por hacer' },
  { category: 'in_progress', label: 'En progreso' },
  { category: 'done', label: 'Hecho' },
]
