'use client'

/**
 * Boton "Exportar CSV" de un proyecto.
 *
 * Descarga las tareas no archivadas del proyecto llamando a
 * GET /api/projects/[projectId]/export (que responde text/csv con
 * Content-Disposition attachment). Se usa fetch + blob (en vez de un <a> plano)
 * para poder mostrar estado de carga y capturar errores de auth/permiso como
 * toast en vez de dejar que el navegador abra un JSON de error.
 *
 * Para montar: colocar <ExportButton projectId={project.id} /> en la barra de
 * herramientas del proyecto (ej. junto a los filtros en TaskFilterBar).
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'

interface ExportButtonProps {
  projectId: string
  className?: string
}

export default function ExportButton({ projectId, className }: ExportButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: 'GET',
        headers: { Accept: 'text/csv' },
      })
      if (!res.ok) {
        let message = 'No se pudo exportar el CSV'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          // respuesta sin cuerpo JSON, usar mensaje por defecto
        }
        toast.error(message)
        return
      }

      const blob = await res.blob()

      // Derivar el filename del header si el servidor lo mando.
      let filename = 'tareas.csv'
      const disposition = res.headers.get('Content-Disposition')
      const match = disposition?.match(/filename="?([^"]+)"?/i)
      if (match?.[1]) filename = match[1]

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      toast.success('CSV exportado')
    } catch (err) {
      console.error('[ExportButton] export error:', err)
      toast.error('Error al exportar el CSV')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      title="Exportar tareas como CSV"
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
      }
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      <span>Exportar CSV</span>
    </button>
  )
}
