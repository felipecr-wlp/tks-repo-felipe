/**
 * Encabezado de marca del sidebar.
 *
 * Antes era un selector desplegable entre workspaces. WLO opera con UN solo
 * espacio de trabajo (General) por decision de producto: no hay a donde
 * cambiar, y un menu que solo lista lo que ya estas viendo es ruido. Tampoco
 * se ofrece crear workspaces (la ruta y la API tambien lo rechazan, esconder
 * el boton nunca es la guarda real).
 *
 * Queda un bloque estatico: marca grande, nombre del espacio y organizacion.
 * Server component a proposito: sin estado, sin listeners, sin JS al cliente.
 */
import { WloLogo } from '@/components/brand/WloLogo'

interface WorkspaceSwitcherProps {
  currentName: string
  orgName: string
}

export function WorkspaceSwitcher({ currentName, orgName }: WorkspaceSwitcherProps) {
  return (
    <div className="flex items-center gap-2.5 flex-1 min-w-0 px-0.5 py-0.5">
      {/* La marca es lo primero que se ve al abrir la app, asi que ocupa el
          lugar de una marca y no el de un favicon perdido junto al texto. */}
      <span className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-white dark:bg-white/10 border border-border shadow-sm text-[#16202b] dark:text-white">
        <WloLogo size={34} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate leading-tight" title={currentName}>
          {currentName}
        </p>
        <p className="text-[11px] text-muted-foreground truncate leading-tight" title={orgName}>
          {orgName}
        </p>
      </div>
    </div>
  )
}
