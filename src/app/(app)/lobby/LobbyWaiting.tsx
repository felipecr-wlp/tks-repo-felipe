'use client'

/**
 * Pantalla de la sala de espera. Sondea cada 15s: cuando un admin ubica al
 * usuario en un workspace, el server component de arriba lo redirige solo, asi
 * que basta con refrescar la ruta periodicamente.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Clock, LogOut, RefreshCw } from 'lucide-react'

interface LobbyWaitingProps {
  displayName: string
  email: string
  orgName: string
}

export function LobbyWaiting({ displayName, email, orgName }: LobbyWaitingProps) {
  const router = useRouter()
  const [checking, setChecking] = useState(false)

  // Sondeo pasivo: refresca la ruta; si ya lo ubicaron, el server redirige.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15000)
    return () => clearInterval(id)
  }, [router])

  const checkNow = () => {
    setChecking(true)
    router.refresh()
    setTimeout(() => setChecking(false), 1200)
  }

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Sesión cerrada')
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-5">
          <Clock size={26} />
        </div>

        <h1 className="text-2xl font-semibold text-foreground">
          Hola, {displayName}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Ya formas parte de{' '}
          <span className="font-medium text-foreground">{orgName}</span>. Un
          administrador te ubicará en tu espacio de trabajo y equipo muy pronto.
          Esta pantalla se actualizará sola cuando tengas acceso.
        </p>

        <div className="mt-6 bg-card border border-border rounded-xl p-4 text-left">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold uppercase">
              {displayName.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {displayName}
              </p>
              <p className="text-xs text-muted-foreground truncate">{email}</p>
            </div>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              En espera
            </span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={checkNow}
            disabled={checking}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Revisando...' : 'Revisar de nuevo'}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <LogOut size={15} />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
