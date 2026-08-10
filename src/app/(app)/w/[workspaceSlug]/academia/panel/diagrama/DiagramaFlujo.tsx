'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
// React Flow tipa nodos y edges de forma dinamica; tipar cada acceso aqui no
// aporta seguridad real. Misma decision (y misma razon) que en FlowEditor.

/**
 * Diagrama de flujo de la Academia: arrastras videos, los conectas, y CADA
 * CONEXION es una opcion de la pregunta que ramifica.
 *
 * POR QUE EXISTE. Hasta ahora ramificar era pegar un UUID en un cuadro de
 * texto. Eso no es autoria, es adivinanza: no se ve el arbol, no se detecta un
 * callejon sin salida, y un caracter de mas convierte la opcion en un boton
 * roto que solo aparece reproduciendo.
 *
 * LA DECISION QUE LO HACE HONESTO: el diagrama NO tiene su propia copia del
 * arbol. Cada arista que dibujas ESCRIBE la opcion en la pregunta del video de
 * origen, y al abrirlo las aristas se LEEN de esas mismas preguntas. Es la
 * misma fuente que usa el reproductor, asi que el diagrama no puede
 * desincronizarse de lo que la gente vive al reproducir. Lo unico que el
 * diagrama guarda para si es la POSICION de cada caja (diagram_x/y), que es
 * presentacion pura y no cambia el comportamiento.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ReactFlow, Controls, Background, MiniMap, useNodesState, useEdgesState,
  type Connection, type Node, type Edge, BackgroundVariant, type NodeProps,
  Handle, Position, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import {
  ArrowLeft, Save, Play, Users, Lock, HelpCircle, GitBranch, Trash2, Info,
} from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import type { VideoAcademia, Interaccion, OpcionInteraccion } from '@/lib/academy/videos'
import { describirAudiencia } from '@/lib/academy/visibilidad'

interface Props {
  workspaceSlug: string
  videos: VideoAcademia[]
  /** Cuantas personas nombradas por video, para la etiqueta de audiencia. */
  nombradasPorVideo: Record<string, number>
}

/** Segundo en el que se crea una pregunta nueva al conectar dos videos. */
const SEGUNDO_POR_DEFECTO = 5

function NodoVideo({ data }: NodeProps) {
  const d = data as any
  return (
    <div
      className={`w-56 rounded-xl border-2 bg-card shadow-sm ${
        d.esEntrada ? 'border-primary' : 'border-border'
      }`}
    >
      {/* Entrada arriba, salida abajo: el flujo se lee de arriba a abajo, que
          es como se lee todo lo demas. */}
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-muted-foreground" />
      <div className="border-b border-border px-3 py-2">
        <p className="truncate text-sm font-semibold text-foreground">{d.titulo}</p>
      </div>
      <div className="space-y-1 px-3 py-2 text-[11px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          {d.audiencia === 'todos'
            ? <Users className="h-3 w-3" />
            : <Lock className="h-3 w-3 text-amber-500" />}
          {d.audienciaTexto}
        </p>
        <p className="flex items-center gap-1.5">
          <HelpCircle className="h-3 w-3" /> {d.nPreguntas} preguntas · {d.nSalidas} salidas
        </p>
        {d.borrador && (
          <span className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
            Borrador
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !bg-primary" />
    </div>
  )
}

const TIPOS_NODO = { video: NodoVideo }

export function DiagramaFlujo({ workspaceSlug, videos, nombradasPorVideo }: Props) {
  const t = useT()
  const [guardando, setGuardando] = useState(false)
  const [sucio, setSucio] = useState(false)
  const [sel, setSel] = useState<string | null>(null)

  const nodosIniciales = useMemo<Node[]>(() => videos.map((v, i) => ({
    id: v.id,
    type: 'video',
    // Sin posicion guardada se acomodan en rejilla: mejor una cuadricula
    // ordenada que todas las cajas encimadas en el origen.
    position: {
      x: v.diagram_x ?? (i % 4) * 260,
      y: v.diagram_y ?? Math.floor(i / 4) * 200,
    },
    data: {
      titulo: v.title,
      audiencia: v.audience,
      audienciaTexto: describirAudiencia(v, nombradasPorVideo[v.id] ?? 0),
      nPreguntas: v.interactions.length,
      nSalidas: v.interactions.reduce((a, it) => a + it.opts.filter((o) => o.go).length, 0),
      borrador: v.status !== 'live',
    },
  })), [videos, nombradasPorVideo])

  // Las aristas se DERIVAN de las opciones: no hay una segunda copia del arbol.
  const aristasIniciales = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    for (const v of videos) {
      v.interactions.forEach((it, iIdx) => {
        it.opts.forEach((o, oIdx) => {
          if (!o.go) return
          out.push({
            id: `${v.id}:${iIdx}:${oIdx}`,
            source: v.id,
            target: o.go,
            label: o.t,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          })
        })
      })
    }
    return out
  }, [videos])

  const [nodes, setNodes, onNodesChange] = useNodesState(nodosIniciales)
  const [edges, setEdges, onEdgesChange] = useEdgesState(aristasIniciales)

  // Mapa vivo id -> interacciones, que es lo que se guarda al final.
  const interaccionesRef = useRef<Map<string, Interaccion[]>>(
    new Map(videos.map((v) => [v.id, v.interactions.map((it) => ({ ...it, opts: [...it.opts] }))])),
  )

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return
    if (c.source === c.target) {
      // Un video que se conecta a si mismo es un bucle infinito visual sin
      // sentido: la pregunta reaparece sin haber avanzado nada.
      toast.error(t('academyD.noSelf'))
      return
    }
    const etiqueta = window.prompt(t('academyD.optionPrompt'))
    if (!etiqueta?.trim()) return

    const its = interaccionesRef.current.get(c.source) ?? []
    const destino = videos.find((v) => v.id === c.target)
    const nueva: OpcionInteraccion = { t: etiqueta.trim(), go: c.target }

    if (its.length === 0) {
      // Primera conexion: nace la pregunta. Sin `a` = ramificacion, que es lo
      // que quiere alguien dibujando caminos.
      its.push({ s: SEGUNDO_POR_DEFECTO, q: t('academyD.defaultQuestion'), opts: [nueva] })
    } else {
      // Ya hay pregunta: se agrega como una opcion mas de la primera.
      its[0].opts.push(nueva)
    }
    interaccionesRef.current.set(c.source, its)

    setEdges((e) => [...e, {
      id: `${c.source}:nuevo:${e.length}`,
      source: c.source!,
      target: c.target!,
      label: etiqueta.trim(),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 2 },
    }])
    setSucio(true)
    toast.success(`${t('academyD.linked')} ${destino?.title ?? ''}`)
  }, [setEdges, t, videos])

  const onEdgesDelete = useCallback((borradas: Edge[]) => {
    for (const e of borradas) {
      const its = interaccionesRef.current.get(e.source)
      if (!its) continue
      for (const it of its) {
        const i = it.opts.findIndex((o) => o.go === e.target && o.t === e.label)
        if (i !== -1) it.opts.splice(i, 1)
      }
      // Una pregunta que se queda con menos de dos opciones no es una
      // pregunta: se retira entera en vez de guardar algo que el validador
      // del server rechazaria despues, ya con el usuario esperando.
      interaccionesRef.current.set(e.source, its.filter((it) => it.opts.length >= 2))
    }
    setSucio(true)
  }, [])

  const onNodeDragStop = useCallback(() => setSucio(true), [])

  async function guardar() {
    if (guardando) return
    setGuardando(true)
    try {
      // Se guarda video por video: solo los que cambiaron de posicion o de
      // ramas. Un guardado masivo de todo el catalogo por mover una caja
      // seria el mismo pecado del documento entero de la pizarra.
      const porId = new Map(nodes.map((n) => [n.id, n.position]))
      const errores: string[] = []
      for (const v of videos) {
        const pos = porId.get(v.id)
        const its = interaccionesRef.current.get(v.id) ?? []
        const cambioPos = pos && (pos.x !== v.diagram_x || pos.y !== v.diagram_y)
        const cambioRamas = JSON.stringify(its) !== JSON.stringify(v.interactions)
        if (!cambioPos && !cambioRamas) continue

        const cuerpo: Record<string, unknown> = {}
        if (cambioPos && pos) { cuerpo.diagramX = pos.x; cuerpo.diagramY = pos.y }
        if (cambioRamas) cuerpo.interactions = its

        const res = await fetch(`/api/academy/videos/${v.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          errores.push(`${v.title}: ${j.error ?? res.status}`)
        }
      }
      if (errores.length > 0) throw new Error(errores.join(' | '))
      toast.success(t('academyD.saved'))
      setSucio(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'), { duration: 12000 })
    } finally {
      setGuardando(false)
    }
  }

  // Guardia al salir con cambios sin guardar, igual que el editor de notas.
  useEffect(() => {
    if (!sucio) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sucio])

  const videoSel = sel ? videos.find((v) => v.id === sel) : null

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/w/${workspaceSlug}/academia/panel`}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {t('academyD.back')}
          </Link>
          <h1 className="text-lg font-bold text-foreground">{t('academyD.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {sucio && <span className="text-xs font-medium text-amber-600 dark:text-amber-500">{t('academyD.unsaved')}</span>}
          <button
            onClick={guardar}
            disabled={!sucio || guardando}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> {t('academyD.save')}
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('academyD.hint')}
      </p>

      <div className="relative flex-1">
        {videos.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t('academyD.empty')}</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, n) => setSel(n.id)}
            nodeTypes={TIPOS_NODO}
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} />
            <Controls />
            {/* El minimapa se esconde en telefono: ahi cada pixel cuenta. */}
            <MiniMap className="!hidden sm:!block" pannable zoomable />
          </ReactFlow>
        )}

        {videoSel && (
          <div className="absolute right-3 top-3 w-64 rounded-xl border border-border bg-card p-3 shadow-lg">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{videoSel.title}</p>
              <button onClick={() => setSel(null)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                <Trash2 className="hidden h-4 w-4" />
                <span className="text-xs">✕</span>
              </button>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                {videoSel.interactions.reduce((a, it) => a + it.opts.filter((o) => o.go).length, 0)} {t('academyD.exits')}
              </p>
              <p className="flex items-center gap-1.5">
                {videoSel.audience === 'todos' ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-amber-500" />}
                {describirAudiencia(videoSel, nombradasPorVideo[videoSel.id] ?? 0)}
              </p>
            </div>
            <Link
              href={`/w/${workspaceSlug}/academia/videos/${videoSel.id}`}
              className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <Play className="h-3.5 w-3.5" /> {t('academyD.openVideo')}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
