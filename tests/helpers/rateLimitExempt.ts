/**
 * Las UNICAS rutas mutantes que no llaman applyRateLimit, con la condicion que
 * sostiene la exencion.
 *
 * Vive aparte porque la vigilan DOS tripwires (rate-limit-invariant y
 * rate-limit-coverage-invariant). Dos copias de la misma lista se separan en
 * cuanto alguien toca una, y la que quedo vieja pasa en verde sobre una razon
 * caduca.
 *
 * El rate limit existe por tres razones: brute force, costo y spam. Una ruta
 * solo puede quedar fuera si no habilita NINGUNA de las tres, y eso tiene que
 * ser comprobable, no una afirmacion de buena fe.
 */
export interface ExencionRateLimit {
  /** Ruta relativa al repo, con barras normales. */
  rel: string
  porque: string
  condiciones: { pieza: string; re: RegExp }[]
}

export const EXENCIONES_RATE_LIMIT: ExencionRateLimit[] = [
  {
    rel: '/src/app/api/workspaces/route.ts',
    porque:
      'Puerta cerrada. Crear workspaces se retiro por decision de producto: el ' +
      'handler devuelve 403 sin leer el cuerpo, sin sesion y sin tocar la base. No ' +
      'hay brute force (no verifica ningun secreto), no hay costo (no consulta ' +
      'nada) y no hay spam (no escribe). Ponerle un freno seria gastar un comando ' +
      'de Redis por cada peticion para proteger una respuesta constante.',
    condiciones: [
      { pieza: 'responde 403', re: /status:\s*403/ },
      { pieza: 'NO usa el admin client', re: /^(?![\s\S]*createAdminClient\()[\s\S]*$/ },
      { pieza: 'NO consulta tablas', re: /^(?![\s\S]*\.from\()[\s\S]*$/ },
      { pieza: 'NO lee el cuerpo del request', re: /^(?![\s\S]*request\.json\()[\s\S]*$/ },
    ],
  },
]

/** Relativo al repo, como corta rate-limit-invariant. */
export const EXENTAS_REPO = new Set(EXENCIONES_RATE_LIMIT.map((e) => e.rel))

/** Relativo a src/app/api, como corta rate-limit-coverage-invariant. */
export const EXENTAS_API = new Set(
  EXENCIONES_RATE_LIMIT.map((e) => e.rel.replace('/src/app/api/', ''))
)
