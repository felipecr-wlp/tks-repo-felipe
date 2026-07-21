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
import { LogOut, RefreshCw } from 'lucide-react'

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
        {/* Recepción: el husky recibe en la puerta */}
        <div className="lobby-welcome relative mx-auto mb-5 h-32 w-full max-w-xs overflow-hidden rounded-2xl border border-border">
          <div className="lobby-welcome-bg absolute inset-0" />
          <div className="lobby-welcome-mat absolute left-1/2 bottom-0 -translate-x-1/2" />
          <div className="relative z-10 flex h-full items-end justify-center">
            <div className="relative pb-2">
              <div className="lobby-welcome-bubble">¡Bienvenido!</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avatars/husky.png"
                alt="Husky de bienvenida"
                width={104}
                height={104}
                className="lobby-welcome-husky h-24 w-24 object-contain drop-shadow-lg"
              />
              <div className="lobby-welcome-shadow" />
            </div>
          </div>
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

      <style jsx>{`
        .lobby-welcome-bg {
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(37, 99, 235, 0.14), transparent 60%),
            linear-gradient(180deg, hsl(var(--muted) / 0.5), hsl(var(--card)));
        }
        .lobby-welcome-mat {
          width: 150px;
          height: 34px;
          background: linear-gradient(180deg, #fed500, #f5c400);
          clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%);
          opacity: 0.85;
        }
        .lobby-welcome-husky {
          transform-origin: 50% 90%;
          animation:
            lobby-welcome-drop 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both,
            lobby-welcome-bob 2.8s ease-in-out 0.9s infinite;
        }
        .lobby-welcome-shadow {
          position: absolute;
          left: 50%;
          bottom: 2px;
          width: 62px;
          height: 10px;
          transform: translateX(-50%);
          background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.22), transparent 70%);
          animation: lobby-welcome-shadow 2.8s ease-in-out 0.9s infinite;
        }
        .lobby-welcome-bubble {
          position: absolute;
          top: -2px;
          right: -12px;
          z-index: 2;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 600;
          color: #fff;
          background: #2563eb;
          border-radius: 9999px;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
          animation: lobby-welcome-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.1s both;
        }
        .lobby-welcome-bubble::after {
          content: '';
          position: absolute;
          left: 12px;
          bottom: -4px;
          width: 8px;
          height: 8px;
          background: #2563eb;
          transform: rotate(45deg);
          border-radius: 1px;
        }
        @keyframes lobby-welcome-drop {
          0% { opacity: 0; transform: translateY(-24px) scale(0.9); }
          60% { transform: translateY(4px) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes lobby-welcome-bob {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
        @keyframes lobby-welcome-shadow {
          0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.5; }
          50% { transform: translateX(-50%) scaleX(0.82); opacity: 0.32; }
        }
        @keyframes lobby-welcome-pop {
          from { opacity: 0; transform: scale(0.4) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lobby-welcome-husky, .lobby-welcome-shadow, .lobby-welcome-bubble {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}
