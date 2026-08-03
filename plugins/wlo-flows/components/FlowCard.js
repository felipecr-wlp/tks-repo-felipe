'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PenTool, Lock, Globe, Users, Building2, Pencil, ExternalLink, Check, X, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const visibilityIcons: Record<string, React.ReactNode> = { private:<Lock className="w-3 h-3"/>, project:<Building2 className="w-3 h-3"/>, team:<Users className="w-3 h-3"/>, workspace:<Globe className="w-3 h-3"/> }
const visibilityLabels: Record<string, string> = { private:'Privado', workspace:'Workspace', project:'Proyecto', team:'Equipo' }

interface FlowCardProps {
  flowId: string; title: string; description: string|null; visibility: string
  updatedAt: string; author: string; workspaceSlug: string
}

export function FlowCard({ flowId, title: initialTitle, description: initialDesc, visibility, updatedAt, author, workspaceSlug }: FlowCardProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(initialTitle)
  const [editDesc, setEditDesc] = useState(initialDesc ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) titleRef.current?.focus() }, [editing])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/flows/${flowId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title:editTitle, description:editDesc||null }) })
      if(!res.ok) throw new Error('Error')
      setEditing(false); router.refresh()
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  const cancel = () => { setEditTitle(initialTitle); setEditDesc(initialDesc??''); setEditing(false) }

  const del = async () => {
    setSaving(true)
    try { const r=await fetch(`/api/flows/${flowId}`,{method:'DELETE'}); if(!r.ok)throw new Error('Error'); router.refresh() }
    catch { toast.error('Error al eliminar'); setConfirmDelete(false) }
    finally { setSaving(false) }
  }

  return (
    <div className="group border rounded-xl p-4 hover:border-primary/30 hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <PenTool className="w-5 h-5 text-primary/60" />
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {visibilityIcons[visibility]}{visibilityLabels[visibility]}
          </span>
          <button onClick={() => router.push(`/w/${workspaceSlug}/flows/${flowId}`)} className="p-1 hover:bg-accent rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Abrir">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input ref={titleRef} value={editTitle} onChange={e=>setEditTitle(e.target.value)} className="w-full font-medium text-sm border rounded px-2 py-1 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Titulo" />
          <textarea value={editDesc} onChange={e=>setEditDesc(e.target.value)} className="w-full text-xs text-muted-foreground border rounded px-2 py-1 outline-none focus:ring-2 focus:ring-primary/20 resize-none" rows={2} placeholder="Descripcion (opcional)" />
          <div className="flex items-center gap-1">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 px-2 py-1 transition-colors"><Check className="w-3 h-3"/>{saving?'...':'Guardar'}</button>
            <button onClick={cancel} className="inline-flex items-center gap-1 text-xs rounded bg-muted hover:bg-accent px-2 py-1 transition-colors"><X className="w-3 h-3"/>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 mb-1">
            <h3 className="font-medium truncate">{editTitle}</h3>
            <button onClick={() => setEditing(true)} className="p-0.5 hover:bg-accent rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" title="Editar"><Pencil className="w-3 h-3 text-muted-foreground" /></button>
            <button onClick={() => setConfirmDelete(true)} className="p-0.5 hover:bg-accent rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" title="Eliminar"><Trash2 className="w-3 h-3 text-muted-foreground" /></button>
          </div>
          {editDesc && <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{editDesc}</p>}
        </>
      )}

      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
        <span>{author}</span><span>&middot;</span><span>{new Date(updatedAt).toLocaleDateString('es-MX')}</span>
      </div>

      {confirmDelete && (
        <div className="mt-2 p-2 rounded-md border border-destructive/30 bg-destructive/5">
          <p className="text-xs mb-2">Eliminar &quot;{initialTitle}&quot;?</p>
          <div className="flex items-center gap-1">
            <button onClick={del} disabled={saving} className="inline-flex items-center gap-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 px-2 py-1 transition-colors"><Trash2 className="w-3 h-3"/>{saving?'...':'Eliminar'}</button>
            <button onClick={()=>setConfirmDelete(false)} className="inline-flex items-center gap-1 text-xs rounded bg-muted hover:bg-accent px-2 py-1 transition-colors"><X className="w-3 h-3"/>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
