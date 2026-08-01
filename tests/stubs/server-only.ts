/**
 * Doble de `server-only` para Vitest.
 *
 * `server-only` es un paquete centinela: existe para que Next reviente el build si
 * un modulo de servidor se importa desde un componente de cliente. No exporta nada
 * y fuera del bundler de Next no resuelve, asi que un test que quiera ejercer la
 * logica de un helper de servidor (p.ej. src/lib/flows/access.ts) no puede
 * importarlo tal cual.
 *
 * Este archivo lo sustituye por un modulo vacio, via alias en vitest.config.ts. NO
 * debilita nada: la proteccion real la sigue dando el build de Next, que usa el
 * paquete de verdad. Aqui solo se evita que el centinela impida probar el codigo
 * que protege.
 */
export {}
