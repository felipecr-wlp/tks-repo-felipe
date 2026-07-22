/**
 * Lookup de autenticacion memoizado por request.
 *
 * `getCachedUser()` envuelve `supabase.auth.getUser()` en `cache()` de React, que
 * memoiza el resultado durante UN solo request de servidor. Los helpers de
 * autorizacion (workspace-admin, team-access, etc.) y los server components suelen
 * pedir el usuario varias veces en el mismo request; con esto se hace UNA sola
 * lectura de auth por request en vez de N round-trips duplicados a Supabase.
 *
 * El cliente se crea DENTRO de la funcion (no se recibe como argumento) para que
 * la clave del cache sea estable: `cache()` no recibe argumentos aqui, asi que
 * cualquier llamada dentro del mismo request comparte el resultado.
 */
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const getCachedUser = cache(async (): Promise<User | null> => {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})
