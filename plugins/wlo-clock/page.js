'use client'

import { useEffect, useState } from 'react'

export default function ClockWidget() {
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
