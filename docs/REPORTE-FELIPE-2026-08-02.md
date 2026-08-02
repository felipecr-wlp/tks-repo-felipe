# Reporte para Felipe: la falla que acabamos de arreglar y cómo no repetirla

**Fecha:** 2026-08-02 · **Rama auditada:** `origin/felipe.cr` (67 commits, 55 archivos, +3712/-355) · **Estado:** no mergeada, no desplegada.

Esto no es un regaño. La falla original estaba en `master`, escrita antes que tu rama, y la escribimos nosotros. La escribo porque tu marketplace de plugins repite el mismo patrón en 12 rutas nuevas, y prefiero que lo corrijas antes del merge que después de un incidente.

---

## 1. La falla: el error tragado que se disfraza de respuesta normal

```ts
// MAL: si la base falla, data viene null y lo leemos como "no es miembro"
const { data: membership } = await admin.from('workspace_members')...
if (!membership) return NextResponse.json({ error: 'Solo admins' }, { status: 403 })
```

Cuando la base no responde, `data` es `null`. El código no distingue **"no tienes acceso"** de **"no pude averiguarlo"**, así que contesta 403. El usuario recibe un mensaje perfectamente creíble que le dice que le quitaron permisos que sí tiene, abre un ticket de permisos, y la causa real no aparece en ningún lado.

Es la misma forma de falla que mantuvo vivo seis semanas el bug de rate limit: un error tragado que se ve como una respuesta normal. La diferencia es que este además culpa al usuario.

**La regla:** toda lectura a la base captura su `error`. Si la verificación no se pudo completar, se responde 500 con `ERROR_ACCESO_INDETERMINADO`, nunca 403.

```ts
// BIEN
const { ok, failed } = await canAccessProject(admin, projectId, user.id)
if (failed) return NextResponse.json({ error: ERROR_ACCESO_INDETERMINADO }, { status: 500 })
if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
```

Ojo con esto, porque es sutil: `as { data: X | null; error: unknown }` **tipa** el error pero no lo desestructura. En tus rutas está el tipo, no la variable. El tipo no atrapa nada.

## 2. La segunda regla: nunca redefinas una barrera de autorización que ya existe

Encontramos cuatro copias locales de helpers de `@/lib/team-access`, tres bajo el mismo nombre (`canAccessProject`) pero con una regla **distinta**. Dos reglas bajo un nombre es peor que dos reglas: quien lee cree ver la barrera auditada, y cualquier búsqueda por el nombre encuentra la copia y la da por buena.

Tus 12 rutas hacen su propio `membership.role !== 'admin'` a mano. Si mañana agregamos un rol `owner` o cambiamos la regla, se corrige `team-access.ts` y tus rutas siguen gobernando con el criterio de ayer, sin que nada lo delate. Usa `isOrgAdmin` / `canAccessProject`. Si tu regla de verdad es distinta, perfecto, pero entonces el **nombre** tiene que ser distinto.

## 3. Hallazgos concretos en tu rama (antes del merge)

| # | Dónde | Qué |
|---|---|---|
| 1 | 9 rutas de `plugins/`, `widgets/`, `user-plugins/` | Lecturas de membresía que descartan `error` (la falla de arriba). |
| 2 | `plugins/upload/route.ts` `extractZip()` | **Path traversal (Zip Slip).** `path.join(outDir, name)` con `name` tal cual viene del ZIP. Un ZIP con `../../src/app/page.tsx` escribe donde quiera. Valida que la ruta resuelta siga dentro de `outDir`. |
| 3 | `plugins/upload/route.ts` | `manifest.id` sin validar entra a `path.join(pluginsDir, manifest.id)`. Mismo problema, otra puerta. |
| 4 | `plugins/[pluginId]/component`, `widgets/component/[appId]` | **Sin autenticación.** Sirven JS arbitrario a cualquiera, uno de ellos con `Access-Control-Allow-Origin: *`. `appId` va sin validar a `path.join`. |
| 5 | Las 12 rutas | Sin `applyRateLimit` y sin `isUuid` en los params. Todo el resto de `/api` los tiene. |
| 6 | Arquitectura | `fs.writeFileSync` en `process.cwd()/plugins`. En Vercel el filesystem es de solo lectura y efímero: **la subida de plugins no puede funcionar en producción tal como está.** Hay que ir a Supabase Storage o a un registry, no a disco. |

El hallazgo 6 es el que hay que resolver primero, porque cambia el diseño y arrastra a los otros cinco.

## 4. Qué lo vigila ahora

`tests/access-indeterminado-invariant.test.ts` (5 tests, en verde) revisa el código fuente en cada corrida y falla si: el productor traga un error, un consumidor no ramifica sobre `failed`, o alguien vuelve a redefinir un helper de autorización de lib. Los nombres de los helpers se **descubren** leyendo `team-access.ts`, no están listados a mano, para que un helper nuevo quede vigilado solo.

Corre `npm test` antes de abrir el PR. Si algo se pone rojo ahí, es de verdad.

---

**Resumen en una línea:** captura siempre el `error`, un 403 que debió ser 500 es peor que un crash porque miente, y no le pongas a tu regla el nombre de la regla de otro.
