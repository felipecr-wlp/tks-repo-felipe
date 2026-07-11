'use client'

/**
 * Workspace Switcher, dropdown para cambiar entre workspaces del usuario.
 */
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface WorkspaceSwitcherProps {
  currentSlug: string
  currentName: string
  orgName: string
  workspaces: Array<{ id: string; name: string; slug: string }>
}

export function WorkspaceSwitcher({
  currentSlug,
  currentName,
  orgName,
  workspaces,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full min-w-0 rounded-md px-1 py-1 hover:bg-accent transition-colors text-left"
      >
        {/* Avatar de workspace */}
        <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-primary text-primary-foreground text-xs font-bold uppercase">
          {currentName.charAt(0)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate leading-tight">
            {currentName}
          </p>
          <p className="text-[10px] text-muted-foreground truncate leading-tight">
            {orgName}
          </p>
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={cn('flex-shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : '')}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
          <div className="px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {orgName}
            </p>
          </div>

          {workspaces.map(ws => (
            <Link
              key={ws.id}
              href={`/w/${ws.slug}`}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors',
                ws.slug === currentSlug ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded bg-muted text-muted-foreground text-[10px] font-bold uppercase">
                {ws.name.charAt(0)}
              </span>
              <span className="truncate">{ws.name}</span>
              {ws.slug === currentSlug && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-auto flex-shrink-0">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </Link>
          ))}

          <div className="h-px bg-border my-1" />
          <Link
            href="/settings/workspaces/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Nuevo workspace
          </Link>
        </div>
      )}
    </div>
  )
}
