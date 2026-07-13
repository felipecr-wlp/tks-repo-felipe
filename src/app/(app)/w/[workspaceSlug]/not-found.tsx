/**
 * 404 dentro de un workspace (Circuito B28).
 * Cubre notFound() de proyectos, tareas, notas, equipos, etc. invalidos.
 * Al ser sibling del layout del workspace, si el error viene de una pagina
 * hija el sidebar se mantiene montado (contexto de navegacion no se pierde).
 */
import Link from 'next/link'
import { SearchX } from 'lucide-react'

export default function WorkspaceNotFound() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto">
          <SearchX className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">No encontramos eso</h1>
        <p className="text-sm text-muted-foreground">
          El proyecto, tarea o nota que buscas no existe, fue movido o no tienes acceso.
        </p>
        <Link
          href="/"
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}
