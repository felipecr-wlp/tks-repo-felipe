/**
 * Store global del Command Palette (Cmd+K).
 * Permite abrir/cerrar desde cualquier componente.
 */
import { create } from 'zustand'

interface CommandPaletteState {
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

export const useCommandPalette = create<CommandPaletteState>(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}))
