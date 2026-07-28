/**
 * Página de acceso no autorizado, dominio no permitido
 */
import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { getServerT } from '@/lib/i18n/server'

export const metadata = { title: 'Acceso no autorizado' }

export default function UnauthorizedPage() {
  const t = getServerT()
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
          <ShieldX className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold">{t('auth.unauthorizedTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('auth.unauthorizedBody')}
        </p>
        <Link
          href="/auth/login"
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('join.backHome')}
        </Link>
      </div>
    </div>
  )
}
