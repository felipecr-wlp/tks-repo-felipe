# Skill: Generar Componente React

Genera componentes React para el proyecto Work OS siguiendo sus patrones establecidos.

## Argumento
$ARGUMENTS — descripción del componente (ej: "TaskCard para vista kanban" o "WorkspaceSwitcher sidebar")

## Decisiones por defecto

- Server Component a menos que necesite estado/eventos → entonces `'use client'`
- shadcn/ui + Tailwind para estilos — nunca CSS modules ni styled-components
- Lucide React para iconos
- TanStack Query para datos remotos — nunca fetch directo en useEffect
- Sonner (`toast`) para feedback al usuario
- Formularios: React Hook Form + Zod resolver
- Skeleton loaders con `animate-pulse` mientras carga
- Siempre tipar props con TypeScript — nunca `any`

## Estructura de componente cliente típico

```typescript
'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { [Icon] } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Database } from '@/lib/supabase/types'

// Tipo derivado del schema de Supabase (siempre de types.ts)
type [Entidad] = Database['public']['Tables']['[tabla]']['Row']

interface [Componente]Props {
  [prop]: [tipo]
}

export function [Componente]({ [prop] }: [Componente]Props) {
  // 1. Estado local mínimo
  // 2. Query con TanStack (staleTime según tipo de dato)
  // 3. Mutación con invalidación de cache
  // 4. Render con loading/error states

  return (
    <div className="...">
      {/* contenido */}
    </div>
  )
}
```

## Componente servidor típico (data fetching)

```typescript
// Sin 'use client' — RSC
import { createClient } from '@/lib/supabase/server'
import { [ClientComponent] } from './[ClientComponent]'

export async function [Componente]({ workspaceId }: { workspaceId: string }) {
  const supabase = createClient()

  // Columnas explícitas — nunca select *
  const { data, error } = await supabase
    .from('[tabla]')
    .select('id, name, color')
    .eq('workspace_id', workspaceId)
    .order('created_at')
    .limit(50)

  if (error) return <div>Error cargando datos</div>

  return <[ClientComponent] items={data} />
}
```

## Lazy load para componentes pesados

```typescript
// Para Excalidraw, Tiptap completo, o componentes +50KB
import dynamic from 'next/dynamic'

const HeavyComponent = dynamic(
  () => import('@/components/[path]/HeavyComponent'),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-muted rounded-lg h-[400px]" />
    ),
  }
)
```

## Patrones de Realtime en componentes

```typescript
// Solo suscribirse a lo necesario
useEffect(() => {
  const channel = supabase
    .channel(`[tabla]:${id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: '[tabla]',
      filter: `[columna]=eq.${id}` // siempre filtrar
    }, (payload) => {
      queryClient.invalidateQueries({ queryKey: ['[recurso]', id] })
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) } // cleanup obligatorio
}, [id])
```

## Instrucciones

Al invocar `/gen-component [descripción]`, genera el componente completo con:
- Tipos correctos desde `Database` de Supabase
- Loading y error states
- Patrones de egress (columnas explícitas, paginación si lista)
- Cleanup de suscripciones si usa Realtime
