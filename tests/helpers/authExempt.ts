/**
 * Las UNICAS rutas mutantes de src/app/api que no autentican con sesion de
 * usuario, con la condicion que sostiene cada exencion.
 *
 * Vive aparte porque la vigilan DOS tripwires (auth-invariant, que corta por
 * handler, y mutation-auth-presence, que corta por archivo). Dos copias de la
 * misma lista se separan en cuanto alguien toca una: la de un lado se actualiza,
 * la del otro se queda afirmando algo que ya no es cierto, y el tripwire que
 * quedo viejo pasa en verde sobre una razon caduca. Una sola lista, dos lectores.
 *
 * REGLA: una exencion sin `condiciones` comprobables no entra aqui. Un allowlist
 * que solo se declara es una promesa vencida esperando: basta que alguien cambie
 * el archivo para que la justificacion deje de ser cierta sin que nadie se
 * entere. La condicion es lo que convierte la lista en una afirmacion verificada.
 */
export interface ExencionAuth {
  /** Ruta relativa al repo, con barras normales. */
  rel: string
  /** Por que no lleva sesion. Para quien lea, no para el test. */
  porque: string
  /** Lo que tiene que seguir siendo cierto para que la exencion valga. */
  condiciones: { pieza: string; re: RegExp }[]
}

export const EXENCIONES_AUTH: ExencionAuth[] = [
  {
    rel: '/src/app/api/connectors/call/[...action]/route.ts',
    porque:
      'Contrato app a app. No hay sesion que consultar: la llamada llega con ' +
      'Authorization: Bearer pck_live_... y el workspace sale de la fila de la key, ' +
      'nunca del payload. Autoriza igual de fuerte, por otra via.',
    condiciones: [
      { pieza: 'hashea el token (no lo compara en claro)', re: /hashToken\(/ },
      { pieza: 'exige key viva (revoked_at nulo)', re: /\.is\(\s*'revoked_at'\s*,\s*null\s*\)/ },
      { pieza: 'exige el scope de la accion', re: /key\.scopes\.includes\(/ },
      { pieza: 'toma el workspace de la key', re: /workspaceId = key\.workspace_id/ },
    ],
  },
  {
    rel: '/src/app/api/workspaces/route.ts',
    porque:
      'Puerta cerrada. Crear workspaces se retiro por decision de producto y el ' +
      'handler devuelve 403 sin mirar nada. No hay recurso que autorizar porque no ' +
      'hay operacion: pedirle sesion seria identificar a quien no va a pasar igual.',
    condiciones: [
      { pieza: 'responde 403', re: /status:\s*403/ },
      { pieza: 'NO usa el admin client', re: /^(?![\s\S]*createAdminClient\()[\s\S]*$/ },
      { pieza: 'NO consulta tablas', re: /^(?![\s\S]*\.from\()[\s\S]*$/ },
    ],
  },
]

/** Igual que arriba pero relativo a src/app/api, que es como corta otro tripwire. */
export const EXENCIONES_REL_API = new Set(
  EXENCIONES_AUTH.map((e) => e.rel.replace('/src/app/api/', ''))
)
