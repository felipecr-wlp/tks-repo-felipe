/**
 * /print/notes/[noteId], vista de impresión limpia de una nota / SOP.
 *
 * Fuera del layout de la app (sin sidebar ni chrome) para que el navegador
 * imprima solo el documento. El usuario abre esta vista desde el botón
 * "Exportar a PDF" del editor y elige "Guardar como PDF" en el diálogo.
 *
 * Para documentos operativos (doc_kind != 'note') incluye la ficha de gobernanza
 * (tipo, estatus, versión, revisión) y el REGISTRO DE ACUSES ("Leído y
 * entendido"), que sirve como constancia de capacitación imprimible.
 *
 * Auth y acceso propios (no hereda el layout de la app): sesión + membresía de
 * workspace + visibilidad private.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PrintTrigger } from './PrintTrigger'

interface PrintPageProps {
  params: { noteId: string }
}

export const metadata = { title: 'Imprimir nota · WLO' }

type NoteRow = {
  id: string
  workspace_id: string
  icon: string | null
  title: string
  content: string | null
  visibility: string
  doc_kind: 'note' | 'sop' | 'sop_flow' | 'sop_index' | 'training'
  sop_status: 'draft' | 'review' | 'active' | 'obsolete' | null
  sop_version: string | null
  review_due: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

type AckRow = {
  profile_id: string
  acknowledged_at: string
  sop_version: string | null
  profile: { display_name: string } | null
}

const DOC_KIND_LABELS: Record<NoteRow['doc_kind'], string> = {
  note: 'Nota',
  sop: 'SOP',
  sop_flow: 'Flujo',
  sop_index: 'Índice',
  training: 'Capacitación',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  review: 'En revisión',
  active: 'Activo',
  obsolete: 'Obsoleto',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function PrintNotePage({ params }: PrintPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  const { data: note } = await admin
    .from('notes')
    .select(`
      id, workspace_id, icon, title, content, visibility,
      doc_kind, sop_status, sop_version, review_due,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', params.noteId)
    .maybeSingle() as { data: NoteRow | null; error: unknown }

  if (!note) notFound()

  // Membresía de workspace (acceso base) + visibilidad private.
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', note.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) notFound()
  if (note.visibility === 'private' && note.created_by !== user.id) notFound()

  const isDoc = note.doc_kind !== 'note'

  // Registro de acuses (solo documentos operativos).
  let acks: AckRow[] = []
  if (isDoc) {
    const { data: rows } = await admin
      .from('note_acknowledgements')
      .select('profile_id, acknowledged_at, sop_version, profile:profiles ( display_name )')
      .eq('note_id', note.id)
      .order('acknowledged_at', { ascending: false })
      .limit(500) as { data: AckRow[] | null; error: unknown }
    acks = rows ?? []
  }

  return (
    <div className="mx-auto max-w-3xl bg-white px-10 py-8 text-black print:px-0 print:py-0">
      <PrintTrigger />

      {/* Encabezado */}
      <header className="mb-6 border-b border-gray-300 pb-4">
        <h1 className="text-3xl font-bold leading-tight text-black">{note.title || 'Sin título'}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {DOC_KIND_LABELS[note.doc_kind]}
          {' · '}Autor: {note.author?.display_name ?? 'Usuario'}
          {' · '}Actualizado: {fmtDate(note.updated_at)}
        </p>

        {isDoc && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
            <span><strong>Estatus:</strong> {note.sop_status ? (STATUS_LABELS[note.sop_status] ?? note.sop_status) : '—'}</span>
            <span><strong>Versión:</strong> {note.sop_version ? `v${note.sop_version}` : '—'}</span>
            <span><strong>Próxima revisión:</strong> {fmtDate(note.review_due)}</span>
          </div>
        )}
      </header>

      {/* Contenido */}
      <article
        className="prose prose-sm max-w-none prose-headings:text-black prose-p:text-black prose-li:text-black prose-strong:text-black"
        dangerouslySetInnerHTML={{ __html: note.content ?? '<p><em>Documento sin contenido.</em></p>' }}
      />

      {/* Registro de acuses de lectura */}
      {isDoc && (
        <section className="mt-10 border-t border-gray-300 pt-4">
          <h2 className="text-base font-semibold text-black">
            Registro de acuses de lectura {acks.length > 0 && `(${acks.length})`}
          </h2>
          {acks.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
              Nadie ha confirmado el acuse de lectura todavía.
            </p>
          ) : (
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-left text-gray-600">
                  <th className="py-1.5 pr-4 font-medium">Persona</th>
                  <th className="py-1.5 pr-4 font-medium">Fecha del acuse</th>
                  <th className="py-1.5 font-medium">Versión reconocida</th>
                </tr>
              </thead>
              <tbody>
                {acks.map(a => {
                  const outdated = !!note.sop_version && a.sop_version !== note.sop_version
                  return (
                    <tr key={a.profile_id} className="border-b border-gray-200">
                      <td className="py-1.5 pr-4 text-black">{a.profile?.display_name ?? 'Usuario'}</td>
                      <td className="py-1.5 pr-4 text-black">{fmtDate(a.acknowledged_at)}</td>
                      <td className="py-1.5 text-black">
                        {a.sop_version ? `v${a.sop_version}` : '—'}
                        {outdated && <span className="text-amber-700"> (desactualizado)</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-xs text-gray-500">
            Documento generado desde WLO el {fmtDate(new Date().toISOString())}.
          </p>
        </section>
      )}
    </div>
  )
}
