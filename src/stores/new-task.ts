/**
 * Store global del modal "Nueva tarea" (atajo C).
 * Permite abrir/cerrar desde cualquier componente (Sidebar, hotkey global).
 */
import { create } from 'zustand'

interface NewTaskState {
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

export const useNewTask = create<NewTaskState>(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}))
