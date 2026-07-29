'use client'

import { useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Panel,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { ArrowLeft, Save, Plus, Trash2, FileText, Globe, Code, Link, Type } from 'lucide-react'
import LinkNext from 'next/link'

const nodeTypes = {
  custom: CustomNode,
}

type NodeContent = {
  contentType: 'text' | 'html' | 'url' | 'document'
  content: string
}

type FlowNodeData = {
  label: string
  content: NodeContent
}

function CustomNode({ data, selected }: NodeProps) {
  const flowData = data as unknown as FlowNodeData
  const contentType = flowData.content?.contentType ?? 'text'

  const icons: Record<string, React.ReactNode> = {
    text:     <Type className="w-3 h-3" />,
    html:     <Code className="w-3 h-3" />,
    url:      <Link className="w-3 h-3" />,
    document: <FileText className="w-3 h-3" />,
  }

  return (
    <div className={`bg-card border-2 rounded-lg px-4 py-3 min-w-[180px] max-w-[260px] shadow-sm transition-colors ${selected ? 'border-primary' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-primary/70">{icons[contentType]}</span>
        <span className="text-xs font-semibold truncate">{flowData.label || 'Nodo'}</span>
      </div>
      {flowData.content?.content && (
        <div className="text-xs text-muted-foreground line-clamp-2 mt-1 break-all">
          {contentType === 'url'
            ? <a href={flowData.content.content} target="_blank" rel="noopener noreferrer" className="underline text-blue-500">{flowData.content.content}</a>
            : <span>{flowData.content.content.slice(0, 100)}</span>
          }
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}

interface FlowEditorProps {
  flowId: string
  workspaceSlug: string
  initialNodes: Node[]
  initialEdges: Edge[]
  initialTitle: string
  initialDescription: string | null
  workspaceId: string
}

export default function FlowEditor({
  flowId,
  workspaceSlug,
  initialNodes,
  initialEdges,
  initialTitle,
  initialDescription,
}: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as any)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as any)
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<NodeJS.Timeout | null>(null)

  const save = useCallback(async (n?: Node[], e?: Edge[]) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          nodes: n ?? nodes,
          edges: e ?? edges,
        }),
      })
      if (!res.ok) throw new Error('Error al guardar')
    } catch {
      toast.error('Error al guardar el flujo')
    } finally {
      setSaving(false)
    }
  }, [flowId, title, description, nodes, edges])

  const autoSave = useCallback((n?: Node[], e?: Edge[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(n, e), 800)
  }, [save])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => {
      const updated = addEdge(connection, eds)
      autoSave(nodes, updated)
      return updated
    })
  }, [setEdges, nodes, autoSave])

  const addNode = useCallback((contentType: NodeContent['contentType'] = 'text') => {
    const id = `node-${Date.now()}`
    const newNode: Node = {
      id,
      type: 'custom',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: {
        label: 'Nuevo nodo',
        content: { contentType, content: '' },
      },
    }
    setNodes((nds) => {
      const updated = [...nds, newNode]
      autoSave(updated, edges)
      return updated
    })
  }, [setNodes, edges, autoSave])

  const deleteSelected = useCallback(() => {
    setNodes((nds) => {
      const remaining = nds.filter((n) => !n.selected)
      setEdges((eds) => {
        const selectIds = new Set(nds.filter((n) => n.selected).map((n) => n.id))
        const filtered = eds.filter((e) => !selectIds.has(e.source) && !selectIds.has(e.target))
        autoSave(remaining, filtered)
        return filtered
      })
      return remaining
    })
  }, [setNodes, setEdges, autoSave])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    const deletedIds = new Set(deleted.map((n) => n.id))
    setEdges((eds) => {
      const filtered = eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target))
      return filtered
    })
  }, [setEdges])

  const onNodeDragStop = useCallback(() => {
    autoSave()
  }, [autoSave])

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 py-2 border-b bg-card shrink-0">
        <LinkNext href={`/w/${workspaceSlug}/flows`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </LinkNext>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); autoSave() }}
          className="h-8 max-w-xs font-semibold border-0 bg-transparent shadow-none focus-visible:ring-0 focus:outline-none text-lg px-0"
          placeholder="Titulo del flujo"
        />
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{saving ? 'Guardando...' : 'Auto-guardado'}</span>
        <button
          onClick={() => save()}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md border bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          Guardar
        </button>
      </header>

      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          fitView
          className="bg-background"
        >
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <MiniMap nodeColor="#94a3b8" className="!bg-card border" />

          <Panel position="top-right" className="flex flex-col gap-1.5 bg-card border rounded-lg p-2 shadow-md">
            <span className="text-xs font-medium text-muted-foreground px-1 mb-1">Agregar nodo</span>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addNode('text')}>
              <Type className="w-4 h-4" /> Texto
            </button>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addNode('html')}>
              <Code className="w-4 h-4" /> HTML
            </button>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addNode('url')}>
              <Link className="w-4 h-4" /> URL
            </button>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addNode('document')}>
              <FileText className="w-4 h-4" /> Documento
            </button>
            <hr className="my-1" />
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground text-destructive transition-colors" onClick={deleteSelected}>
              <Trash2 className="w-4 h-4" /> Eliminar
            </button>
          </Panel>
        </ReactFlow>
      </div>

      {description !== undefined && (
        <footer className="px-4 py-2 border-t bg-card shrink-0">
          <input
            value={description}
            onChange={(e) => { setDescription(e.target.value); autoSave() }}
            className="h-8 w-full border-0 bg-transparent shadow-none focus-visible:ring-0 focus:outline-none text-xs text-muted-foreground"
            placeholder="Descripcion del flujo (opcional)"
          />
        </footer>
      )}
    </div>
  )
}
