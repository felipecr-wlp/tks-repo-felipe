'use client'

/**
 * Menú de usuario en el footer del sidebar.
 * Muestra avatar, nombre, email y opción de cerrar sesión.
 */
import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { cn, getInitials } from '@/lib/utils'

interface UserMenuProps {
  profile: {
    id: string
    display_name: string
    avatar_url: string | null
    email: string
  }
  collapsed: boolean
}

export function UserMenu({ profile, collapsed }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Sesión cerrada')
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 w-full rounded-md p-1.5 hover:bg-accent transition-colors text-left',
          collapsed && 'justify-center'
        )}
      >
        {/* Avatar */}
        <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden bg-muted">
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={profile.display_name}
              width={28}
              height={28}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-xs font-medium text-muted-foreground">
              {getInitials(profile.display_name)}
            </span>
          )}
        </div>

        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate leading-tight">
              {profile.display_name}
            </p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {profile.email}
            </p>
          </div>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          'absolute bg-popover border border-border rounded-lg shadow-raised z-50 py-1 w-48',
          collapsed ? 'left-full bottom-0 ml-2' : 'bottom-full left-0 mb-1'
        )}>
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-foreground truncate">{profile.display_name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{profile.email}</p>
          </div>

          <button
            onClick={() => { setOpen(false); router.push('/settings/profile') }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 12c0-2.2 2.2-4 5-4s5 1.8 5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Mi perfil
          </button>

          <button
            onClick={() => { setOpen(false); router.push('/settings') }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.41 1.41M9.66 9.66l1.41 1.41M2.93 11.07l1.41-1.41M9.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Configuración
          </button>

          <div className="h-px bg-border my-1" />

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2M10 10l3-3-3-3M13 7H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
