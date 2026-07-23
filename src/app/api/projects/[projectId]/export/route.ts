/**
 * GET /api/projects/[projectId]/export
 *
 * Portabilidad de datos: exporta las tareas NO archivadas de un proyecto como
 * CSV descargable. Señal de madurez del producto (el usuario es dueño de sus
 * datos y puede sacarlos cuando quiera).
 *
 * Seguridad (mismo patron que las rutas hermanas, ej. activity/route.ts):
 *   - projectId validado como UUID, auth obligatorio (401), rate limit.
 *   - Anti-IDOR: el admin client bypassa RLS, por eso se carga primero el
 *     proyecto para obtener su workspace_id y luego se RE-VERIFICA que el
 *     usuario sea MIEMBRO de ese workspace via workspace_members antes de
 *     devolver nada. El projectId viene de la ruta, nunca del body.
 *
 * Salida: text/csv con BOM UTF-8 (para que Excel lea acentos y ñ), cabecera de
 * columnas en ASCII (keys estables para importadores), filas escapadas segun
 * RFC 4180 (comillas, comas y saltos de linea).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

type ExportTask = {
  id: string
  title: string | null
  priority: string | null
  due_date: string | null
  created_at: string | null
  status: { name: string | null } | null
  assignee: { display_name: string | null } | null
}

/** Escapa un valor para CSV (RFC 4180): envuelve en comillas si contiene
 *  comillas, comas o saltos de linea, y duplica las comillas internas. */
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// Cabecera ASCII (keys estables), no depende del texto visible en la UI.
const HEADERS = ['id', 'title', 'status', 'priority', 'assignee', 'due_date', 'created_at']

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  // Cargar el proyecto para obtener su workspace_id (y slug para el filename).
  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('id, slug, workspace_id')
    .eq('id', params.projectId)
    .maybeSingle() as {
      data: { id: string; slug: string | null; workspace_id: string } | null
      error: unknown
    }
  if (projectErr) {
    console.error('[project export GET] project read error:', projectErr)
    return NextResponse.json({ error: 'Error al exportar' }, { status: 500 })
  }
  if (!project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  // Anti-IDOR: el usuario debe ser miembro del workspace del proyecto.
  const { data: membership, error: memberErr } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }
  if (memberErr) {
    console.error('[project export GET] membership read error:', memberErr)
    return NextResponse.json({ error: 'Error al exportar' }, { status: 500 })
  }
  if (!membership) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { data: tasks, error: tasksErr } = await admin
    .from('tasks')
    .select(`
      id,
      title,
      priority,
      due_date,
      created_at,
      status:task_statuses ( name ),
      assignee:profiles!tasks_assignee_id_fkey ( display_name )
    `)
    .eq('project_id', params.projectId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true }) as {
      data: ExportTask[] | null
      error: unknown
    }
  if (tasksErr) {
    console.error('[project export GET] tasks read error:', tasksErr)
    return NextResponse.json({ error: 'Error al exportar' }, { status: 500 })
  }

  const rows = (tasks ?? []).map(t => [
    t.id,
    t.title ?? '',
    t.status?.name ?? '',
    t.priority ?? '',
    t.assignee?.display_name ?? '',
    t.due_date ?? '',
    t.created_at ?? '',
  ].map(csvEscape).join(','))

  const csvBody = [HEADERS.join(','), ...rows].join('\r\n')
  // BOM UTF-8 para que Excel interprete acentos/ñ correctamente.
  const csv = '﻿' + csvBody

  const safeSlug = (project.slug ?? 'proyecto').replace(/[^a-zA-Z0-9_-]/g, '-')
  const filename = `${safeSlug}-tareas.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
