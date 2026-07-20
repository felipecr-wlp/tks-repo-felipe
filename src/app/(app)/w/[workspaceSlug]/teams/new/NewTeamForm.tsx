'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'

const schema = z.object({
  name:        z.string().min(2, 'Mínimo 2 caracteres').max(80).trim(),
  description: z.string().max(300).trim().optional(),
  space_id:    z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface Department {
  id: string
  name: string
  icon: string | null
  is_restricted: boolean
}

interface NewTeamFormProps {
  workspaceId: string
  workspaceSlug: string
  departments: Department[]
}

export function NewTeamForm({ workspaceId, workspaceSlug, departments }: NewTeamFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          space_id: data.space_id ? data.space_id : null,
          workspace_id: workspaceId,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Error al crear el equipo')
      toast.success('Equipo creado')
      router.push(`/w/${workspaceSlug}/t/${result.slug}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          Nombre del equipo <span className="text-destructive">*</span>
        </label>
        <input
          id="name"
          {...register('name')}
          placeholder="Ej: Equipo de Producto"
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="space_id" className="text-sm font-medium text-foreground">
          Departamento <span className="text-muted-foreground text-xs">(opcional)</span>
        </label>
        <select
          id="space_id"
          {...register('space_id')}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">Sin departamento (visible a todo el workspace)</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.is_restricted ? ' (restringido)' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          En un departamento restringido, el equipo solo lo verán sus miembros y los administradores.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium text-foreground">
          Descripción <span className="text-muted-foreground text-xs">(opcional)</span>
        </label>
        <textarea
          id="description"
          {...register('description')}
          placeholder="¿Qué hace este equipo?"
          rows={3}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => router.back()} disabled={isLoading}
          className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
          {isLoading ? (
            <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Creando...</>
          ) : 'Crear equipo'}
        </button>
      </div>
    </form>
  )
}
