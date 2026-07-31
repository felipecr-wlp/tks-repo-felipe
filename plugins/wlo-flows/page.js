'use client'

import { useState } from 'react'

export default function FlowsPluginPage({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const [count, setCount] = useState(0)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Flows Plugin</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Workspace: {workspaceSlug} ({workspaceId})
        </p>
      </div>
      <div className="border rounded-xl p-6 bg-card space-y-4">
        <p className="text-sm">Este es un plugin cargado dinamicamente desde <code className="bg-muted px-1 rounded">plugins/wlo-flows/page.js</code></p>
        <div className="flex items-center gap-2 justify-center">
          <button onClick={() => setCount(c => c - 1)} className="px-3 py-1 rounded bg-muted hover:bg-accent">-</button>
          <span className="text-xl font-bold w-12 text-center">{count}</span>
          <button onClick={() => setCount(c => c + 1)} className="px-3 py-1 rounded bg-muted hover:bg-accent">+</button>
        </div>
      </div>
      <a href={`/w/${workspaceSlug}/flows`} className="text-sm text-primary hover:underline">
        Ir al editor de Flows (version nativa)
      </a>
    </div>
  )
}
