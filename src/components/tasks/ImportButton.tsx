'use client'

/**
 * Boton "Importar CSV" de un proyecto (contraparte de escritura del ExportButton).
 *
 * Flujo: el usuario elige un archivo CSV, se parsea EN EL NAVEGADOR (RFC 4180:
 * campos entre comillas, comas internas, CRLF, comillas escapadas ""), se muestra
 * una previsualizacion (primeras filas + conteo total) en un modal ligero y, al
 * confirmar, se envian las filas estructuradas a POST /api/projects/[projectId]/import.
 * Solo la columna "title" es obligatoria; se reconocen tambien status, priority y
 * due_date. Estado de carga y errores via sonner.
 *
 * Para montar: <ImportButton projectId={project.id} /> junto al ExportButton en
 * la barra de herramientas (TaskFilterBar).
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload, Loader2, X } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'

interface ImportButtonProps {
  projectId: string
  className?: string
}

// Fila ya normalizada lista para enviar al servidor.
interface ParsedRow {
  title: string
  status?: string
  priority?: string
  due_date?: string
}

// Tope duro alineado con el del servidor (evita mandar lotes que seran rechazados).
const MAX_ROWS = 500
const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none'])

/**
 * Parser CSV minimo RFC 4180: soporta campos entre comillas, comas y saltos de
 * linea dentro de comillas, comillas escapadas ("") y finales de linea CRLF o LF.
 * Devuelve una matriz de filas (cada fila = arreglo de celdas string).
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0

  // Quitar BOM UTF-8 si viene (lo agrega nuestro export para Excel).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue }
    field += c; i++
  }
  // Ultima celda/fila si el archivo no termina en salto de linea.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/**
 * Convierte la matriz cruda del CSV en filas estructuradas. Detecta encabezado si
 * la primera fila contiene "title"; si no hay encabezado, asume que la primera
 * columna es el titulo. Ignora columnas desconocidas (ej. id, assignee, created_at).
 */
function toRows(matrix: string[][]): ParsedRow[] {
  if (matrix.length === 0) return []

  const header = matrix[0].map(h => h.trim().toLowerCase())
  const hasHeader = header.includes('title')

  let idx: Record<string, number>
  let dataRows: string[][]
  if (hasHeader) {
    idx = {
      title: header.indexOf('title'),
      status: header.indexOf('status'),
      priority: header.indexOf('priority'),
      due_date: header.indexOf('due_date'),
    }
    dataRows = matrix.slice(1)
  } else {
    // Sin encabezado: primera columna = titulo, el resto se ignora.
    idx = { title: 0, status: -1, priority: -1, due_date: -1 }
    dataRows = matrix
  }

  const out: ParsedRow[] = []
  for (const cells of dataRows) {
    const title = (idx.title >= 0 ? cells[idx.title] ?? '' : '').trim()
    if (!title) continue // title es la unica columna obligatoria
    const row: ParsedRow = { title: title.slice(0, 500) }

    const status = idx.status >= 0 ? (cells[idx.status] ?? '').trim() : ''
    if (status) row.status = status

    const priority = idx.priority >= 0 ? (cells[idx.priority] ?? '').trim().toLowerCase() : ''
    if (priority && PRIORITIES.has(priority)) row.priority = priority

    const due = idx.due_date >= 0 ? (cells[idx.due_date] ?? '').trim() : ''
    if (due) row.due_date = due

    out.push(row)
  }
  return out
}

export default function ImportButton({ projectId, className }: ImportButtonProps) {
  const t = useT()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Permitir re-seleccionar el mismo archivo en un intento posterior.
    e.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const parsed = toRows(parseCsv(text))
      if (parsed.length === 0) {
        toast.error(t('csv.noTitleRows'))
        return
      }
      if (parsed.length > MAX_ROWS) {
        toast.error(`${t('csv.maxRowsPrefix')} ${MAX_ROWS} ${t('csv.maxRowsMid')} ${parsed.length}${t('csv.maxRowsSuffix')}`)
        return
      }
      setFileName(file.name)
      setRows(parsed)
    } catch (err) {
      console.error('[ImportButton] parse error:', err)
      toast.error(t('csv.readFail'))
    }
  }

  function cancel() {
    setRows(null)
    setFileName('')
  }

  async function commit() {
    if (!rows || importing) return
    setImporting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!res.ok) {
        let message = t('csv.importFail')
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          // respuesta sin cuerpo JSON, usar mensaje por defecto
        }
        toast.error(message)
        return
      }
      const data = await res.json() as { created?: number }
      toast.success(`${data.created ?? 0} ${t('csv.importedSuffix')}`)
      cancel()
      router.refresh()
    } catch (err) {
      console.error('[ImportButton] import error:', err)
      toast.error(t('csv.importError'))
    } finally {
      setImporting(false)
    }
  }

  const preview = rows?.slice(0, 5) ?? []

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={t('csv.importTitle')}
        className={
          className ??
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
        }
      >
        <Upload className="h-4 w-4" />
        <span>{t('csv.importBtn')}</span>
      </button>

      {/* Modal ligero de previsualizacion */}
      {rows && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={cancel}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-border bg-background shadow-raised"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                {t('csv.previewTitle')}
              </h2>
              <button
                onClick={cancel}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-4 py-3">
              <p className="mb-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span>
                {' · '}
                {rows.length} {rows.length === 1 ? t('csv.taskOne') : t('csv.taskMany')} {t('csv.toImport')}
                {rows.length > preview.length && ` (${t('csv.showingPrefix')} ${preview.length})`}
              </p>

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">{t('csv.colTitle')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('csv.colStatus')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('csv.colPriority')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('csv.colDue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="max-w-[16rem] truncate px-2 py-1.5 text-foreground">{r.title}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.status ?? t('csv.default')}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.priority ?? 'none'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.due_date ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={cancel}
                disabled={importing}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={commit}
                disabled={importing}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t('csv.importAction')} {rows.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
