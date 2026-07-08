/**
 * Página de acceso no autorizado — dominio no permitido
 */
import Link from 'next/link'

export const metadata = { title: 'Acceso no autorizado' }

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
          <span className="text-destructive text-xl">✕</span>
        </div>
        <h1 className="text-xl font-semibold">Acceso no autorizado</h1>
        <p className="text-sm text-muted-foreground">
          Tu cuenta de Google no pertenece al dominio autorizado para acceder a esta aplicación.
        </p>
        <Link
          href="/auth/login"
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}
