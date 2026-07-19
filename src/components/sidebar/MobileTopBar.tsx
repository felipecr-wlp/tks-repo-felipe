'use client'

/**
 * Barra superior visible SOLO en movil (< md). Trae la hamburguesa que abre el
 * Sidebar como drawer y el boton de busqueda global. En desktop no se renderiza
 * (md:hidden) porque el Sidebar ya es una columna fija.
 */
import { Menu, Search } from 'lucide-react'
import { useMobileNav } from '@/stores/mobile-nav'
import { useCommandPalette } from '@/stores/command-palette'

export function MobileTopBar({ workspaceName }: { workspaceName: string }) {
  const toggle = useMobileNav(s => s.toggle)
  const openSearch = useCommandPalette(s => s.toggle)

  return (
    <header className="md:hidden flex items-center gap-2 h-12 px-3 border-b border-border bg-sidebar flex-shrink-0">
      <button
        onClick={toggle}
        aria-label="Abrir menú"
        className="p-2 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Menu size={20} />
      </button>
      <span className="text-sm font-semibold text-foreground truncate flex-1">
        {workspaceName}
      </span>
      <button
        onClick={openSearch}
        aria-label="Buscar"
        className="p-2 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Search size={18} />
      </button>
    </header>
  )
}
