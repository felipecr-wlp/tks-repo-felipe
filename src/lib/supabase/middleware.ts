/**
 * Helper de Supabase para el middleware de Next.js.
 * Refresca la sesión en cada request.
 *
 * SOBRE LA FALTA DE CONFIGURACION: antes las dos variables se leian con `!`, asi
 * que si faltaban `createServerClient` lanzaba y el middleware, que corre en
 * TODAS las rutas, devolvia un 500 opaco ("Your project's URL and Key are
 * required to create a Supabase client!") en la aplicacion entera. No es
 * hipotetico: paso en los deploys de PREVIEW, donde el entorno Preview no tiene
 * las variables, y el resultado es que nadie puede probar una rama en su URL de
 * preview y el error no dice cual variable falta.
 *
 * Ahora se degrada en vez de reventar: sin configuracion no hay sesion posible,
 * asi que se devuelve `user: null` y el middleware manda a /auth/login. Falla
 * CERRADO (nadie entra sin sesion) y deja en el log el nombre exacto de la
 * variable que falta, que es la diferencia entre un 500 mudo y un arreglo de un
 * minuto.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { Database } from './types'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    const faltan = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !anonKey && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ].filter(Boolean).join(', ')
    console.error(
      `[middleware] Supabase sin configurar, falta: ${faltan}. ` +
      'Todo el sitio queda sin sesion hasta que se defina en este entorno de Vercel.'
    )
    return { supabaseResponse, user: null }
  }

  const supabase = createServerClient<Database>(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  return { supabaseResponse, user }
}
