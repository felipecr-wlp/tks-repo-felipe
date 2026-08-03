'use client'

/**
 * Entrada por correo y contraseña, para pruebas.
 *
 * Existe por una razón concreta: quien desarrolla contra WLO desde fuera no
 * siempre tiene una cuenta de Google del dominio, y pedirle una para poder
 * probar convierte "abre la pantalla y dime si funciona" en un trámite de
 * varios días.
 *
 * ── Por qué esto NO abre un boquete ─────────────────────────────────────────
 * La restricción de dominio NO vive en el callback de OAuth, vive en el
 * middleware y corre en CADA request (`src/middleware.ts`, bloque "Domain
 * restriction"). Entrar por contraseña no se salta ese filtro: si el correo no
 * termina en un dominio de `ALLOWED_EMAIL_DOMAINS`, la primera navegación
 * rebota a `/auth/unauthorized` con sesión y todo. Y aun pasando el dominio,
 * seguir viendo algo exige una fila en `workspace_members`.
 *
 * O sea que este formulario cambia CÓMO se prueba la identidad, no QUIÉN entra.
 * Los dos candados de siempre siguen puestos.
 *
 * ── Y aun así, apagado por defecto ──────────────────────────────────────────
 * El formulario solo se dibuja si `TESTER_LOGIN=1` en el entorno. No es que
 * haga falta para la seguridad (arriba queda explicado por qué no), es que una
 * caja de contraseña visible en la pantalla de entrada invita a intentarlo, y
 * cada intento es ruido en los logs. Cuando la prueba termina se quita la
 * variable y la caja desaparece sin tocar código.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface TesterLoginProps {
  redirectTo?: string
}

export function TesterLogin({ redirectTo }: TesterLoginProps) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cargando) return
    setCargando(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: correo.trim(),
        password,
      })
      if (error) throw error

      // `router.refresh()` antes de navegar: la sesión acaba de escribirse en
      // cookies y los Server Components de la ruta destino todavía tienen el
      // render viejo, el de "no hay nadie". Sin esto el primer aterrizaje
      // rebota al login y parece que la contraseña estuvo mal.
      router.refresh()
      router.push(redirectTo || '/')
    } catch {
      // Mensaje deliberadamente parejo: decir "ese correo no existe" le regala
      // a cualquiera una forma de averiguar quién tiene cuenta.
      toast.error('No se pudo entrar. Revisa el correo y la contraseña.')
      setCargando(false)
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Entrar con correo y contraseña
      </button>
    )
  }

  return (
    <form onSubmit={entrar} className="space-y-3 text-left">
      <div className="space-y-1">
        <label htmlFor="tester-email" className="text-xs font-medium text-muted-foreground">
          Correo
        </label>
        <input
          id="tester-email"
          type="email"
          required
          autoComplete="username"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="tester-password" className="text-xs font-medium text-muted-foreground">
          Contraseña
        </label>
        <input
          id="tester-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <button
        type="submit"
        disabled={cargando}
        className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {cargando ? 'Entrando...' : 'Entrar'}
      </button>

      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancelar
      </button>
    </form>
  )
}
