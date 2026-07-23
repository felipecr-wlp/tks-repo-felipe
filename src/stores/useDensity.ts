/**
 * Store global de densidad de las listas/tablas de tareas.
 * Permite alternar entre 'comfortable' (Cómoda, filas mas altas y legibles) y
 * 'compact' (Compacta, mas filas visibles a la vez), como en productos maduros
 * tipo Linear o Notion. Se persiste en localStorage (clave `wlo-density`) para
 * recordar la preferencia entre sesiones. SSR-safe: toda lectura/escritura de
 * localStorage se protege con un guard de `window`.
 */
import { create } from 'zustand'

export type Density = 'comfortable' | 'compact'

const STORAGE_KEY = 'wlo-density'
const DEFAULT: Density = 'comfortable'

// Lectura inicial protegida contra SSR (window no existe en el servidor).
function readInitial(): Density {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'compact' || v === 'comfortable' ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

// Escritura protegida: nunca revienta si localStorage no esta disponible.
function persist(value: Density) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* almacenamiento no disponible (modo privado, cuota): se ignora */
  }
}

interface DensityState {
  density: Density
  setDensity: (density: Density) => void
  toggle: () => void
}

export const useDensity = create<DensityState>(set => ({
  density: readInitial(),
  setDensity: (density) => { persist(density); set({ density }) },
  toggle: () => set(s => {
    const next: Density = s.density === 'comfortable' ? 'compact' : 'comfortable'
    persist(next)
    return { density: next }
  }),
}))
