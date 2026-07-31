'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
// React Flow trabaja con nodos y edges de forma dinamica: el contenido de cada
// nodo lo define el usuario en tiempo de ejecucion. Tipar cada acceso aqui no
// aporta seguridad real, asi que la regla se apaga en este archivo a proposito.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  ReactFlow, Controls, Background, MiniMap, useNodesState, useEdgesState,
  addEdge, Connection, type Node, type Edge, BackgroundVariant,
  type NodeProps, Handle, Position, MarkerType, useReactFlow, SelectionMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { ArrowLeft, Save, Trash2, FileText, Code, Link as LinkIcon, Type, Pencil, X, Eye, Edit3, Square, Circle, Minus, Grid3X3, ArrowUp, ArrowDown, Copy, ChevronUp, Maximize, Lock, Unlock, Settings, Share2, CheckCircle, Download, Upload, AlertTriangle, RefreshCw, Cloud, CloudOff } from 'lucide-react'
import LinkNext from 'next/link'

type ShapeType = 'rect' | 'circle' | 'line' | 'grid' | 'text'
type ShapeData = { shape: ShapeType; width: number; height: number; fill: string; stroke: string; label?: string; rows?: number; cols?: number }
type NodeContent = { contentType: 'text' | 'html' | 'url' | 'document'; content: string }
type FlowNodeData = { label: string; content: NodeContent } | ShapeData

/**
 * Aviso de "algo cambio, hay que guardar" para los nodos.
 *
 * Antes esto viajaba DENTRO de data como `onResizeEnd`, y ahi estaba el fallo
 * que impedia que un flujo se guardara nunca. Dos razones:
 *   1. Una funcion no sobrevive a JSON.stringify. Al mandar el nodo al servidor
 *      la propiedad desaparecia, asi que el nodo guardado nunca era igual al
 *      que estaba en pantalla.
 *   2. La funcion quedaba congelada con el estado del momento en que se creo la
 *      figura. Al dispararla despues, guardaba una foto VIEJA encima de lo nuevo.
 * Con un contexto la referencia es estable y siempre lee el estado actual.
 */
const FlowDirtyContext = createContext<() => void>(() => {})

const icons: Record<string, React.ReactNode> = {
  text: <Type className="w-3 h-3" />, html: <Code className="w-3 h-3" />,
  url: <LinkIcon className="w-3 h-3" />, document: <FileText className="w-3 h-3" />,
}

function CustomNode({ data, selected, id }: NodeProps) {
  // Los hooks van antes de cualquier return. React exige el mismo orden de
  // hooks en todos los renders y este nodo puede salir temprano si resulta
  // ser una figura, no un nodo de contenido.
  const rf = useReactFlow()
  const markDirty = useContext(FlowDirtyContext)
  const containerRef = useRef<HTMLDivElement>(null)
  // El primer disparo del observer es el del montaje, no un cambio del usuario:
  // se ignora para no marcar como sucio un flujo que nadie toco.
  useEffect(()=>{const el=containerRef.current;if(!el)return;let first=true;const ro=new ResizeObserver(()=>{const w=el.offsetWidth;if(w<=0)return;if(first){first=false;return}rf.setNodes((nds:any[])=>nds.map((n:any)=>n.id===id?{...n,data:{...n.data,nodeWidth:w}}:n));markDirty()});ro.observe(el);return()=>ro.disconnect()},[id,rf,markDirty])
  const fd = data as unknown as FlowNodeData
  if ('shape' in fd) return null
  const ct = fd.content?.contentType ?? 'text'; const locked = (data as any).locked
  const nodeW = (data as any).nodeWidth ?? 260
  return (
    <div ref={containerRef} className={`bg-card border-2 rounded-lg px-4 py-3 shadow-sm transition-all group relative ${selected?'border-primary ring-2 ring-primary/30 shadow-md':locked?'opacity-70 border-border':'border-border'}`} style={{width:nodeW,maxWidth:'none',resize:'horizontal',overflow:'auto'}}>
      {selected && <CheckCircle className="absolute -top-1.5 -right-1.5 w-4 h-4 text-primary bg-background rounded-full z-10" />}
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-primary/70">{icons[ct]}</span>
        <span className="text-xs font-semibold truncate flex-1">{fd.label || 'Nodo'}</span>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" title="Editar"><Pencil className="w-3 h-3" /></button>
        {locked && <Lock className="w-3 h-3 text-amber-500 ml-0.5 flex-shrink-0" />}
      </div>
      {fd.content?.content && (
        <div className="text-xs text-muted-foreground line-clamp-2 mt-1 break-all">
          {ct==='url'?<span className="underline text-blue-500">{fd.content.content}</span>:ct==='html'?<span className="italic">HTML</span>:<span>{fd.content.content.slice(0,100)}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}

function ShapeNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as ShapeData
  const s = d.shape ?? 'rect'; const w = d.width ?? 160; const h = d.height ?? 120
  const fill = d.fill ?? '#f1f5f9'; const stroke = d.stroke ?? '#64748b'
  const rows = d.rows ?? 3; const cols = d.cols ?? 3; const label = d.label ?? ''; const locked = (data as any).locked
  const opacity = locked ? {opacity:0.6} : {}
  const selRing = selected ? {outline:'2px solid #3b82f6',outlineOffset:'2px',borderRadius:s==='circle'?'50%':s==='grid'?'4px':'8px'} : {}
  const rf = useReactFlow()
  const markDirty = useContext(FlowDirtyContext)
  const containerRef = useRef<HTMLDivElement>(null)
  // Ojo con las dependencias: antes estaba `d` (el data del nodo) y eso volvia a
  // crear el observer en cada cambio, lo que a su vez disparaba otro cambio. El
  // id y la referencia estable del contexto bastan.
  useEffect(()=>{const el=containerRef.current;if(!el)return;let first=true;const ro=new ResizeObserver(()=>{const nw=el.offsetWidth;const nh=el.offsetHeight;if(nw<=0||nh<=0)return;if(first){first=false;return}rf.setNodes((nds:any[])=>nds.map((n:any)=>n.id===id?{...n,data:{...n.data,width:nw,height:nh}}:n));markDirty()});ro.observe(el);return()=>ro.disconnect()},[id,rf,markDirty])
  const Label = label ? <text x={w/2} y={h/2} textAnchor="middle" dominantBaseline="central" fill="#334155" fontSize={13} fontWeight={500} fontFamily="system-ui, sans-serif" style={{pointerEvents:'none'}}>{label}</text> : null

  const D = <div ref={containerRef} style={{width:w,height:h,...opacity,...selRing,position:'relative',resize:'both',overflow:'auto'}}>
    {selected && <CheckCircle className="absolute -top-2 -right-2 w-4 h-4 text-primary bg-background rounded-full z-10"/>}
  {s==='circle' && <svg width={w} height={h} className="overflow-visible"><ellipse cx={w/2} cy={h/2} rx={w/2-2} ry={h/2-2} fill={fill} stroke={stroke} strokeWidth={2}/>{Label}</svg>}
  {s==='line' && <svg width={w} height={h} className="overflow-visible"><line x1={0} y1={h/2} x2={w} y2={h/2} stroke={stroke} strokeWidth={3}/><polygon points={`${w-8},${h/2-5} ${w},${h/2} ${w-8},${h/2+5}`} fill={stroke}/>{Label}</svg>}
  {s==='grid' && (()=>{const cw=w/cols,rh=h/rows,ls=[];for(let i=1;i<cols;i++)ls.push(<line key={`v${i}`} x1={i*cw} y1={0} x2={i*cw} y2={h} stroke={stroke} strokeWidth={1} strokeDasharray="4 2"/>);for(let i=1;i<rows;i++)ls.push(<line key={`h${i}`} x1={0} y1={i*rh} x2={w} y2={i*rh} stroke={stroke} strokeWidth={1} strokeDasharray="4 2"/>);return <svg width={w} height={h} className="overflow-visible"><rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={2} rx={2}/>{ls}{Label}</svg>})()}
  {s==='text' && <svg width={w} height={h} className="overflow-visible"><text x={w/2} y={h/2} textAnchor="middle" dominantBaseline="central" fill={stroke} fontSize={14} fontWeight={500} fontFamily="system-ui, sans-serif" style={{pointerEvents:'none',userSelect:'none'}}>{label||'Texto'}</text></svg>}
  {!['circle','line','grid','text'].includes(s) && <svg width={w} height={h} className="overflow-visible"><rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={2} rx={6}/>{Label}</svg>}
  </div>
  return D
}

interface Props { flowId:string;workspaceSlug:string;initialNodes:Node[];initialEdges:Edge[];initialTitle:string;initialDescription:string|null;initialUpdatedAt:string|null;workspaceId:string;readOnly?:boolean }

type SaveState = 'guardado' | 'guardando' | 'pendiente' | 'error' | 'conflicto'

export default function FlowEditor({flowId,workspaceSlug,initialNodes,initialEdges,initialTitle,initialDescription,initialUpdatedAt,workspaceId,readOnly=false}:Props){
  const [nodes,setNodes,onNodesChange]=useNodesState(initialNodes as any)
  const [edges,setEdges,onEdgesChange]=useEdgesState(initialEdges as any)
  const [title,setTitle]=useState(initialTitle);const [description,setDescription]=useState(initialDescription??'')
  const [saveState,setSaveState]=useState<SaveState>('guardado')
  const [lastSavedAt,setLastSavedAt]=useState<Date|null>(null)
  const [editingNodeId,setEditingNodeId]=useState<string|null>(null);const [nodeLabel,setNodeLabel]=useState('')
  const [nodeContent,setNodeContent]=useState('');const [nodeType,setNodeType]=useState<NodeContent['contentType']>('text')
  const [previewHtml,setPreviewHtml]=useState(false)
  const [editingShapeId,setEditingShapeId]=useState<string|null>(null)
  const [shapeW,setShapeW]=useState(160);const [shapeH,setShapeH]=useState(120);const [shapeLabel,setShapeLabel]=useState('')
  const [shapeFill,setShapeFill]=useState('#f1f5f9');const [shapeStroke,setShapeStroke]=useState('#64748b')
  const [shapeRows,setShapeRows]=useState(3);const [shapeCols,setShapeCols]=useState(3);const [shapeType,setShapeType]=useState<ShapeType>('rect')
  const [ctxMenu,setCtxMenu]=useState<{x:number;y:number;nodeId:string}|null>(null)
  const [ctxEdgeMenu,setCtxEdgeMenu]=useState<{x:number;y:number;edgeId:string}|null>(null)
  const [editingEdgeId,setEditingEdgeId]=useState<string|null>(null)
  const [edgeLabel,setEdgeLabel]=useState('');const [edgeColor,setEdgeColor]=useState('#64748b');const [edgeWidth,setEdgeWidth]=useState(2);const [edgeAnim,setEdgeAnim]=useState(false);const [edgeType,setEdgeType]=useState('default')
  const [showShare,setShowShare]=useState(false);const [shares,setShares]=useState<any[]>([]);const [members,setMembers]=useState<any[]>([]);const [sharePerm,setSharePerm]=useState<'view'|'edit'>('view')
  // Respaldo: si la ruta por flujo no devuelve miembros, se pide la del workspace.
  const loadMembers=useCallback(async()=>{try{const r=await fetch(`/api/profile?workspace_id=${workspaceId}`);if(r.ok)setMembers((await r.json()).profiles||[])}catch{}},[workspaceId])
  const [toolCollapsed,setToolCollapsed]=useState(false);const [toolPos,setToolPos]=useState({x:0,y:0})
  const reactFlowInstance = useRef<any>(null)
  const saveTimer=useRef<NodeJS.Timeout|null>(null)
  const retryTimer=useRef<NodeJS.Timeout|null>(null)
  // Espejo del estado actual. Lo lee el guardado en el momento de disparar, no
  // en el momento de programarse: sin esto, un guardado con 800ms de retraso
  // manda la foto de hace 800ms y se come lo que se hizo mientras tanto.
  const latest=useRef({nodes:initialNodes as any[],edges:initialEdges as any[],title:initialTitle,description:initialDescription??''})
  const dirty=useRef(false)
  const inFlight=useRef(false)
  const pendingWhileInFlight=useRef(false)
  const retries=useRef(0)
  const conflict=useRef(false)
  const baseVersion=useRef<string|null>(initialUpdatedAt)
  // Puente hacia la ultima version de save(), para que los reintentos y los
  // avisos de salida no dependan de la version que existia cuando se montaron.
  const saveRef=useRef<(opts?:{force?:boolean;keepalive?:boolean})=>Promise<boolean>>(async()=>false)
  const history=useRef<{nodes:any[],edges:any[]}[]>([])
  const historyIdx=useRef<number>(-1)
  const clipboard=useRef<any[]>([])
  const [altHeld, setAltHeld] = useState(false)

  const toggleFullscreen = useCallback(async ()=>{if(document.fullscreenElement){await document.exitFullscreen()}else{await document.documentElement.requestFullscreen()}},[])

  // El espejo se refresca en cada render comprometido. A partir de aqui nadie
  // vuelve a pasar nodos ni edges por parametro: el guardado los toma de aqui.
  useEffect(()=>{latest.current={nodes:nodes as any[],edges:edges as any[],title,description}},[nodes,edges,title,description])

  /**
   * Guardado real contra el servidor.
   *
   * Solo lectura se corta aqui, en el cliente, ademas de que el servidor ya
   * responde 403. Asi nadie ve un "Guardando..." que en realidad fallo.
   *
   * `force` salta el control de versiones y pisa lo que haya en la base. Solo
   * lo usa el boton que aparece cuando hay conflicto, nunca el auto-guardado.
   * `keepalive` es para la salida de la pagina: deja que la peticion termine
   * aunque el componente ya no exista (limite del navegador, 64KB de cuerpo).
   */
  const save=useCallback(async(opts?:{force?:boolean;keepalive?:boolean}):Promise<boolean>=>{
    if(readOnly)return false
    if(inFlight.current){pendingWhileInFlight.current=true;return false}
    if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null}
    inFlight.current=true
    setSaveState('guardando')
    const snap=latest.current
    const body:Record<string,unknown>={title:snap.title,description:snap.description,nodes:snap.nodes,edges:snap.edges}
    if(!opts?.force&&baseVersion.current)body.expected_updated_at=baseVersion.current
    try{
      const r=await fetch(`/api/flows/${flowId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:opts?.keepalive})
      if(r.status===409){
        // Alguien mas guardo despues de que abrimos. No se pisa en silencio.
        // El aviso sale una sola vez: seguir editando no debe llenar la pantalla
        // de toasts identicos.
        inFlight.current=false
        const primeraVez=!conflict.current
        conflict.current=true
        setSaveState('conflicto')
        if(primeraVez)toast.error('Otra persona edito este flujo. Elige que hacer en la barra de arriba.')
        return false
      }
      if(r.status===403){
        inFlight.current=false;setSaveState('error')
        toast.error('Solo tienes acceso de lectura')
        return false
      }
      if(!r.ok)throw new Error(String(r.status))
      const data=await r.json().catch(()=>null)
      if(data?.updated_at)baseVersion.current=data.updated_at
      inFlight.current=false
      retries.current=0
      conflict.current=false
      dirty.current=false
      setSaveState('guardado');setLastSavedAt(new Date())
      // Si algo cambio mientras la peticion viajaba, se vuelve a guardar.
      if(pendingWhileInFlight.current){pendingWhileInFlight.current=false;dirty.current=true;setSaveState('pendiente');saveTimer.current=setTimeout(()=>{saveRef.current()},400)}
      return true
    }catch{
      inFlight.current=false
      setSaveState('error')
      // Reintento con espera creciente. El cubo de rate limit de la API es
      // compartido (60 peticiones por minuto por IP), asi que una oficina entera
      // editando puede sacar un 429 pasajero: rendirse ahi seria perder trabajo.
      if(retries.current<5){
        const espera=[1000,2000,4000,8000,15000][retries.current]
        retries.current++
        retryTimer.current=setTimeout(()=>{saveRef.current()},espera)
      }else{
        toast.error('No se pudo guardar. Revisa tu conexion y usa el boton Guardar.')
      }
      return false
    }
  },[flowId,readOnly])
  useEffect(()=>{saveRef.current=save},[save])

  // Varios sitios llaman a autoSave DENTRO de un actualizador de estado, que en
  // React corre en fase de render. Pintar ahi otro estado provoca el aviso de
  // "no puedes actualizar un componente mientras renderizas otro", asi que el
  // cambio visual se saca del render con queueMicrotask. El temporizador si se
  // programa de inmediato: el guardado no debe esperar a nada.
  // Con un conflicto abierto no se reintenta solo: seria estrellarse contra el
  // mismo 409 en cada tecla. Se marca sucio y se espera a que la persona decida.
  const autoSave=useCallback(()=>{if(readOnly)return;dirty.current=true;if(conflict.current)return;queueMicrotask(()=>setSaveState('pendiente'));if(saveTimer.current)clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>{saveRef.current()},800)},[readOnly])

  // Salida de la pagina. Tres puertas, porque ninguna cubre todos los casos:
  // cambiar de pestaña (visibilitychange), cerrar el navegador (beforeunload) y
  // navegar dentro de la app, que no dispara ninguna de las dos (desmontaje).
  useEffect(()=>{
    if(readOnly)return
    const alSalir=(e:BeforeUnloadEvent)=>{if(!dirty.current)return;saveRef.current({keepalive:true});e.preventDefault();e.returnValue=''}
    const alOcultar=()=>{if(document.visibilityState==='hidden'&&dirty.current)saveRef.current({keepalive:true})}
    window.addEventListener('beforeunload',alSalir)
    document.addEventListener('visibilitychange',alOcultar)
    return()=>{window.removeEventListener('beforeunload',alSalir);document.removeEventListener('visibilitychange',alOcultar)}
  },[readOnly])
  useEffect(()=>()=>{
    if(saveTimer.current)clearTimeout(saveTimer.current)
    if(retryTimer.current)clearTimeout(retryTimer.current)
    if(dirty.current)saveRef.current({keepalive:true})
  },[])
  const pushHistory=useCallback((n:any[],e:any[])=>{const h=history.current;h.length=historyIdx.current+1;h.push({nodes:JSON.parse(JSON.stringify(n)),edges:JSON.parse(JSON.stringify(e))});if(h.length>50)h.shift();else historyIdx.current++},[])
  const undo=useCallback(()=>{if(historyIdx.current<=0)return;historyIdx.current--;const s=history.current[historyIdx.current];setNodes(s.nodes);setEdges(s.edges);autoSave()},[setNodes,setEdges,autoSave])
  const redo=useCallback(()=>{if(historyIdx.current>=history.current.length-1)return;historyIdx.current++;const s=history.current[historyIdx.current];setNodes(s.nodes);setEdges(s.edges);autoSave()},[setNodes,setEdges,autoSave])
  const copySelected=useCallback(()=>{const sel=nodes.filter((n:any)=>n.selected);clipboard.current=sel.map((n:any)=>({...n,id:`node-${Date.now()}`}));if(sel.length)toast.success(`${sel.length} copiado${sel.length!==1?'s':''}`)},[nodes])
  const pasteSelected=useCallback(()=>{if(readOnly||!clipboard.current.length)return;const pasted=clipboard.current.map((n:any)=>({...n,id:`node-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,position:{x:n.position.x+40,y:n.position.y+40}}));setNodes((nds:any[])=>{const u=[...nds,...pasted];autoSave();return u})},[setNodes,autoSave,readOnly])
  const onConnect=useCallback((conn:Connection)=>{if(readOnly)return;pushHistory(nodes,edges);setEdges(eds=>{const u=addEdge({...conn,style:{stroke:'#64748b',strokeWidth:2},markerEnd:{type:MarkerType.ArrowClosed,color:'#64748b'}},eds);autoSave();return u})},[setEdges,nodes,autoSave,pushHistory,edges,readOnly])
  const addNode=useCallback((ct:NodeContent['contentType']='text')=>{if(readOnly)return;const id=`node-${Date.now()}`;setNodes((nds:any[])=>{const u=[...nds,{id,type:'custom',position:{x:Math.random()*400+100,y:Math.random()*300+100},data:{label:'Nuevo nodo',content:{contentType:ct,content:''}}}];pushHistory(u,edges);autoSave();return u})},[setNodes,edges,autoSave,pushHistory,readOnly])
  // Nada de funciones dentro de data: ver la nota de FlowDirtyContext arriba.
  const addShape=useCallback((shape:ShapeType)=>{if(readOnly)return;const id=`shape-${Date.now()}`;const dims=shape==='line'?{width:200,height:40}:shape==='grid'?{width:240,height:200}:shape==='text'?{width:160,height:50}:{width:160,height:120};setNodes((nds:any[])=>{const u=[...nds,{id,type:'shape',position:{x:Math.random()*400+50,y:Math.random()*250+50},data:{shape,...dims,label:shape==='text'?'Nuevo texto':'',fill:'#f1f5f9',stroke:'#64748b',rows:3,cols:3}}];pushHistory(u,edges);autoSave();return u})},[setNodes,edges,autoSave,pushHistory,readOnly])
  const deleteSelected=useCallback(()=>{if(readOnly)return;pushHistory(nodes,edges);setTimeout(()=>setNodes((nds:any[])=>{const sel=nds.filter((n:any)=>n.selected);const rest=nds.filter((n:any)=>!n.selected);const ids=new Set(sel.map((n:any)=>n.id));setEdges(eds=>eds.filter(e=>!ids.has(e.source)&&!ids.has(e.target)));autoSave();return rest}),0)},[pushHistory,nodes,edges,setNodes,setEdges,autoSave,readOnly])
  const onKeyDown=useCallback((e:React.KeyboardEvent)=>{if(e.key==='Alt'){setAltHeld(true);e.preventDefault();return};if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;if(readOnly){if(e.ctrlKey&&e.key==='c'){e.preventDefault();copySelected()}return};if(e.ctrlKey&&e.key==='s'){e.preventDefault();save();return};if(e.key==='Delete'||e.key==='Backspace'){deleteSelected()}else if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo()}else if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo()}else if(e.ctrlKey&&e.key==='c'){e.preventDefault();copySelected()}else if(e.ctrlKey&&e.key==='x'){e.preventDefault();copySelected();deleteSelected()}else if(e.ctrlKey&&e.key==='v'){e.preventDefault();pasteSelected()}},[deleteSelected,undo,redo,copySelected,pasteSelected,save,readOnly])
  const onKeyUp = useCallback((e:React.KeyboardEvent)=>{if(e.key==='Alt')setAltHeld(false)},[])
  const onNodesDelete=useCallback((del:Node[])=>{if(readOnly)return;pushHistory(nodes,edges);const ids=new Set(del.map(n=>n.id));setEdges(eds=>eds.filter(e=>!ids.has(e.source)&&!ids.has(e.target)));autoSave()},[setEdges,pushHistory,nodes,edges,autoSave,readOnly])
  const handleNodeDoubleClick=useCallback((_e:React.MouseEvent,node:Node)=>{if(readOnly)return;const d=node.data as any;if('shape'in d&&d.shape){setEditingShapeId(node.id);setShapeW(d.width??160);setShapeH(d.height??120);setShapeLabel(d.label??'');setShapeFill(d.fill??'#f1f5f9');setShapeStroke(d.stroke??'#64748b');setShapeRows(d.rows??3);setShapeCols(d.cols??3);setShapeType(d.shape)}else{setEditingNodeId(node.id);setNodeLabel(d.label||'');setNodeContent(d.content?.content||'');setNodeType(d.content?.contentType||'text');setPreviewHtml(false)}},[readOnly])
  const onDragOver = useCallback((e:React.DragEvent)=>{e.preventDefault();e.dataTransfer.dropEffect='move'},[])
  const onDrop = useCallback((e:React.DragEvent)=>{
    e.preventDefault()
    if(readOnly)return
    const rf=reactFlowInstance.current;if(!rf)return
    const pos=rf.screenToFlowPosition({x:e.clientX,y:e.clientY})
    const type=e.dataTransfer.getData('application/reactflow')
    if(!type)return
    if(type.startsWith('shape:')){const shape=type.replace('shape:','') as ShapeType;const id=`shape-${Date.now()}`;const dims=shape==='line'?{width:200,height:40}:shape==='grid'?{width:240,height:200}:shape==='text'?{width:160,height:50}:{width:160,height:120};setNodes((nds:any[])=>{const u=[...nds,{id,type:'shape',position:pos,data:{shape,...dims,label:shape==='text'?'Nuevo texto':'',fill:'#f1f5f9',stroke:'#64748b',rows:3,cols:3}}];autoSave();return u})}
    else if(type==='text'||type==='html'||type==='url'||type==='document'){const id=`node-${Date.now()}`;setNodes((nds:any[])=>{const u=[...nds,{id,type:'custom',position:pos,data:{label:'Nuevo nodo',content:{contentType:type,content:''}}}];autoSave();return u})}
  },[reactFlowInstance,setNodes,autoSave,readOnly])
  const onNodeDragStop=useCallback(()=>{if(readOnly)return;autoSave();pushHistory(nodes,edges)},[autoSave,pushHistory,nodes,edges,readOnly])
  const onNodeDragStarter=useCallback(()=>{if(readOnly)return;pushHistory(nodes,edges)},[pushHistory,nodes,edges,readOnly])
  const onNodeContextMenu=useCallback((e:React.MouseEvent,node:Node)=>{e.preventDefault();if(readOnly)return;setCtxEdgeMenu(null);setCtxMenu({x:e.clientX,y:e.clientY,nodeId:node.id})},[readOnly])
  const onEdgeContextMenu=useCallback((e:React.MouseEvent,edge:Edge)=>{e.preventDefault();if(readOnly)return;setCtxMenu(null);setCtxEdgeMenu({x:e.clientX,y:e.clientY,edgeId:edge.id})},[readOnly])
  const onPaneClick=useCallback(()=>{setCtxMenu(null);setCtxEdgeMenu(null)},[])
  const bringToFront=useCallback((nodeId:string)=>{setNodes(nds=>{const idx=nds.findIndex((n:any)=>n.id===nodeId);if(idx<0)return nds;const u=[...nds];u.push(u.splice(idx,1)[0]);autoSave();return u});setCtxMenu(null)},[setNodes,autoSave])
  const sendToBack=useCallback((nodeId:string)=>{setNodes(nds=>{const idx=nds.findIndex((n:any)=>n.id===nodeId);if(idx<0)return nds;const u=[...nds];u.unshift(u.splice(idx,1)[0]);autoSave();return u});setCtxMenu(null)},[setNodes,autoSave])
  const duplicateNode=useCallback((nodeId:string)=>{const node=nodes.find((n:any)=>n.id===nodeId);if(!node)return;const newId=`node-${Date.now()}`;setNodes((nds:any[])=>{const u=[...nds,{...node,id:newId,position:{x:node.position.x+40,y:node.position.y+40},selected:false,data:{...node.data}}];autoSave();return u});setCtxMenu(null)},[nodes,setNodes,autoSave])
  const deleteEdge=useCallback((edgeId:string)=>{setEdges(eds=>{const u=eds.filter(e=>e.id!==edgeId);autoSave();return u});setCtxEdgeMenu(null)},[setEdges,autoSave])
  const toggleLock=useCallback((nodeId:string)=>{setNodes((nds:any[])=>{const u=nds.map((n:any)=>n.id===nodeId?{...n,draggable:n.draggable===false?undefined:false,data:{...n.data,locked:n.data?.locked?false:true}}:n);autoSave();return u});setCtxMenu(null)},[setNodes,autoSave])
  const saveContentNode=useCallback(()=>{if(!editingNodeId)return;setNodes((nds:any[])=>{const u=nds.map((n:any)=>n.id===editingNodeId?{...n,data:{...n.data,label:nodeLabel,content:{contentType:nodeType,content:nodeContent}}}:n);autoSave();return u});setEditingNodeId(null)},[editingNodeId,nodeLabel,nodeContent,nodeType,setNodes,autoSave])
  const saveShapeEdit=useCallback(()=>{if(!editingShapeId)return;setNodes((nds:any[])=>{const u=nds.map((n:any)=>n.id===editingShapeId?{...n,data:{...n.data,shape:shapeType,width:shapeW,height:shapeH,label:shapeLabel,fill:shapeFill,stroke:shapeStroke,rows:shapeRows,cols:shapeCols}}:n);autoSave();return u});setEditingShapeId(null)},[editingShapeId,shapeW,shapeH,shapeLabel,shapeFill,shapeStroke,shapeRows,shapeCols,shapeType,setNodes,autoSave])
  const saveEdgeEdit=useCallback(()=>{if(!editingEdgeId)return;setEdges((eds:any[])=>{const u=eds.map((e:any)=>e.id===editingEdgeId?{...e,label:edgeLabel||undefined,style:{...e.style,stroke:edgeColor,strokeWidth:edgeWidth},animated:edgeAnim,type:edgeType==='default'?undefined:edgeType,markerEnd:{type:MarkerType.ArrowClosed,color:edgeColor}}:e);autoSave();return u});setEditingEdgeId(null)},[editingEdgeId,edgeLabel,edgeColor,edgeWidth,edgeAnim,edgeType,setEdges,autoSave])
  const handleExport=useCallback(()=>{const data={title,description,nodes:JSON.parse(JSON.stringify(nodes)),edges:JSON.parse(JSON.stringify(edges))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${title||'flujo'}.wlo.json`;a.click();URL.revokeObjectURL(url);toast.success('Flujo exportado')},[title,description,nodes,edges])
  const handleImport=useCallback(()=>{if(readOnly)return;const el=document.createElement('input');el.type='file';el.accept='.json';el.onchange=async(e:any)=>{const file=e.target.files?.[0];if(!file)return;try{const text=await file.text();const data=JSON.parse(text);if(data.nodes){setNodes(data.nodes);setEdges(data.edges||[]);if(data.title)setTitle(data.title);if(data.description!==undefined)setDescription(data.description);autoSave();toast.success('Flujo importado')}}catch{toast.error('Archivo invalido')}};el.click()},[setNodes,setEdges,setTitle,setDescription,autoSave,readOnly])

  // Indicador honesto. El anterior decia "Auto-guardado" siempre, incluso cuando
  // el guardado habia fallado, que es la peor mentira posible en un editor.
  const horaGuardado = lastSavedAt ? lastSavedAt.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : null
  const indicador = saveState==='guardando'
    ? {texto:'Guardando...',icono:<RefreshCw className="w-3.5 h-3.5 animate-spin"/>,clase:'border-border bg-muted text-muted-foreground',titulo:'Enviando cambios al servidor'}
    : saveState==='pendiente'
    ? {texto:'Sin guardar',icono:<Cloud className="w-3.5 h-3.5"/>,clase:'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',titulo:'Hay cambios que aun no llegan a la base de datos'}
    : saveState==='error'
    ? {texto:'Error, reintentando',icono:<CloudOff className="w-3.5 h-3.5"/>,clase:'border-destructive/40 bg-destructive/10 text-destructive',titulo:'No se pudo guardar. Se reintenta solo.'}
    : saveState==='conflicto'
    ? {texto:'Conflicto',icono:<AlertTriangle className="w-3.5 h-3.5"/>,clase:'border-destructive/40 bg-destructive/10 text-destructive',titulo:'Otra persona guardo cambios sobre este flujo'}
    : {texto:horaGuardado?`Guardado ${horaGuardado}`:'Guardado',icono:<CheckCircle className="w-3.5 h-3.5"/>,clase:'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',titulo:'Todo esta en la base de datos'}

  const shapeTypes = ['rect','circle','line','grid','text'] as ShapeType[]
  const shapeIcons: Record<ShapeType,React.ReactNode> = {rect:<Square className="w-3 h-3"/>,circle:<Circle className="w-3 h-3"/>,line:<Minus className="w-3 h-3"/>,grid:<Grid3X3 className="w-3 h-3"/>,text:<Type className="w-3 h-3"/>}
  const shapeNames: Record<ShapeType,string> = {rect:'Rect',circle:'Circ',line:'Linea',grid:'Grid',text:'Texto'}

  return (
    <div className="flex flex-col h-full" tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onClick={()=>{setCtxMenu(null);setCtxEdgeMenu(null)}}>
      <header className="flex items-center gap-3 px-4 py-2 border-b bg-card shrink-0">
        <LinkNext href={`/w/${workspaceSlug}/flows`} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></LinkNext>
        <input value={title} onChange={e=>{if(readOnly)return;setTitle(e.target.value);autoSave()}} readOnly={readOnly} className="h-8 max-w-xs font-semibold border-0 bg-transparent shadow-none outline-none text-lg px-0" placeholder="Titulo del flujo" />
        <div className="flex-1" />
        {readOnly
          ? <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-1 text-xs font-medium" title="Te compartieron este flujo con permiso de solo ver"><Eye className="w-3.5 h-3.5"/>Solo lectura</span>
          : <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${indicador.clase}`} title={indicador.titulo}>{indicador.icono}{indicador.texto}</span>}
        {!readOnly&&<button onClick={()=>save()} disabled={saveState==='guardando'} className="inline-flex items-center gap-1 rounded-md border bg-background hover:bg-accent h-8 px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50"><Save className="w-4 h-4" />Guardar</button>}
        <button onClick={handleExport} className="inline-flex items-center gap-1 rounded-md border bg-background hover:bg-accent h-8 px-3 py-1 text-sm font-medium transition-colors" title="Exportar"><Download className="w-4 h-4"/>Exportar</button>
        {!readOnly&&<button onClick={handleImport} className="inline-flex items-center gap-1 rounded-md border bg-background hover:bg-accent h-8 px-3 py-1 text-sm font-medium transition-colors" title="Importar"><Upload className="w-4 h-4"/>Importar</button>}
        {!readOnly&&<button onClick={async()=>{setShowShare(true);try{const[r1,r2]=await Promise.all([fetch(`/api/flows/${flowId}`).then(r=>r.json()),fetch(`/api/flows/${flowId}/members`).then(r=>r.json())]);setShares(r1.shares||[]);const ms=r2.profiles||[];if(ms.length)setMembers(ms);else loadMembers()}catch{}}} className="inline-flex items-center gap-1 rounded-md border bg-background hover:bg-accent h-8 px-3 py-1 text-sm font-medium transition-colors" title="Compartir"><Share2 className="w-4 h-4"/>Compartir</button>}
      </header>
      {saveState==='conflicto'&&<div className="flex items-center gap-3 px-4 py-2 border-b bg-destructive/10 text-destructive text-xs shrink-0">
        <AlertTriangle className="w-4 h-4 shrink-0"/>
        <span className="flex-1">Otra persona guardo cambios en este flujo mientras lo editabas. Si guardas encima, pierdes lo que hizo. Recarga para ver su version, o guarda la tuya si estas seguro.</span>
        <button onClick={()=>window.location.reload()} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-background hover:bg-accent h-7 px-2.5 text-xs font-medium"><RefreshCw className="w-3 h-3"/>Recargar</button>
        <button onClick={async()=>{const ok=await save({force:true});if(ok)toast.success('Guardado, se piso la version anterior')}} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-background hover:bg-accent h-7 px-2.5 text-xs font-medium"><Save className="w-3 h-3"/>Guardar la mia</button>
      </div>}
      <div className="flex-1 relative">
        {altHeld && <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 bg-amber-500 text-white text-xs px-3 py-1 rounded-full shadow-lg pointer-events-none">Alt: mover area</div>}
        <style>{`.rf-edges-on-top .react-flow__edges{z-index:50!important}.rf-edges-on-top .react-flow__nodes{z-index:1!important}.rf-edges-on-top .react-flow__edge{stroke-width:2.5}`}</style>
        <FlowDirtyContext.Provider value={autoSave}>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodesDelete={onNodesDelete} onNodeDragStop={onNodeDragStop} onNodeDragStart={onNodeDragStarter} onNodeDoubleClick={handleNodeDoubleClick} onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu} onPaneClick={onPaneClick} onDragOver={onDragOver} onDrop={onDrop} onInit={(rf:any)=>reactFlowInstance.current=rf} nodeTypes={{custom:CustomNode,shape:ShapeNode}} fitView nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={!readOnly} selectNodesOnDrag panOnDrag={altHeld} panActivationKeyCode="Alt" selectionKeyCode="Control" multiSelectionKeyCode="Control" deleteKeyCode={null} selectionMode={SelectionMode.Partial} className="bg-background rf-edges-on-top">
          <Controls /><Background variant={BackgroundVariant.Dots} gap={20} size={1} /><MiniMap nodeColor="#94a3b8" className="!bg-card border" />
          {nodes.filter((n:any)=>n.selected).length > 1 && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none">{nodes.filter((n:any)=>n.selected).length} seleccionados</div>}
        </ReactFlow>
        </FlowDirtyContext.Provider>

        {ctxMenu&&<div className="fixed z-[100] bg-card border rounded-lg shadow-xl p-1 min-w-[170px]" style={{left:ctxMenu.x,top:ctxMenu.y}} onClick={e=>e.stopPropagation()}><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors" onClick={()=>toggleLock(ctxMenu.nodeId)}>{nodes.find((n:any)=>n.id===ctxMenu.nodeId)?.data?.locked?<><Unlock className="w-3 h-3"/>Desbloquear</>:<><Lock className="w-3 h-3"/>Bloquear</>}</button><hr className="my-1"/><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors" onClick={()=>bringToFront(ctxMenu.nodeId)}><ArrowUp className="w-3 h-3"/>Traer al frente</button><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors" onClick={()=>sendToBack(ctxMenu.nodeId)}><ArrowDown className="w-3 h-3"/>Enviar al fondo</button><hr className="my-1"/><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors" onClick={()=>duplicateNode(ctxMenu.nodeId)}><Copy className="w-3 h-3"/>Duplicar</button><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors" onClick={()=>{const nds=nodes.filter((n:any)=>n.id!==ctxMenu.nodeId);setNodes(nds as any);autoSave();setCtxMenu(null)}}><Trash2 className="w-3 h-3 text-destructive"/>Eliminar</button></div>}
        {ctxEdgeMenu&&<div className="fixed z-[100] bg-card border rounded-lg shadow-xl p-1 min-w-[170px]" style={{left:ctxEdgeMenu.x,top:ctxEdgeMenu.y}} onClick={e=>e.stopPropagation()}><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors" onClick={()=>{const e=edges.find((ed:any)=>ed.id===ctxEdgeMenu.edgeId);if(e){setEditingEdgeId(e.id);setEdgeLabel(typeof e.label==='string'?e.label:'');setEdgeColor(String(e.style?.stroke??'#64748b'));setEdgeWidth(Number(e.style?.strokeWidth??2));setEdgeAnim(e.animated||false);setEdgeType(e.type||'default');setCtxEdgeMenu(null)}}}><Settings className="w-3 h-3"/>Propiedades</button><hr className="my-1"/><button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors text-destructive" onClick={()=>deleteEdge(ctxEdgeMenu.edgeId)}><Trash2 className="w-3 h-3"/>Eliminar</button></div>}

        {!readOnly&&<div className="absolute bg-card border rounded-lg shadow-lg z-20 transition-all" style={{right:toolPos.x||12,top:toolPos.y||60,width:toolCollapsed?40:180}}>
          <div className="flex items-center justify-between px-2 py-1.5 border-b cursor-move select-none" onMouseDown={e=>{e.preventDefault();const sx=e.clientX,sy=e.clientY,ox=toolPos.x,oy=toolPos.y;const m=(ev:MouseEvent)=>setToolPos({x:ox-(ev.clientX-sx),y:oy+(ev.clientY-sy)});const u=()=>{window.removeEventListener('mousemove',m);window.removeEventListener('mouseup',u)};window.addEventListener('mousemove',m);window.addEventListener('mouseup',u)}}>
            <span className="text-[10px] font-medium text-muted-foreground">{toolCollapsed?'':'Herramientas'}</span>
            <div className="flex items-center gap-0.5">
              <button onClick={toggleFullscreen} className="p-0.5 hover:bg-accent rounded" title="Pantalla completa"><Maximize className="w-3 h-3"/></button>
              <button onClick={()=>setToolCollapsed(!toolCollapsed)} className="p-0.5 hover:bg-accent rounded"><ChevronUp className={`w-3 h-3 transition-transform ${toolCollapsed?'rotate-180':''}`}/></button>
            </div>
          </div>
          {!toolCollapsed&&<div className="flex flex-col gap-1 p-2">
            <span className="text-[10px] font-medium text-muted-foreground px-1">Contenido</span>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab active:cursor-grabbing" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','text');e.dataTransfer.effectAllowed='move'}} onClick={()=>addNode('text')} title="Clic para agregar, o arrastra al lienzo"><Type className="w-3.5 h-3.5"/>Texto</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab active:cursor-grabbing" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','html');e.dataTransfer.effectAllowed='move'}} onClick={()=>addNode('html')} title="Clic para agregar, o arrastra al lienzo"><Code className="w-3.5 h-3.5"/>HTML</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab active:cursor-grabbing" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','url');e.dataTransfer.effectAllowed='move'}} onClick={()=>addNode('url')} title="Clic para agregar, o arrastra al lienzo"><LinkIcon className="w-3.5 h-3.5"/>URL</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab active:cursor-grabbing" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','document');e.dataTransfer.effectAllowed='move'}} onClick={()=>addNode('document')} title="Clic para agregar, o arrastra al lienzo"><FileText className="w-3.5 h-3.5"/>Documento</button>
            <hr className="my-0.5"/><span className="text-[10px] font-medium text-muted-foreground px-1">Dibujo</span>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','shape:rect');e.dataTransfer.effectAllowed='move'}} onClick={()=>addShape('rect')} title="Clic para agregar, o arrastra al lienzo"><Square className="w-3.5 h-3.5"/>Rectangulo</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','shape:circle');e.dataTransfer.effectAllowed='move'}} onClick={()=>addShape('circle')} title="Clic para agregar, o arrastra al lienzo"><Circle className="w-3.5 h-3.5"/>Circulo</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','shape:line');e.dataTransfer.effectAllowed='move'}} onClick={()=>addShape('line')} title="Clic para agregar, o arrastra al lienzo"><Minus className="w-3.5 h-3.5"/>Linea</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','shape:grid');e.dataTransfer.effectAllowed='move'}} onClick={()=>addShape('grid')} title="Clic para agregar, o arrastra al lienzo"><Grid3X3 className="w-3.5 h-3.5"/>Cuadricula</button>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors cursor-grab" draggable onDragStart={e=>{e.dataTransfer.setData('application/reactflow','shape:text');e.dataTransfer.effectAllowed='move'}} onClick={()=>addShape('text')} title="Clic para agregar, o arrastra al lienzo"><Type className="w-3.5 h-3.5"/>Texto</button>
            <hr className="my-0.5"/>
            <button className="inline-flex items-center justify-start gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent text-destructive transition-colors" onClick={deleteSelected}><Trash2 className="w-3.5 h-3.5"/>Eliminar</button>
          </div>}
        </div>}
      </div>
      {description!==undefined&&<footer className="px-4 py-2 border-t bg-card shrink-0"><input value={description} onChange={e=>{if(readOnly)return;setDescription(e.target.value);autoSave()}} readOnly={readOnly} className="h-8 w-full border-0 bg-transparent shadow-none outline-none text-xs text-muted-foreground" placeholder={readOnly?'Sin descripcion':'Descripcion (opcional)'}/></footer>}
      {editingNodeId&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setEditingNodeId(null)}><div className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between px-5 py-3 border-b shrink-0"><div className="flex items-center gap-2">{icons[nodeType]}<span className="font-semibold text-sm">Editar nodo</span></div><button onClick={()=>setEditingNodeId(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button></div><div className="flex-1 overflow-y-auto p-5 space-y-4"><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre</label><input value={nodeLabel} onChange={e=>setNodeLabel(e.target.value)} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"/></div><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label><div className="flex gap-1">{(['text','html','url','document']as const).map(t=><button key={t} onClick={()=>{setNodeType(t);setPreviewHtml(false)}} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${nodeType===t?'bg-primary text-primary-foreground':'bg-muted hover:bg-accent'}`}>{icons[t]}{t==='text'?'Texto':t==='html'?'HTML':t==='url'?'URL':'Doc'}</button>)}</div></div><div><div className="flex items-center justify-between mb-1"><label className="text-xs font-medium text-muted-foreground">{nodeType==='url'?'URL':'Contenido'}</label>{nodeType==='html'&&<button onClick={()=>setPreviewHtml(!previewHtml)} className={`inline-flex items-center gap-1 text-xs rounded px-2 py-0.5 transition-colors ${previewHtml?'bg-primary text-primary-foreground':'bg-muted hover:bg-accent'}`}>{previewHtml?<Edit3 className="w-3 h-3"/>:<Eye className="w-3 h-3"/>}{previewHtml?'Codigo':'Preview'}</button>}</div>{nodeType==='html'&&previewHtml?<div className="w-full min-h-[200px] rounded-md border bg-white p-4 text-sm overflow-auto" dangerouslySetInnerHTML={{__html:nodeContent}}/>:<textarea value={nodeContent} onChange={e=>setNodeContent(e.target.value)} className="w-full min-h-[200px] rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20 resize-y" placeholder={nodeType==='url'?'https://ejemplo.com':nodeType==='html'?'<div><h1>Hola</h1></div>':'Contenido...'}/>}</div></div><div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"><button onClick={()=>setEditingNodeId(null)} className="inline-flex items-center rounded-md bg-muted hover:bg-accent h-9 px-4 py-2 text-sm font-medium">Cancelar</button><button onClick={saveContentNode} className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 text-sm font-medium"><Save className="w-4 h-4"/>Guardar</button></div></div></div>}
      {editingShapeId&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setEditingShapeId(null)}><div className="bg-card border rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col m-4" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between px-5 py-3 border-b shrink-0"><span className="font-semibold text-sm">Propiedades</span><button onClick={()=>setEditingShapeId(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button></div><div className="flex-1 overflow-y-auto p-5 space-y-4"><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Ancho</label><input type="number" value={shapeW} onChange={e=>setShapeW(Number(e.target.value))} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" min={20} max={1200}/></div><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Alto</label><input type="number" value={shapeH} onChange={e=>setShapeH(Number(e.target.value))} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" min={20} max={1200}/></div></div><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Etiqueta</label><input value={shapeLabel} onChange={e=>setShapeLabel(e.target.value)} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="Texto de la etiqueta"/></div><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Relleno</label><div className="flex gap-2"><input type="color" value={shapeFill} onChange={e=>setShapeFill(e.target.value)} className="w-9 h-9 rounded border cursor-pointer"/><input value={shapeFill} onChange={e=>setShapeFill(e.target.value)} className="flex-1 h-9 rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"/></div></div><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Borde</label><div className="flex gap-2"><input type="color" value={shapeStroke} onChange={e=>setShapeStroke(e.target.value)} className="w-9 h-9 rounded border cursor-pointer"/><input value={shapeStroke} onChange={e=>setShapeStroke(e.target.value)} className="flex-1 h-9 rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"/></div></div></div>{shapeType==='grid'&&<div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Columnas</label><input type="number" value={shapeCols} onChange={e=>setShapeCols(Number(e.target.value))} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" min={1} max={20}/></div><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Filas</label><input type="number" value={shapeRows} onChange={e=>setShapeRows(Number(e.target.value))} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" min={1} max={20}/></div></div>}<div className="flex gap-1">{shapeTypes.map(t=><button key={t} onClick={()=>setShapeType(t)} className={`flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${shapeType===t?'bg-primary text-primary-foreground':'bg-muted hover:bg-accent'}`}>{shapeIcons[t]}{shapeNames[t]}</button>)}</div></div><div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"><button onClick={()=>setEditingShapeId(null)} className="inline-flex items-center rounded-md bg-muted hover:bg-accent h-9 px-4 py-2 text-sm font-medium">Cancelar</button><button onClick={saveShapeEdit} className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 text-sm font-medium"><Save className="w-4 h-4"/>Guardar</button></div></div></div>}
      {editingEdgeId&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setEditingEdgeId(null)}><div className="bg-card border rounded-xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col m-4" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between px-5 py-3 border-b shrink-0"><span className="font-semibold text-sm">Propiedades de linea</span><button onClick={()=>setEditingEdgeId(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button></div><div className="flex-1 overflow-y-auto p-5 space-y-4"><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Etiqueta</label><input value={edgeLabel} onChange={e=>setEdgeLabel(e.target.value)} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="Texto sobre la linea"/></div><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Color</label><div className="flex gap-2"><input type="color" value={edgeColor} onChange={e=>setEdgeColor(e.target.value)} className="w-9 h-9 rounded border cursor-pointer"/><input value={edgeColor} onChange={e=>setEdgeColor(e.target.value)} className="flex-1 h-9 rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"/></div></div><div><label className="text-xs font-medium text-muted-foreground mb-1 block">Grosor</label><input type="number" value={edgeWidth} onChange={e=>setEdgeWidth(Number(e.target.value))} className="w-full h-9 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" min={1} max={10}/></div></div><div className="flex gap-1">{['default','straight','step','smoothstep'].map(t=><button key={t} onClick={()=>setEdgeType(t)} className={`flex-1 inline-flex items-center justify-center rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${edgeType===t?'bg-primary text-primary-foreground':'bg-muted hover:bg-accent'}`}>{t==='default'?'Curva':t==='straight'?'Recta':t==='step'?'Escalon':'Suave'}</button>)}</div><label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={edgeAnim} onChange={e=>setEdgeAnim(e.target.checked)} className="rounded"/>Animada</label></div><div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"><button onClick={()=>setEditingEdgeId(null)} className="inline-flex items-center rounded-md bg-muted hover:bg-accent h-9 px-4 py-2 text-sm font-medium">Cancelar</button><button onClick={saveEdgeEdit} className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 text-sm font-medium"><Save className="w-4 h-4"/>Guardar</button></div></div></div>}
      {showShare&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowShare(false)}><div className="bg-card border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col m-4" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between px-5 py-3 border-b shrink-0"><span className="font-semibold text-sm">Compartir flujo</span><button onClick={()=>setShowShare(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button></div><div className="flex-1 overflow-y-auto p-5 space-y-3"><div className="flex items-center gap-2"><select value={sharePerm} onChange={e=>setSharePerm(e.target.value as any)} className="h-8 rounded-md border bg-background px-2 py-1 text-xs outline-none"><option value="view">Solo ver</option><option value="edit">Puede editar</option></select><span className="text-xs text-muted-foreground">Selecciona miembros:</span></div><div className="max-h-64 overflow-y-auto space-y-0.5 border rounded-md p-1">{members.filter((m:any)=>m.id!==(nodes[0]as any)?.data?.created_by).map((m:any)=>{const isShared=shares.some((s:any)=>s.profile?.id===m.id);return <button key={m.id} onClick={async()=>{if(isShared){const s=shares.find((x:any)=>x.profile?.id===m.id);if(s){try{const r=await fetch(`/api/flows/${flowId}/shares?shareId=${s.id}`,{method:'DELETE'});if(r.ok)setShares(shares.filter((x:any)=>x.id!==s.id))}catch{}}}else{try{const r=await fetch(`/api/flows/${flowId}/shares`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile_id:m.id,permission:sharePerm})});if(r.ok){const ns=await r.json();setShares([...shares,ns])}else toast.error('Error')}catch{toast.error('Error')}}}} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${isShared?'bg-primary/10 hover:bg-primary/20':'hover:bg-accent'}`}><div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold flex-shrink-0">{m.display_name?.[0]||m.email?.[0]||'?'}</div><span className="flex-1 text-left truncate">{m.display_name||m.email}</span>{isShared&&<span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{shares.find((s:any)=>s.profile?.id===m.id)?.permission==='edit'?'editar':'ver'}</span>}</button>})}</div>{members.length===0&&<p className="text-xs text-muted-foreground text-center py-4">Cargando miembros...</p>}</div></div></div>}
    </div>
  )
}
