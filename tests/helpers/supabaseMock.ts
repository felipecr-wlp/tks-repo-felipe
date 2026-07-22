/**
 * Mock encadenable del query builder de Supabase.
 *
 * El builder real es chainable: .from().select().eq().maybeSingle() etc, donde
 * cada metodo devuelve el mismo builder y al final se resuelve (await) a
 * { data, error }. Aqui cada llamada a .from() consume el SIGUIENTE resultado
 * de una cola preconfigurada, y el objeto es "thenable" para que await sobre
 * cualquier punto de la cadena resuelva ese resultado. Tambien es awaitable
 * despues de metodos terminales como .maybeSingle() / .single() / .in().
 */

export type QueryResult = { data: unknown; error: unknown }

const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'upsert',
  'eq',
  'neq',
  'in',
  'is',
  'order',
  'limit',
  'maybeSingle',
  'single',
] as const

/** Crea un builder encadenable que se resuelve al resultado dado. */
function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {
    // thenable: await chain -> result
    then(onFulfilled: (v: QueryResult) => unknown) {
      return Promise.resolve(result).then(onFulfilled)
    },
  }
  for (const m of CHAIN_METHODS) {
    chain[m] = () => chain
  }
  return chain
}

/**
 * Crea un cliente admin/supabase mock cuya propiedad .from() devuelve, en orden,
 * un builder por cada resultado en `results`. Si se agotan, reusa el ultimo.
 * .auth.getUser() devuelve el user provisto (o null).
 */
export function makeSupabaseMock(opts: {
  results: QueryResult[]
  user?: { id: string } | null
}) {
  const results = [...opts.results]
  let idx = 0
  const from = () => {
    const r = results[Math.min(idx, results.length - 1)] ?? { data: null, error: null }
    idx += 1
    return makeChain(r)
  }
  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: opts.user ?? null }, error: null }),
    },
  }
}
