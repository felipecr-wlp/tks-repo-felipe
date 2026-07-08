'use client'

/**
 * Pantalla de bienvenida estilo Netflix: al entrar a la app, lo primero que ve
 * el usuario es su propio avatar con un saludo, y luego se desvanece.
 * Solo se muestra una vez por sesión del navegador (sessionStorage) para no
 * molestar en cada navegación interna.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { getInitials } from '@/lib/utils'

interface WelcomeSplashProps {
  name: string
  avatarUrl: string | null
}

const SESSION_KEY = 'wlo-welcome-seen'

export function WelcomeSplash({ name, avatarUrl }: WelcomeSplashProps) {
  const [phase, setPhase] = useState<'hidden' | 'in' | 'out'>('hidden')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(SESSION_KEY)) return

    sessionStorage.setItem(SESSION_KEY, '1')
    setPhase('in')

    const outTimer = setTimeout(() => setPhase('out'), 1600)
    const doneTimer = setTimeout(() => setPhase('hidden'), 2300)
    return () => {
      clearTimeout(outTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  if (phase === 'hidden') return null

  const firstName = name.split(' ')[0] || name

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background transition-opacity duration-700 motion-reduce:transition-none ${
        phase === 'out' ? 'opacity-0' : 'opacity-100'
      }`}
      aria-hidden
    >
      <div
        className={`flex flex-col items-center transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
          phase === 'in' ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
        }`}
      >
        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden bg-muted ring-1 ring-primary/30 shadow-xl shadow-primary/10">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt="Mi avatar"
              width={144}
              height={144}
              priority
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-4xl font-semibold text-muted-foreground">
              {getInitials(name)}
            </span>
          )}
        </div>
        <p className="mt-7 text-2xl sm:text-3xl font-light italic tracking-tight text-foreground">
          Hola, {firstName}
        </p>
      </div>
    </div>
  )
}
