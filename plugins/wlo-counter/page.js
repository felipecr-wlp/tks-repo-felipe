'use client'

import { useState } from 'react'

export default function CounterWidget() {
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
