'use client'

/**
 * Formulario de "Mi perfil": nombre + galería de avatares.
 * El husky (adminOnly) aparece con candado y no es seleccionable si el usuario
 * no es Admin; la regla también se valida en el servidor.
 */
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Lock, User, Home, Mail } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { AVATARS } from '@/lib/avatars'

interface ProfileFormProps {
  initialName: string
  initialAvatar: string | null
  initialEmailNotifications: boolean
  email: string
  isAdmin: boolean
}

export function ProfileForm({ initialName, initialAvatar, initialEmailNotifications, email, isAdmin }: ProfileFormProps) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [selected, setSelected] = useState<string | null>(initialAvatar)
  const [emailNotif, setEmailNotif] = useState(initialEmailNotifications)
  const [saving, setSaving] = useState(false)

  const dirty =
    name.trim() !== initialName ||
    selected !== initialAvatar ||
    emailNotif !== initialEmailNotifications
  const nameValid = name.trim().length >= 2

  const save = async () => {
    if (!nameValid) { toast.error('El nombre debe tener al menos 2 caracteres'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name.trim(), avatar_url: selected, email_notifications: emailNotif }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Error al guardar')
      toast.success('Perfil actualizado')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-6 shadow-sm">
      {/* Regresar al Menú */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="w-4 h-4" /> Regresar al Menú
      </Link>

      {/* Identidad: avatar actual + nombre */}
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0 w-16 h-16 rounded-full overflow-hidden bg-muted ring-2 ring-border">
          {selected ? (
            <Image src={selected} alt="Avatar" width={64} height={64} className="w-full h-full object-cover" />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-lg font-medium text-muted-foreground">
              {getInitials(name || 'WLO')}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium text-foreground">Nombre para mostrar</label>
          <input
            id="name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            disabled={saving}
            className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
      </div>

      {/* Galería */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Elige tu avatar</p>
          <p className="text-xs text-muted-foreground">{AVATARS.length} avatares</p>
        </div>
        {/* Contenedor con scroll: barra lateral para explorar todos los avatares */}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2.5 pr-3">
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
          {/* Sin avatar (iniciales) */}
          <button
            type="button"
            onClick={() => setSelected(null)}
            title="Sin avatar (iniciales)"
            className={cn(
              'relative aspect-square rounded-full overflow-hidden bg-muted flex items-center justify-center transition-all',
              selected === null ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : 'ring-1 ring-border hover:ring-primary/50',
            )}
          >
            <User className="w-5 h-5 text-muted-foreground" />
            {selected === null && (
              <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                <Check className="w-2.5 h-2.5 text-primary-foreground" />
              </span>
            )}
          </button>

          {AVATARS.map(av => {
            const locked = av.adminOnly && !isAdmin
            const isSel = selected === av.path
            return (
              <button
                key={av.path}
                type="button"
                title={locked ? `${av.label} · reservado para el Admin` : av.label}
                onClick={() => {
                  if (locked) { toast.error('Ese avatar está reservado para el Admin'); return }
                  setSelected(av.path)
                }}
                className={cn(
                  'relative aspect-square rounded-full overflow-hidden bg-muted transition-all',
                  isSel ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : 'ring-1 ring-border hover:ring-primary/50',
                  locked && 'cursor-not-allowed',
                )}
              >
                <Image
                  src={av.path}
                  alt={av.label}
                  width={72}
                  height={72}
                  className={cn('w-full h-full object-cover', locked && 'opacity-40 grayscale')}
                />
                {locked && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-foreground/70" />
                  </span>
                )}
                {isSel && (
                  <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
        </div>
        {!isAdmin && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Lock className="w-3 h-3" /> El husky está reservado para el Admin.
          </p>
        )}
      </div>

      {/* Notificaciones por correo (Circuito 2.B): opt-out por usuario */}
      <div className="space-y-2.5 border-t border-border pt-5">
        <p className="text-sm font-medium text-foreground">Notificaciones</p>
        <button
          type="button"
          onClick={() => setEmailNotif(v => !v)}
          disabled={saving}
          className="w-full flex items-center gap-3 text-left rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            <Mail className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-foreground">Correos de menciones y asignaciones</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Recibe un correo cuando te mencionen o te asignen una tarea. La Bandeja siempre te avisa dentro de la app.
            </span>
          </span>
          <span
            className={cn(
              'flex-shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors',
              emailNotif ? 'bg-primary' : 'bg-muted-foreground/30'
            )}
            aria-hidden="true"
          >
            <span
              className={cn(
                'block w-5 h-5 rounded-full bg-background shadow-sm transition-transform',
                emailNotif ? 'translate-x-4' : 'translate-x-0'
              )}
            />
          </span>
        </button>
      </div>

      {/* Acciones, sticky abajo para que el botón Guardar siempre se vea */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-4 bg-card/95 backdrop-blur border-t border-border rounded-b-xl">
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={saving}
            className="px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || !nameValid}
            title={!dirty ? 'Cambia tu nombre o avatar para guardar' : 'Guardar cambios'}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving
              ? <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Guardando...</>
              : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
