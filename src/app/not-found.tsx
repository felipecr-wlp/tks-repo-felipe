/**
 * 404 global on-brand (Circuito B28).
 * Reemplaza la pantalla generica de Next.js cuando notFound() se dispara
 * fuera de un contexto de workspace (o cuando el workspace mismo no existe).
 */
import Link from 'next/link'
import { SearchX } from 'lucide-react'

export const metadata = { title: 'No encontrado · WLO' }

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto">
          <SearchX className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Página no encontrada</h1>
        <p className="text-sm text-muted-foreground">
          Lo que buscas no existe o fue movido. Revisa el enlace o vuelve al inicio.
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
