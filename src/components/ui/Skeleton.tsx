/**
 * Primitivo de skeleton (placeholder de carga), Circuito B27.
 * Usado por los loading.tsx de rutas pesadas para evitar el flash en blanco
 * mientras el Server Component trae datos. Un solo lugar para el look and
 * feel del shimmer, reusado por todos los skeletons de pagina.
 */
import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/70 dark:bg-muted/40', className)}
      {...props}
    />
  )
}
