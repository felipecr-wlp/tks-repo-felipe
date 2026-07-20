/**
 * Rollup de cumplimiento de SOPs del workspace (Nivel 2, Paso 3).
 *
 * GET /api/workspaces/[workspaceId]/sop-compliance
 *   -> metricas agregadas: por documento, por departamento y totales
 *      (obligatorios, aprobados, firmas desactualizadas, lectores confirmados vs
 *      pendientes, revisiones vencidas).
 *
 * GET ...?format=csv
 *   -> mismo dato por documento como CSV descargable (con BOM UTF-8 para que
 *      Excel muestre bien ñ/tildes).
 *
 * Solo admins del workspace. Reutiliza el modelo de sop_assignments +
 * note_acknowledgements + aprobacion (approved_*). Los conjuntos de personas de
 * equipos/departamentos se expanden aqui (target_id polimorfico sin FK).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

interface RouteParams {
  params: { workspaceId: string }
}

type NoteRow = {
  id: string
  title: string
  doc_kind: string
  sop_status: string | null
  sop_version: string | null
  review_due: string | null
  space_id: string | null
  approved_by: string | null
  approved_at: string | null
  approved_version: string | null
}

type AssignRow = { note_id: string; target_type: 'profile' | 'team' | 'space'; target_id: string }
type AckRow = { note_id: string; profile_id: string; sop_version: string | null }

const KIND_LABEL: Record<string, string> = {
  sop: 'SOP', sop_flow: 'Flujo', sop_index: 'Índice', training: 'Capacitación',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador', review: 'En revisión', active: 'Activo', obsolete: 'Obsoleto',
}

function isOverdue(reviewDue: string | null): boolean {
  if (!reviewDue) return false
  return reviewDue < new Date().toISOString().slice(0, 10)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  const admin = createAdminClient()

  // ── Documentos operativos + departamentos ───────────────────────────────────
  const [{ data: notes }, { data: spaces }] = await Promise.all([
    admin.from('notes')
      .select('id, title, doc_kind, sop_status, sop_version, review_due, space_id, approved_by, approved_at, approved_version')
      .eq('workspace_id', params.workspaceId)
      .neq('doc_kind', 'note')
      .limit(1000),
    admin.from('spaces').select('id, name').eq('workspace_id', params.workspaceId),
  ]) as [{ data: NoteRow[] | null }, { data: { id: string; name: string }[] | null }]

  const noteRows = notes ?? []
  const spaceName = new Map((spaces ?? []).map(s => [s.id, s.name]))
  const noteIds = noteRows.map(n => n.id)

  // ── Asignaciones + acuses de esos documentos ────────────────────────────────
  let assignments: AssignRow[] = []
  let acks: AckRow[] = []
  if (noteIds.length > 0) {
    const [{ data: a }, { data: k }] = await Promise.all([
      admin.from('sop_assignments').select('note_id, target_type, target_id').in('note_id', noteIds),
      admin.from('note_acknowledgements').select('note_id, profile_id, sop_version').in('note_id', noteIds),
    ]) as [{ data: AssignRow[] | null }, { data: AckRow[] | null }]
    assignments = a ?? []
    acks = k ?? []
  }

  // ── Expandir equipos/departamentos a profile_ids (una sola pasada) ───────────
  const teamIds = Array.from(new Set(assignments.filter(a => a.target_type === 'team').map(a => a.target_id)))
  const spaceTargetIds = Array.from(new Set(assignments.filter(a => a.target_type === 'space').map(a => a.target_id)))

  const teamMembers = new Map<string, string[]>()
  const spaceMembers = new Map<string, string[]>()
  if (teamIds.length > 0) {
    const { data } = await admin.from('team_members').select('team_id, profile_id').in('team_id', teamIds) as { data: { team_id: string; profile_id: string }[] | null }
    for (const r of data ?? []) {
      const arr = teamMembers.get(r.team_id) ?? []
      arr.push(r.profile_id); teamMembers.set(r.team_id, arr)
    }
  }
  if (spaceTargetIds.length > 0) {
    const { data } = await admin.from('space_members').select('space_id, profile_id').in('space_id', spaceTargetIds) as { data: { space_id: string; profile_id: string }[] | null }
    for (const r of data ?? []) {
      const arr = spaceMembers.get(r.space_id) ?? []
      arr.push(r.profile_id); spaceMembers.set(r.space_id, arr)
    }
  }

  // Asignaciones y acuses por nota.
  const assignByNote = new Map<string, AssignRow[]>()
  for (const a of assignments) {
    const arr = assignByNote.get(a.note_id) ?? []
    arr.push(a); assignByNote.set(a.note_id, arr)
  }
  const ackByNote = new Map<string, Map<string, string | null>>()
  for (const k of acks) {
    const m = ackByNote.get(k.note_id) ?? new Map<string, string | null>()
    m.set(k.profile_id, k.sop_version); ackByNote.set(k.note_id, m)
  }

  // ── Fila por documento + acumulados por depto y totales ──────────────────────
  type DocMetric = {
    id: string; title: string; kind: string; status: string | null; version: string | null
    department: string; required: number; done: number; outdated: number; pending: number
    compliance: number; approved: boolean; approval_outdated: boolean
    review_due: string | null; overdue: boolean
  }

  const docs: DocMetric[] = []
  const totals = { docs: noteRows.length, obligatorios: 0, approved: 0, approval_outdated: 0, overdue: 0, required: 0, done: 0, outdated: 0, pending: 0 }
  const deptAgg = new Map<string, { name: string; docs: number; required: number; done: number; pending_outdated: number }>()

  for (const n of noteRows) {
    const nAssigns = assignByNote.get(n.id) ?? []
    // Conjunto de personas requeridas (dedup).
    const required = new Set<string>()
    for (const a of nAssigns) {
      if (a.target_type === 'profile') required.add(a.target_id)
      else if (a.target_type === 'team') for (const p of teamMembers.get(a.target_id) ?? []) required.add(p)
      else for (const p of spaceMembers.get(a.target_id) ?? []) required.add(p)
    }
    const ackMap = ackByNote.get(n.id) ?? new Map<string, string | null>()
    let done = 0, outdated = 0, pending = 0
    for (const pid of required) {
      if (!ackMap.has(pid)) pending++
      else if (n.sop_version && ackMap.get(pid) !== n.sop_version) outdated++
      else done++
    }
    const reqCount = required.size
    const approved = !!n.approved_by && !!n.approved_at
    const approvalOutdated = approved && !!n.sop_version && n.approved_version !== n.sop_version
    const overdue = isOverdue(n.review_due) && n.sop_status !== 'obsolete'
    const compliance = reqCount > 0 ? Math.round((done / reqCount) * 100) : 0
    const deptName = n.space_id ? (spaceName.get(n.space_id) ?? 'Departamento') : 'Sin departamento'

    docs.push({
      id: n.id, title: n.title, kind: n.doc_kind, status: n.sop_status, version: n.sop_version,
      department: deptName, required: reqCount, done, outdated, pending, compliance,
      approved, approval_outdated: approvalOutdated, review_due: n.review_due, overdue,
    })

    if (reqCount > 0) totals.obligatorios++
    if (approved) totals.approved++
    if (approvalOutdated) totals.approval_outdated++
    if (overdue) totals.overdue++
    totals.required += reqCount; totals.done += done; totals.outdated += outdated; totals.pending += pending

    const key = n.space_id ?? '__none__'
    const agg = deptAgg.get(key) ?? { name: deptName, docs: 0, required: 0, done: 0, pending_outdated: 0 }
    agg.docs++; agg.required += reqCount; agg.done += done; agg.pending_outdated += pending + outdated
    deptAgg.set(key, agg)
  }

  docs.sort((a, b) => a.compliance - b.compliance || a.title.localeCompare(b.title))

  const departments = Array.from(deptAgg.values())
    .map(d => ({ ...d, compliance: d.required > 0 ? Math.round((d.done / d.required) * 100) : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const overallCompliance = totals.required > 0 ? Math.round((totals.done / totals.required) * 100) : 0

  // ── Export CSV ──────────────────────────────────────────────────────────────
  if (request.nextUrl.searchParams.get('format') === 'csv') {
    const header = ['Documento', 'Tipo', 'Departamento', 'Estatus', 'Version', 'Aprobado', 'Firma desactualizada', 'Requeridos', 'Confirmados', 'Desactualizados', 'Pendientes', 'Cumplimiento %', 'Proxima revision', 'Vencida']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [header.map(esc).join(',')]
    for (const d of docs) {
      lines.push([
        d.title || 'Sin titulo',
        KIND_LABEL[d.kind] ?? d.kind,
        d.department,
        d.status ? (STATUS_LABEL[d.status] ?? d.status) : '',
        d.version ?? '',
        d.approved ? 'Si' : 'No',
        d.approval_outdated ? 'Si' : 'No',
        String(d.required),
        String(d.done),
        String(d.outdated),
        String(d.pending),
        String(d.compliance),
        d.review_due ?? '',
        d.overdue ? 'Si' : 'No',
      ].map(v => esc(String(v))).join(','))
    }
    const csv = '﻿' + lines.join('\r\n')
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cumplimiento-sops-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return NextResponse.json({
    can_view: true,
    overall_compliance: overallCompliance,
    totals,
    departments,
    docs,
  })
}
