/**
 * Capacidades AGENTICAS de KERN (tool calling del Vercel AI SDK).
 *
 * Estas herramientas convierten a KERN de un chat "solo texto" en un asistente
 * que LEE y ACTUA sobre el workspace: listar proyectos, ver tus tareas, buscar,
 * crear y actualizar tareas. Cada `execute` corre en el servidor con el admin
 * client PERO re-verifica el acceso del usuario (userId) en cada llamada, igual
 * que las rutas /api. KERN nunca puede tocar datos fuera de la membresia real
 * del usuario: no hay escalada de privilegios por mas que el modelo lo intente.
 *
 * Diseno de seguridad:
 * - Toda operacion se limita a proyectos donde el usuario es project_member
 *   (o admin del workspace/org, via canAccessProject).
 * - Las escrituras reusan las mismas validaciones que las rutas HTTP
 *   (canAccessProject, isAssignableToProject).
 * - Los resultados son JSON serializable y acotados (limit) para no inflar el
 *   contexto ni el costo del LLM.
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'
import { canAccessProject, isAssignableToProject } from '@/lib/team-access'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { autoWatch } from '@/lib/watchers'
import { sanitizeRichText } from '@/lib/sanitize'
import { markdownToRichText } from '@/lib/ai/markdown-to-rich'
import { loadNoteViewerContext, canViewNote, noteVisibilityPrefilter } from '@/lib/note-visibility'

type Admin = ReturnType<typeof createAdminClient>

const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const
const DOC_KINDS = ['note', 'sop', 'sop_flow', 'sop_index', 'training'] as const

/** Workspaces del usuario. Base para todo lo que se cree (una nota necesita uno). */
async function listUserWorkspaces(admin: Admin, userId: string) {
  const { data } = (await admin
    .from('workspace_members')
    .select('role, workspaces!inner ( id, name, slug )')
    .eq('profile_id', userId)
    .limit(20)) as {
    data: Array<{ role: string; workspaces: { id: string; name: string; slug: string } | null }> | null
    error: unknown
  }
  return (data ?? [])
    .filter(r => !!r.workspaces)
    .map(r => ({ id: r.workspaces!.id, name: r.workspaces!.name, slug: r.workspaces!.slug, role: r.role }))
}

/** Convierte el texto del modelo a HTML del editor y lo sanea antes de guardar. */
function bodyToHtml(markdown: string | undefined | null): string | null {
  if (!markdown || !markdown.trim()) return null
  return sanitizeRichText(markdownToRichText(markdown)) || null
}

/** Proyectos donde el usuario es miembro directo (base accionable de KERN). */
async function listMemberProjects(admin: Admin, userId: string) {
  const { data } = (await admin
    .from('project_members')
    .select('projects!inner ( id, name, workspace_id, is_archived, team:teams ( name ) )')
    .eq('profile_id', userId)
    .limit(100)) as {
    data:
      | Array<{
          projects: {
            id: string
            name: string
            workspace_id: string
            is_archived: boolean | null
            team: { name: string } | null
          } | null
        }>
      | null
    error: unknown
  }
  return (data ?? [])
    .map(r => r.projects)
    .filter((p): p is NonNullable<typeof p> => !!p && !p.is_archived)
    .map(p => ({ id: p.id, name: p.name, team: p.team?.name ?? null }))
}

/**
 * Contexto compacto para inyectar en el system prompt: proyectos accesibles
 * (con su id, para que KERN pueda llamar create_task/update_task sin adivinar) y
 * cuantas tareas abiertas tiene asignadas el usuario.
 */
export async function buildKernContext(admin: Admin, userId: string, displayName?: string | null) {
  const [projects, workspaces] = await Promise.all([
    listMemberProjects(admin, userId),
    listUserWorkspaces(admin, userId),
  ])

  const { count } = (await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assignee_id', userId)
    .eq('is_archived', false)) as { count: number | null }

  const projectLines = projects.length
    ? projects.map(p => `- "${p.name}"${p.team ? ` (equipo ${p.team})` : ''} [id: ${p.id}]`).join('\n')
    : '(el usuario no es miembro de ningun proyecto todavia)'

  // El workspace es obligatorio para crear una nota. Se inyecta aqui para que
  // KERN no tenga que gastar una llamada de lectura en el caso normal (una sola
  // empresa), que es el 99% de las veces.
  const workspaceLines = workspaces.length
    ? workspaces.map(w => `- "${w.name}" [id: ${w.id}]`).join('\n')
    : '(sin workspaces)'

  return `\n\nContexto del usuario ${displayName ? `(${displayName}) ` : ''}en este momento:\nWorkspaces (usa el id EXACTO al crear notas):\n${workspaceLines}\nProyectos accesibles (usa el id EXACTO al crear o mover tareas):\n${projectLines}\nTareas abiertas asignadas al usuario: ${count ?? 0}.\nNunca inventes un project_id, task_id ni note_id: si no lo tienes, usa una herramienta de lectura primero.`
}

/** Construye el set de herramientas de KERN ligado a un usuario concreto. */
export function buildKernTools(admin: Admin, userId: string) {
  return {
    list_projects: tool({
      description:
        'Lista los proyectos a los que el usuario tiene acceso, con su id y equipo. Uselo para resolver el project_id antes de crear o mover tareas.',
      parameters: z.object({}),
      execute: async () => {
        const projects = await listMemberProjects(admin, userId)
        return { projects }
      },
    }),

    list_my_tasks: tool({
      description:
        'Lista las tareas abiertas (no archivadas ni completadas) asignadas al usuario, ordenadas por fecha de vencimiento. Uselo para "mis prioridades", "que tengo pendiente", etc.',
      parameters: z.object({
        limit: z.number().int().min(1).max(50).optional().describe('Maximo de tareas a devolver (por defecto 15).'),
      }),
      execute: async ({ limit }) => {
        const { data } = (await admin
          .from('tasks')
          .select('id, title, priority, due_date, project:projects ( name ), status:task_statuses ( name, category )')
          .eq('assignee_id', userId)
          .eq('is_archived', false)
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(limit ?? 15)) as {
          data:
            | Array<{
                id: string
                title: string
                priority: string
                due_date: string | null
                project: { name: string } | null
                status: { name: string; category: string } | null
              }>
            | null
          error: unknown
        }
        const tasks = (data ?? [])
          .filter(t => t.status?.category !== 'done')
          .map(t => ({
            id: t.id,
            title: t.title,
            priority: t.priority,
            due_date: t.due_date,
            project: t.project?.name ?? null,
            status: t.status?.name ?? null,
          }))
        return { tasks }
      },
    }),

    search_tasks: tool({
      description:
        'Busca tareas por texto en el titulo dentro de los proyectos del usuario. Uselo para encontrar una tarea concreta y obtener su id.',
      parameters: z.object({
        query: z.string().min(1).max(200).describe('Texto a buscar en el titulo de la tarea.'),
        project_id: z.string().uuid().optional().describe('Limitar la busqueda a un proyecto concreto.'),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ query, project_id, limit }) => {
        const memberProjects = await listMemberProjects(admin, userId)
        const allowedIds = memberProjects.map(p => p.id)
        if (allowedIds.length === 0) return { tasks: [] }
        const scopeIds = project_id ? allowedIds.filter(id => id === project_id) : allowedIds
        if (scopeIds.length === 0) return { error: 'Sin acceso a ese proyecto.', tasks: [] }

        const { data } = (await admin
          .from('tasks')
          .select('id, title, priority, due_date, project:projects ( name ), status:task_statuses ( name )')
          .in('project_id', scopeIds)
          .eq('is_archived', false)
          .ilike('title', `%${query}%`)
          .limit(limit ?? 15)) as {
          data:
            | Array<{
                id: string
                title: string
                priority: string
                due_date: string | null
                project: { name: string } | null
                status: { name: string } | null
              }>
            | null
          error: unknown
        }
        const tasks = (data ?? []).map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_date: t.due_date,
          project: t.project?.name ?? null,
          status: t.status?.name ?? null,
        }))
        return { tasks }
      },
    }),

    create_task: tool({
      description:
        'Crea una nueva tarea en un proyecto del usuario. Requiere el project_id (usa list_projects si no lo tienes). Confirma con el usuario antes de crear si hay ambiguedad.',
      parameters: z.object({
        project_id: z.string().uuid().describe('Id del proyecto (obtenlo de list_projects).'),
        title: z.string().min(1).max(500).describe('Titulo de la tarea.'),
        priority: z.enum(PRIORITIES).optional().describe('Prioridad; por defecto none.'),
        due_date: z
          .string()
          .optional()
          .describe('Fecha de vencimiento en ISO 8601 (ej. 2026-07-30T00:00:00Z). Omitir si no aplica.'),
        assignee_id: z.string().uuid().optional().describe('Responsable; debe ser miembro del proyecto. Omitir para dejar sin asignar.'),
      }),
      execute: async ({ project_id, title, priority, due_date, assignee_id }) => {
        const { ok, workspaceId } = await canAccessProject(admin, project_id, userId)
        if (!ok || !workspaceId) return { error: 'Sin acceso a ese proyecto.' }

        if (assignee_id && !(await isAssignableToProject(admin, project_id, assignee_id))) {
          return { error: 'El responsable no pertenece al proyecto.' }
        }

        let dueIso: string | null = null
        if (due_date) {
          const d = new Date(due_date)
          if (isNaN(d.getTime())) return { error: 'Fecha invalida.' }
          dueIso = d.toISOString()
        }

        // Primer estado del proyecto (columna inicial)
        const { data: firstStatus } = (await admin
          .from('task_statuses')
          .select('id')
          .eq('project_id', project_id)
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle()) as { data: { id: string } | null; error: unknown }

        // sort_order al final de la columna
        let lastQuery = admin
          .from('tasks')
          .select('sort_order')
          .eq('project_id', project_id)
          .order('sort_order', { ascending: false })
          .limit(1)
        lastQuery = firstStatus?.id ? lastQuery.eq('status_id', firstStatus.id) : lastQuery.is('status_id', null)
        const { data: lastTask } = (await lastQuery.maybeSingle()) as { data: { sort_order: string } | null; error: unknown }

        const { generateKeyBetween } = await import('fractional-indexing')
        const sortOrder = generateKeyBetween(lastTask?.sort_order ?? null, null)

        const { data: created, error } = (await admin
          .from('tasks')
          .insert({
            project_id,
            workspace_id: workspaceId,
            title,
            status_id: firstStatus?.id ?? null,
            priority: priority ?? 'none',
            assignee_id: assignee_id ?? null,
            due_date: dueIso,
            sort_order: sortOrder,
            created_by: userId,
          })
          .select('id, title')
          .single()) as { data: { id: string; title: string } | null; error: unknown }

        if (error || !created) {
          console.error('[kern create_task] insert error:', error)
          return { error: 'No se pudo crear la tarea.' }
        }

        logActivity({
          verb: ActivityVerbs.TASK_CREATED,
          subject_id: userId,
          object_type: 'task',
          object_id: created.id,
          object_title: created.title,
          workspace_id: workspaceId,
          project_id,
          metadata: { via: 'kern' },
        }).catch(console.error)
        autoWatch(admin, created.id, project_id, userId).catch(console.error)

        return { created: { id: created.id, title: created.title } }
      },
    }),

    update_task: tool({
      description:
        'Actualiza una tarea existente por su id: titulo, prioridad, fecha de vencimiento, responsable o estado (status_id). Usa search_tasks o list_my_tasks para obtener el id. Para mover de columna necesitas el status_id destino (list_task_statuses).',
      parameters: z.object({
        task_id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        priority: z.enum(PRIORITIES).optional(),
        due_date: z.string().nullable().optional().describe('ISO 8601, o null para quitar la fecha.'),
        assignee_id: z.string().uuid().nullable().optional().describe('Id del responsable, o null para desasignar.'),
        status_id: z.string().uuid().optional().describe('Estado destino (obtenlo de list_task_statuses).'),
      }),
      execute: async ({ task_id, title, priority, due_date, assignee_id, status_id }) => {
        const { data: existing } = (await admin
          .from('tasks')
          .select('id, project_id')
          .eq('id', task_id)
          .eq('is_archived', false)
          .maybeSingle()) as { data: { id: string; project_id: string } | null; error: unknown }
        if (!existing) return { error: 'Tarea no encontrada.' }

        const { ok, workspaceId } = await canAccessProject(admin, existing.project_id, userId)
        if (!ok || !workspaceId) return { error: 'Sin acceso a esa tarea.' }

        const patch: Database['public']['Tables']['tasks']['Update'] = { updated_at: new Date().toISOString() }
        if (title !== undefined) patch.title = title
        if (priority !== undefined) patch.priority = priority
        if (due_date !== undefined) {
          if (due_date === null) patch.due_date = null
          else {
            const d = new Date(due_date)
            if (isNaN(d.getTime())) return { error: 'Fecha invalida.' }
            patch.due_date = d.toISOString()
          }
        }
        if (assignee_id !== undefined) {
          if (assignee_id !== null && !(await isAssignableToProject(admin, existing.project_id, assignee_id))) {
            return { error: 'El responsable no pertenece al proyecto.' }
          }
          patch.assignee_id = assignee_id
        }
        if (status_id !== undefined) {
          // El status_id debe pertenecer al MISMO proyecto (anti cross-proyecto).
          const { data: st } = (await admin
            .from('task_statuses')
            .select('id')
            .eq('id', status_id)
            .eq('project_id', existing.project_id)
            .maybeSingle()) as { data: { id: string } | null; error: unknown }
          if (!st) return { error: 'El estado no pertenece a ese proyecto.' }
          patch.status_id = status_id
        }

        if (Object.keys(patch).length === 1) return { error: 'No se indico ningun cambio.' }

        const { data: updated, error } = (await admin
          .from('tasks')
          .update(patch)
          .eq('id', task_id)
          .select('id, title')
          .maybeSingle()) as { data: { id: string; title: string } | null; error: unknown }
        if (error || !updated) {
          console.error('[kern update_task] update error:', error)
          return { error: 'No se pudo actualizar la tarea.' }
        }

        logActivity({
          verb: ActivityVerbs.TASK_UPDATED,
          subject_id: userId,
          object_type: 'task',
          object_id: updated.id,
          object_title: updated.title,
          workspace_id: workspaceId,
          project_id: existing.project_id,
          metadata: { via: 'kern' },
        }).catch(console.error)

        return { updated: { id: updated.id, title: updated.title } }
      },
    }),

    list_task_statuses: tool({
      description:
        'Lista las columnas/estados de un proyecto (id, nombre, categoria). Uselo para obtener el status_id destino antes de mover una tarea con update_task.',
      parameters: z.object({ project_id: z.string().uuid() }),
      execute: async ({ project_id }) => {
        const { ok } = await canAccessProject(admin, project_id, userId)
        if (!ok) return { error: 'Sin acceso a ese proyecto.', statuses: [] }
        const { data } = (await admin
          .from('task_statuses')
          .select('id, name, category, position')
          .eq('project_id', project_id)
          .order('position', { ascending: true })) as {
          data: Array<{ id: string; name: string; category: string; position: number }> | null
          error: unknown
        }
        return { statuses: (data ?? []).map(s => ({ id: s.id, name: s.name, category: s.category })) }
      },
    }),

    // ── Documentos (notas, SOPs, capacitaciones) ──────────────────────────────
    // KERN redactaba texto en el chat y ahi se quedaba: el usuario tenia que
    // copiarlo a mano a una nota. Estas herramientas cierran ese circulo. El
    // cuerpo se recibe en Markdown (lo que un modelo escribe bien) y se
    // convierte al HTML del editor en `markdown-to-rich.ts`.

    list_spaces: tool({
      description:
        'Lista los departamentos del workspace donde el usuario puede publicar un documento, con su id. Uselo antes de create_note cuando el usuario pida compartir el documento con un equipo o departamento.',
      parameters: z.object({ workspace_id: z.string().uuid() }),
      execute: async ({ workspace_id }) => {
        const { data: member } = (await admin
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', workspace_id)
          .eq('profile_id', userId)
          .maybeSingle()) as { data: { role: string } | null; error: unknown }
        if (!member) return { error: 'Sin acceso a ese workspace.', spaces: [] }

        const ctx = await loadNoteViewerContext(admin, workspace_id, userId)
        const { data } = (await admin
          .from('spaces')
          .select('id, name, is_restricted')
          .eq('workspace_id', workspace_id)
          .order('name', { ascending: true })
          .limit(60)) as {
          data: Array<{ id: string; name: string; is_restricted: boolean }> | null
          error: unknown
        }
        // Solo los que el usuario ve: publicar en un departamento restringido
        // ajeno seria filtrar informacion hacia gente que no deberia leerla.
        const spaces = (data ?? [])
          .filter(s => !ctx.blockedSpaceIds.has(s.id))
          .map(s => ({ id: s.id, name: s.name, restricted: s.is_restricted, member: ctx.spaceIds.has(s.id) }))
        return { spaces }
      },
    }),

    search_notes: tool({
      description:
        'Busca documentos y notas por texto en el titulo, dentro de lo que el usuario puede ver. Devuelve id, titulo y tipo. Uselo para obtener el note_id antes de read_note o append_to_note.',
      parameters: z.object({
        workspace_id: z.string().uuid(),
        query: z.string().min(1).max(200).describe('Texto a buscar en el titulo.'),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ workspace_id, query, limit }) => {
        const { data: member } = (await admin
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', workspace_id)
          .eq('profile_id', userId)
          .maybeSingle()) as { data: { role: string } | null; error: unknown }
        if (!member) return { error: 'Sin acceso a ese workspace.', notes: [] }

        const { data } = (await admin
          .from('notes')
          .select('id, title, doc_kind, sop_status, visibility, created_by, space_id, project_id, updated_at')
          .eq('workspace_id', workspace_id)
          .ilike('title', `%${query}%`)
          .or(noteVisibilityPrefilter(userId))
          .order('updated_at', { ascending: false })
          .limit(limit ?? 15)) as {
          data:
            | Array<{
                id: string
                title: string
                doc_kind: string
                sop_status: string | null
                visibility: string
                created_by: string | null
                space_id: string | null
                project_id: string | null
                updated_at: string
              }>
            | null
          error: unknown
        }

        const ctx = await loadNoteViewerContext(admin, workspace_id, userId)
        const notes = (data ?? [])
          .filter(n => canViewNote(ctx, n))
          .map(n => ({ id: n.id, title: n.title, doc_kind: n.doc_kind, sop_status: n.sop_status, updated_at: n.updated_at }))
        return { notes }
      },
    }),

    read_note: tool({
      description:
        'Lee el contenido de un documento por su id. Uselo para resumir, revisar o continuar un documento existente antes de modificarlo.',
      parameters: z.object({ note_id: z.string().uuid() }),
      execute: async ({ note_id }) => {
        const { data: note } = (await admin
          .from('notes')
          .select('id, workspace_id, title, content, doc_kind, sop_status, visibility, created_by, space_id, project_id')
          .eq('id', note_id)
          .maybeSingle()) as {
          data:
            | {
                id: string
                workspace_id: string
                title: string
                content: string | null
                doc_kind: string
                sop_status: string | null
                visibility: string
                created_by: string | null
                space_id: string | null
                project_id: string | null
              }
            | null
          error: unknown
        }
        if (!note) return { error: 'Documento no encontrado.' }

        const { data: member } = (await admin
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', note.workspace_id)
          .eq('profile_id', userId)
          .maybeSingle()) as { data: { role: string } | null; error: unknown }
        if (!member) return { error: 'Sin acceso a ese documento.' }

        const ctx = await loadNoteViewerContext(admin, note.workspace_id, userId)
        if (!canViewNote(ctx, note)) return { error: 'Sin acceso a ese documento.' }

        // Se entrega como texto plano: al modelo le sirve el contenido, no las
        // etiquetas, y el HTML crudo gastaria contexto de mas.
        const texto = (note.content ?? '')
          .replace(/<\/(p|h[1-6]|li|blockquote|tr)>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 12000)

        return { note: { id: note.id, title: note.title, doc_kind: note.doc_kind, sop_status: note.sop_status, content: texto } }
      },
    }),

    create_note: tool({
      description:
        'Crea un documento (nota, procedimiento/SOP, flujo o capacitacion) con su contenido ya redactado. El cuerpo se escribe en Markdown: usa ## para secciones, listas con -, listas numeradas, y "- [ ] paso" para checklists. Para un SOP usa doc_kind "sop". Si el usuario quiere que lo vea su equipo, resuelve antes el space_id con list_spaces y pasa visibility "space".',
      parameters: z.object({
        workspace_id: z.string().uuid().describe('Id del workspace (esta en tu contexto).'),
        title: z.string().min(1).max(200).describe('Titulo del documento.'),
        body_markdown: z
          .string()
          .max(60000)
          .describe('Contenido en Markdown. No repitas el titulo como encabezado: ya va en el campo title.'),
        doc_kind: z.enum(DOC_KINDS).optional().describe('Tipo de documento; por defecto "note". Un procedimiento es "sop".'),
        visibility: z
          .enum(['private', 'space', 'workspace'])
          .optional()
          .describe('Por defecto "private" (solo el usuario). "space" requiere space_id. Confirma con el usuario antes de publicar.'),
        space_id: z.string().uuid().optional().describe('Departamento destino (usa list_spaces). Obligatorio si visibility es "space".'),
      }),
      execute: async ({ workspace_id, title, body_markdown, doc_kind, visibility, space_id }) => {
        const { data: member } = (await admin
          .from('workspace_members')
          .select('role, workspaces ( slug )')
          .eq('workspace_id', workspace_id)
          .eq('profile_id', userId)
          .maybeSingle()) as { data: { role: string; workspaces: { slug: string } | null } | null; error: unknown }
        if (!member) return { error: 'Sin acceso a ese workspace.' }

        const vis = visibility ?? 'private'
        if (vis === 'space') {
          if (!space_id) return { error: 'Para publicar en un departamento hace falta space_id (usa list_spaces).' }
          const ctx = await loadNoteViewerContext(admin, workspace_id, userId)
          // Mismo criterio que canViewNote: si no puede VER ese departamento,
          // tampoco puede publicar ahi.
          if (ctx.blockedSpaceIds.has(space_id)) return { error: 'Sin acceso a ese departamento.' }
          const { data: sp } = (await admin
            .from('spaces')
            .select('id')
            .eq('id', space_id)
            .eq('workspace_id', workspace_id)
            .maybeSingle()) as { data: { id: string } | null; error: unknown }
          if (!sp) return { error: 'Ese departamento no pertenece al workspace.' }
        }

        const html = bodyToHtml(body_markdown)

        const { data: created, error } = (await admin
          .from('notes')
          .insert({
            workspace_id,
            title: title.trim() || 'Sin título',
            content: html,
            visibility: vis,
            space_id: vis === 'space' ? space_id ?? null : null,
            doc_kind: doc_kind ?? 'note',
            // Un SOP recien redactado por una IA es un BORRADOR, nunca la regla
            // vigente: alguien tiene que revisarlo y activarlo a mano.
            sop_status: doc_kind && doc_kind !== 'note' ? 'draft' : null,
            created_by: userId,
          })
          .select('id, title')
          .single()) as { data: { id: string; title: string } | null; error: unknown }

        if (error || !created) {
          console.error('[kern create_note] insert error:', error)
          return { error: 'No se pudo crear el documento.' }
        }

        logActivity({
          verb: ActivityVerbs.NOTE_CREATED,
          subject_id: userId,
          object_type: 'note',
          object_id: created.id,
          object_title: created.title,
          workspace_id,
          metadata: { via: 'kern' },
        }).catch(console.error)

        // La ruta real vive bajo el slug del workspace. Sin el, el enlace no
        // abre nada, asi que se omite en vez de dar uno roto.
        const slug = member.workspaces?.slug ?? null

        return {
          created: {
            id: created.id,
            title: created.title,
            url: slug ? `/w/${slug}/notes/${created.id}` : null,
          },
          hint: 'Menciona al usuario que el documento ya quedó guardado en Notas y puede abrirlo para editarlo.',
        }
      },
    }),

    append_to_note: tool({
      description:
        'Agrega contenido al final de un documento existente, en Markdown. No borra lo que ya estaba. Uselo para continuar un documento; para reescribirlo entero usa replace: true.',
      parameters: z.object({
        note_id: z.string().uuid(),
        body_markdown: z.string().min(1).max(60000).describe('Contenido a agregar, en Markdown.'),
        replace: z.boolean().optional().describe('True para SUSTITUIR todo el contenido. Confirma con el usuario antes de usarlo: se pierde lo anterior.'),
      }),
      execute: async ({ note_id, body_markdown, replace }) => {
        const { data: note } = (await admin
          .from('notes')
          .select('id, workspace_id, title, content, visibility, created_by, space_id, project_id')
          .eq('id', note_id)
          .maybeSingle()) as {
          data:
            | {
                id: string
                workspace_id: string
                title: string
                content: string | null
                visibility: string
                created_by: string | null
                space_id: string | null
                project_id: string | null
              }
            | null
          error: unknown
        }
        if (!note) return { error: 'Documento no encontrado.' }

        const { data: member } = (await admin
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', note.workspace_id)
          .eq('profile_id', userId)
          .maybeSingle()) as { data: { role: string } | null; error: unknown }
        if (!member) return { error: 'Sin acceso a ese documento.' }

        const ctx = await loadNoteViewerContext(admin, note.workspace_id, userId)
        if (!canViewNote(ctx, note)) return { error: 'Sin acceso a ese documento.' }

        const nuevo = bodyToHtml(body_markdown)
        if (!nuevo) return { error: 'El contenido llegó vacío.' }
        const contenido = replace ? nuevo : `${note.content ?? ''}${nuevo}`

        const { error } = await admin
          .from('notes')
          .update({ content: contenido, updated_at: new Date().toISOString() })
          .eq('id', note_id)

        if (error) {
          console.error('[kern append_to_note] update error:', error)
          return { error: 'No se pudo actualizar el documento.' }
        }

        logActivity({
          verb: ActivityVerbs.NOTE_UPDATED,
          subject_id: userId,
          object_type: 'note',
          object_id: note.id,
          object_title: note.title,
          workspace_id: note.workspace_id,
          metadata: { via: 'kern' },
        }).catch(console.error)

        return { updated: { id: note.id, title: note.title, replaced: !!replace } }
      },
    }),
  }
}
