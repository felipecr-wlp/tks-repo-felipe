'use client'

/**
 * Abre el detalle de una tarea desde CUALQUIER pantalla, sabiendo solo su id.
 *
 * El TaskDetailPanel siempre necesito `statuses` y `members`, y esos dos datos
 * solo existian en el server component del tablero. La consecuencia practica
 * era que enlazar una tarea desde otro lado significaba navegar al tablero: la
 * persona perdia el sitio donde estaba y volver costaba dos clics.
 *
 * En el reporte diario eso duele especialmente. La actividad ya dice que se
 * hizo; abrir la tarea es para pegar el enlace de lo entregado o subir la
 * evidencia, y luego seguir contando el dia. Sacarla del reporte para eso
 * rompe justo lo que se venia haciendo.
 *
 * Este envoltorio resuelve el contexto con una peticion (/api/tasks/:id/context,
 * que valida acceso del lado del servidor) y monta el panel de siempre. No
 * duplica UI: el panel real ya trae adjuntos con arrastrar y soltar, comentarios
 * con menciones, checklist y tiempo.
 *
 * Uso: {abierta && <TaskQuickView taskId={abierta} currentUserId={id} onClose={...} />}
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { TaskDetailPanel } from './TaskDetailPanel'

interface Status { id: string; name: string; color: string | null; category: string }
interface Member { id: string; display_name: string; avatar_url: string | null }

interface TaskQuickViewProps {
  taskId: string
  currentUserId: string
  onClose: () => void
  /** Se llama al cerrar SI hubo cambios, para que la pantalla de atras se refresque. */
  onChanged?: () => void
}

export function TaskQuickView({ taskId, currentUserId, onClose, onChanged }: TaskQuickViewProps) {
  const [ctx, setCtx] = useState<{ statuses: Status[]; members: Member[] } | null>(null)
  const [cambio, setCambio] = useState(false)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        const res = await fetch(`/api/tasks/${taskId}/context`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'No se pudo abrir la tarea')
        }
        const data: { statuses: Status[]; members: Member[] } = await res.json()
        if (vivo) setCtx({ statuses: data.statuses ?? [], members: data.members ?? [] })
      } catch (err) {
        // Sin contexto no hay panel que pintar: se avisa y se cierra, en vez de
        // dejar un overlay muerto encima de la pantalla.
        if (vivo) {
          toast.error(err instanceof Error ? err.message : 'No se pudo abrir la tarea')
          onClose()
        }
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
    // onClose no va en las dependencias a proposito: si el padre lo redefine en
    // cada render, incluirlo relanzaria la peticion en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const cerrar = () => {
    if (cambio) onChanged?.()
    onClose()
  }

  if (!ctx) {
    return (
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-white/80" />
      </div>
    )
  }

  return (
    <TaskDetailPanel
      taskId={taskId}
      statuses={ctx.statuses}
      members={ctx.members}
      currentUserId={currentUserId}
      onClose={cerrar}
      onUpdated={() => setCambio(true)}
      onDeleted={() => {
        setCambio(true)
        onChanged?.()
        onClose()
      }}
    />
  )
}
