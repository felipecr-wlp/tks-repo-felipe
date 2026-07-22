/**
 * Página de login, solo Google OAuth
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/validation'
import { LoginButton } from './LoginButton'

export const metadata = { title: 'Iniciar sesión' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { redirectTo?: string; error?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Solo se permite redirigir a rutas internas (mismo origen). Bloquea
  // open-redirect: URLs absolutas, protocol-relative y backslash-tricks caen al
  // home. Mismo criterio centralizado que el callback OAuth y google/connect.
  const safeRedirect = safeInternalPath(searchParams.redirectTo)

  // Si ya tiene sesión, redirigir
  if (user) redirect(safeRedirect)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="bg-white rounded-2xl shadow-sm border border-border p-10 w-full max-w-sm text-center space-y-6">
        {/* Logo placeholder */}
        <div className="flex items-center justify-center w-12 h-12 bg-primary rounded-xl mx-auto">
          <span className="text-primary-foreground text-xl font-bold">W</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">WLO</h1>
          <p className="text-sm text-muted-foreground">
            Accede con tu cuenta de Google corporativa
          </p>
        </div>

        {/* Error message */}
        {searchParams.error && (
          <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">
            {searchParams.error === 'unauthorized_domain'
              ? 'Tu cuenta no pertenece al dominio autorizado.'
              : 'Ocurrió un error. Intenta de nuevo.'}
          </div>
        )}

        <LoginButton redirectTo={safeRedirect} />

        <p className="text-xs text-muted-foreground">
          Solo cuentas{' '}
          {(process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? 'tudominio.com')
            .split(',').map(d => d.trim()).filter(Boolean)
            .map((d, i, arr) => (
              <span key={d}><strong>@{d}</strong>{i < arr.length - 1 ? ', ' : ''}</span>
            ))}{' '}autorizadas
        </p>
      </div>
    </div>
  )
}
