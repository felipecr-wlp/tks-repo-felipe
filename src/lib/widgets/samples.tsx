'use client'

import { useEffect, useState } from 'react'

export function SampleCounterWidget() {
  const [count, setCount] = useState(0)
  return (
    <div className="border rounded-xl p-4 bg-card h-full">
      <h4 className="text-xs font-semibold text-muted-foreground mb-3">Contador</h4>
      <div className="flex flex-col items-center gap-2">
        <span className="text-3xl font-bold">{count}</span>
        <div className="flex gap-1">
          <button onClick={() => setCount(c => c - 1)} className="w-8 h-8 rounded bg-muted hover:bg-accent text-sm">-</button>
          <button onClick={() => setCount(0)} className="px-3 h-8 rounded bg-muted hover:bg-accent text-xs">Reset</button>
          <button onClick={() => setCount(c => c + 1)} className="w-8 h-8 rounded bg-muted hover:bg-accent text-sm">+</button>
        </div>
      </div>
    </div>
  )
}

export function SampleClockWidget() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="border rounded-xl p-4 bg-card h-full">
      <h4 className="text-xs font-semibold text-muted-foreground mb-3">Reloj</h4>
      <div className="flex flex-col items-center gap-1">
        <span className="text-3xl font-mono font-bold">{time}</span>
        <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
    </div>
  )
}

/** Mapa de component names → React components */
export const WIDGET_COMPONENTS: Record<string, React.ComponentType<any>> = {
  'sample-counter': SampleCounterWidget,
  'sample-clock': SampleClockWidget,
}
