'use client'

/**
 * TanStack Query Provider — envuelve toda la app protegida.
 * Configuración de stale times por defecto alineados con estrategia de egress.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Datos no cambian tan seguido — evitar over-fetching
            staleTime: 2 * 60 * 1000, // 2 minutos por defecto
            gcTime:   10 * 60 * 1000, // 10 minutos en cache
            retry: 1,
            refetchOnWindowFocus: false, // reducir egress innecesario
          },
          mutations: {
            onError: (error) => {
              console.error('[Mutation Error]', error)
            },
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
