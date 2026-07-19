/**
 * Store global del drawer de navegacion en movil.
 * En pantallas < md el Sidebar se vuelve un drawer off-canvas; este store
 * comparte el estado abierto/cerrado entre la barra superior movil (hamburguesa)
 * y el propio Sidebar (backdrop, auto-cierre al navegar).
 */
import { create } from 'zustand'

interface MobileNavState {
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

export const useMobileNav = create<MobileNavState>(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}))
