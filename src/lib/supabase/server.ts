/**
 * Supabase client para uso en el servidor (RSC, Route Handlers).
 * Lee la sesión desde cookies del request, NUNCA usar en el browser.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSbClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from './types'

export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignorar en Server Components (solo lectura)
          }
        },
      },
    }
  )
}

/**
 * Cliente service_role para operaciones admin (solo en Route Handlers seguros).
 * NUNCA exponer al browser.
 */
export function createAdminClient() {
  return createSbClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
