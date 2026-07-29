'use client'

import { useCallback, useRef, useState, type FormEvent } from 'react'
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
import { ArrowLeft, Save, Plus, Trash2, FileText, Globe, Code, Link, Type, Pencil, X, Eye, Edit3, Square, Circle, Minus, Grid3X3 } from 'lucide-react'
import LinkNext from 'next/link'

type ShapeType = 'rect' | 'circle' | 'line' | 'grid'
type ShapeData = { shape: ShapeType; width: number; height: number; fill: string; stroke: string }

type NodeContent = {
  contentType: 'text' | 'html' | 'url' | 'document'
  content: string
}

type FlowNodeData = {
  label: string
  content: NodeContent
} | ShapeData

const icons: Record<string, React.ReactNode> = {
  text: <Type className="w-3 h-3" />,
  html: <Code className="w-3 h-3" />,
  url: <Link className="w-3 h-3" />,
  document: <FileText className="w-3 h-3" />,
}

function CustomNode({ data }: NodeProps) {
  const flowData = data as unknown as FlowNodeData

  if ('shape' in flowData) {
    return null
  }

  const contentType = flowData.content?.contentType ?? 'text'

  return (
    <div className="bg-card border-2 rounded-lg px-4 py-3 min-w-[180px] max-w-[260px] shadow-sm transition-colors border-border group">
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-primary/70">{icons[contentType]}</span>
        <span className="text-xs font-semibold truncate flex-1">{flowData.label || 'Nodo'}</span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          title="Editar"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
      {flowData.content?.content && (
        <div className="text-xs text-muted-foreground line-clamp-2 mt-1 break-all">
          {contentType === 'url'
            ? <span className="underline text-blue-500">{flowData.content.content}</span>
            : contentType === 'html'
              ? <span className="italic">HTML</span>
              : <span>{flowData.content.content.slice(0, 100)}</span>
          }
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}

function ShapeNode({ data }: NodeProps) {
  const d = data as unknown as ShapeData
  const s = d.shape ?? 'rect'
  const w = d.width ?? 160
  const h = d.height ?? 120
  const fill = d.fill ?? 'transparent'
  const stroke = d.stroke ?? '#94a3b8'

  if (s === 'circle') {
    return (
      <svg width={w} height={h} className="overflow-visible">
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 2} ry={h / 2 - 2} fill={fill} stroke={stroke} strokeWidth={2} />
      </svg>
    )
  }

  if (s === 'line') {
    return (
      <svg width={w} height={h} className="overflow-visible">
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke} strokeWidth={3} />
        <polygon points={`${w - 8},${h / 2 - 5} ${w},${h / 2} ${w - 8},${h / 2 + 5}`} fill={stroke} />
      </svg>
    )
  }

  if (s === 'grid') {
    const cols = 3; const rows = 3
    const cw = w / cols; const rh = h / rows
    const lines = []
    for (let i = 1; i < cols; i++) lines.push(<line key={`v${i}`} x1={i * cw} y1={0} x2={i * cw} y2={h} stroke={stroke} strokeWidth={1} strokeDasharray="4 2" />)
    for (let i = 1; i < rows; i++) lines.push(<line key={`h${i}`} x1={0} y1={i * rh} x2={w} y2={i * rh} stroke={stroke} strokeWidth={1} strokeDasharray="4 2" />)
    return (
      <svg width={w} height={h} className="overflow-visible">
        <rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={2} rx={2} />
        {lines}
      </svg>
    )
  }

  return (
    <svg width={w} height={h} className="overflow-visible">
      <rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={2} rx={6} />
    </svg>
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
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [nodeLabel, setNodeLabel] = useState('')
  const [nodeContent, setNodeContent] = useState('')
  const [nodeType, setNodeType] = useState<NodeContent['contentType']>('text')
  const [previewHtml, setPreviewHtml] = useState(false)
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

  const addShape = useCallback((shape: ShapeType) => {
    const id = `shape-${Date.now()}`
    const dimensions = shape === 'line' ? { width: 200, height: 40 } :
                       shape === 'grid' ? { width: 240, height: 200 } :
                       { width: 160, height: 120 }
    const newNode: Node = {
      id,
      type: 'shape',
      position: { x: Math.random() * 400 + 50, y: Math.random() * 250 + 50 },
      data: {
        shape,
        ...dimensions,
        fill: shape === 'line' ? 'transparent' : '#f1f5f9',
        stroke: '#64748b',
      },
      draggable: true,
      selectable: true,
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

  const openEditor = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId) as Node | undefined
    if (!node) return
    const data = node.data as unknown as FlowNodeData
    if ('shape' in data) return
    setEditingNodeId(nodeId)
    setNodeLabel(data.label || '')
    setNodeContent(data.content?.content || '')
    setNodeType(data.content?.contentType || 'text')
    setPreviewHtml(false)
  }, [nodes])

  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    openEditor(node.id)
  }, [openEditor])

  const handleNodeEditClick = useCallback((_event: React.MouseEvent, node: Node) => {
    openEditor(node.id)
  }, [openEditor])

  const saveNodeEdit = useCallback(() => {
    if (!editingNodeId) return
    setNodes((nds) => {
      const updated = nds.map((n) => {
        if (n.id === editingNodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              label: nodeLabel,
              content: { contentType: nodeType, content: nodeContent },
            },
          }
        }
        return n
      })
      autoSave(updated, edges)
      return updated
    })
    setEditingNodeId(null)
  }, [editingNodeId, nodeLabel, nodeContent, nodeType, setNodes, autoSave, edges])

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
          onNodeDoubleClick={handleNodeDoubleClick}
          nodeTypes={{ custom: CustomNode, shape: ShapeNode }}
          fitView
          className="bg-background"
        >
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <MiniMap nodeColor="#94a3b8" className="!bg-card border" />

          <Panel position="top-right" className="flex flex-col gap-1.5 bg-card border rounded-lg p-2 shadow-md">
            <span className="text-xs font-medium text-muted-foreground px-1 mb-1">Contenido</span>
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
            <span className="text-xs font-medium text-muted-foreground px-1 mb-1">Dibujo</span>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addShape('rect')}>
              <Square className="w-4 h-4" /> Rectangulo
            </button>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addShape('circle')}>
              <Circle className="w-4 h-4" /> Circulo
            </button>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addShape('line')}>
              <Minus className="w-4 h-4" /> Linea
            </button>
            <button className="inline-flex items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => addShape('grid')}>
              <Grid3X3 className="w-4 h-4" /> Cuadricula
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

      {/* ── Modal de edición de nodo ────────────────────────────── */}
      {editingNodeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingNodeId(null)}>
          <div
            className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
              <div className="flex items-center gap-2">
                {icons[nodeType]}
                <span className="font-semibold text-sm">Editar nodo</span>
              </div>
              <button onClick={() => setEditingNodeId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Label */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre del nodo</label>
                <input
                  value={nodeLabel}
                  onChange={(e) => setNodeLabel(e.target.value)}
                  className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Nombre del nodo"
                />
              </div>

              {/* Tipo de contenido */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo de contenido</label>
                <div className="flex gap-1">
                  {(['text', 'html', 'url', 'document'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setNodeType(t); setPreviewHtml(false) }}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${nodeType === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
                    >
                      {icons[t]}
                      {t === 'text' ? 'Texto' : t === 'html' ? 'HTML' : t === 'url' ? 'URL' : 'Documento'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content editor */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {nodeType === 'url' ? 'URL' : nodeType === 'document' ? 'Documento' : 'Contenido'}
                  </label>
                  {nodeType === 'html' && (
                    <button
                      onClick={() => setPreviewHtml(!previewHtml)}
                      className={`inline-flex items-center gap-1 text-xs rounded px-2 py-0.5 transition-colors ${previewHtml ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
                    >
                      {previewHtml ? <Edit3 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {previewHtml ? 'Código' : 'Vista previa'}
                    </button>
                  )}
                </div>

                {nodeType === 'html' && previewHtml ? (
                  <div
                    className="w-full min-h-[200px] rounded-md border bg-white p-4 text-sm overflow-auto"
                    dangerouslySetInnerHTML={{ __html: nodeContent }}
                  />
                ) : (
                  <textarea
                    value={nodeContent}
                    onChange={(e) => setNodeContent(e.target.value)}
                    className="w-full min-h-[200px] rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
                    placeholder={
                      nodeType === 'url' ? 'https://ejemplo.com' :
                      nodeType === 'html' ? '<div class="container">\n  <h1>Hola mundo</h1>\n</div>' :
                      nodeType === 'document' ? 'Contenido del documento...' :
                      'Contenido del nodo...'
                    }
                  />
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
              <button
                onClick={() => setEditingNodeId(null)}
                className="inline-flex items-center rounded-md bg-muted hover:bg-accent h-9 px-4 py-2 text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveNodeEdit}
                className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 text-sm font-medium transition-colors"
              >
                <Save className="w-4 h-4" />
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
