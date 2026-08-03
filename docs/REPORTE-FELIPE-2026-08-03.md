# Reporte para Felipe, parte 2: el veredicto del merge y lo que falta para que Flows sea plugin

**Fecha:** 2026-08-03 · **Rama auditada:** `origin/felipe.cr`, ultimo commit `0a9745d` del 2026-07-31 · **Estado: NO mergeada, NO desplegada. El trabajo esta intacto en tu rama.**

Continua `REPORTE-FELIPE-2026-08-02.md`. Ese ya cubrio el error tragado, los helpers duplicados y seis hallazgos de seguridad. **No los repito: los volvi a encontrar por mi cuenta y los confirmo todos.** Aqui va solo lo nuevo, y lo primero es lo que mas te importa.

---

## 1. Flows todavia NO es un plugin, y esa era la meta

Ali pidio que Flows dejara de ser nativo y pasara a ser un plugin que se actualiza solo, sin depender de un deploy de WLO. **Tu rama todavia no hace eso**, y quiero ser preciso en por que, porque desde afuera parece que si.

Lo que hay en la rama:

- `plugins/wlo-flows/` con su `manifest.json`, `page.js`, `pages/list.js`, `pages/[flowId]/editor.js`. Se ve como un plugin.
- Un cargador generico en `src/app/(app)/w/[workspaceSlug]/p/[pluginId]/[...path]/page.tsx` que monta un `<iframe>` desde `connector_apps.base_url`.

Lo que lo desmiente, en tu propio codigo:

```ts
// src/components/sidebar/Sidebar.tsx:562
const href = p.app_id === 'wlo-flows' ? `${base}/flows` : `${base}/p/${p.app_id}`
```

Flows esta **excluido a mano** del camino de plugins y devuelto a la ruta nativa. Ademas:

- Los 7 archivos nativos de `src/app/(app)/w/[workspaceSlug]/flows/` siguen ahi, y son los que de verdad se renderizan.
- `FlowEditor.tsx` es el archivo con mas cambios de toda tu rama (314 lineas). O sea, el desarrollo activo de Flows sigue ocurriendo en el codigo **nativo**.
- El `upsert` a `connector_apps` en `plugins/upload/route.ts` escribe `base_url: ''`. Como el cargador generico depende de `base_url` para el iframe, con cadena vacia no tiene nada que montar.

**Conclusion:** `plugins/wlo-flows/*.js` es hoy una copia paralela que nadie carga. Actualizar Flows sigue exigiendo un deploy de WLO, que es exactamente lo que se queria evitar.

**El camino corto, y creo que es el bueno:** ya construiste la pieza que hace falta, el iframe del cargador generico. Sirve Flows desde **tu propia URL**, registra esa URL en `connector_apps.base_url`, y borra el caso especial de la linea 562. Ahi Flows se actualiza cuando tu despliegas lo tuyo, sin tocar WLO ni pedirnos nada. No necesitas el sistema de subir ZIPs para lograrlo, y eso te salta de golpe casi todos los hallazgos de seguridad de abajo.

---

## 2. Por que no la mergee

No es criterio personal, son dos numeros medidos hoy, con el mismo comando en las dos ramas:

| | `master` | `origin/felipe.cr` |
|---|---|---|
| `npx tsc --noEmit` | **0 errores** | **26 errores** |
| `npx vitest run` | **437 pasan, 0 fallan** (86 archivos) | **22 archivos fallan** |

El detalle importa y te favorece: **20 de esos 22 ya fallaban en `bf13726`**, el commit del que saliste. Heredaste una base roja, no la rompiste tu. Master se puso en verde despues de que te ramificaste.

Y una parte grande de los 26 errores de tipos **no es culpa del codigo**: son tus dos migraciones (`widget_plugin_phase1`, `user_plugin_settings`) que nunca se aplicaron a la base, asi que los tipos generados no conocen `user_plugin_settings`, `widget_catalog` ni la columna `plugin_type`. Se arreglan aplicando las migraciones y regenerando tipos. Acabo de pasar por lo mismo con el modulo de solicitudes.

Lo que si es codigo son los de `FlowEditor.tsx`: `SelectionMode` recibiendo el string `"partial"`, y un `StrokeWidth<string | number>` entrando a un `setState` de `number`.

Como `master` despliega solo a `wlo.vercel.app` en cada push, mergear hoy publicaba todo esto a produccion. Por eso queda en tu rama.

---

## 3. Lo que la rama agrega de nuevo a los tripwires

Filtre los ofensores que aparecen en tu rama y **no** en el commit base, para separar lo tuyo de lo heredado. Todo lo de abajo es nuevo:

```
/src/app/api/plugins/route.ts :: POST
/src/app/api/plugins/upload/route.ts :: POST
/src/app/api/plugins/[pluginId]/route.ts :: DELETE
/src/app/api/plugins/[pluginId]/config/route.ts :: PATCH
/src/app/api/plugins/[pluginId]/reset/route.ts :: POST
/src/app/api/user-plugins/route.ts :: POST
plugins/[pluginId]/component/route.ts   (params.pluginId sin validar)
plugins/[pluginId]/download/route.ts    (params.pluginId sin validar)
widgets/component/[appId]/route.ts      (params.appId sin validar)
FlowEditor.tsx:216                      (sink de XSS sin sanitizeRichText)
settings/docs/page.tsx:27               (sink de XSS sin sanitizeRichText)
```

Los dos tripwires que pasaron de verde a rojo **por tu rama** son `error-disclosure-invariant` (respuestas que devuelven `'Error al instalar: ' + err.message` al cliente) y `permissive-cors-invariant` (el `Access-Control-Allow-Origin: '*'`).

---

## 4. Tres cosas que el reporte de ayer no traia

**(a) El ZIP no se descomprime. La subida no funciona ni ignorando lo de Vercel.**

`extractZip()` lee el tamaño comprimido del offset 18 y escribe esos bytes tal cual al disco. Nunca lee el **metodo de compresion**, que vive en el offset 8 del local file header. Solo funciona con entradas `STORED` (metodo 0). Cualquier ZIP normal, incluido el que hace "Enviar a > Carpeta comprimida" de Windows, usa `DEFLATE` (metodo 8): esos archivos se escriben **comprimidos**, con el nombre correcto y el contenido ilegible, sin ningun error. El sintoma seria un plugin que instala "bien" y luego no carga por razones que no se parecen a la causa.

Si el camino termina siendo servir desde tu URL (seccion 1), este codigo se borra entero y el problema desaparece.

**(b) Este repo ya tenia un tripwire que predijo esto, con nombre y apellido.**

No es una objecion inventada para tu PR. `tests/marketplace-tools-invariant.test.ts`, arista D, dice desde antes de tu rama:

> Un marketplace "de verdad" tienta a subir un paquete, descomprimirlo en disco y cargarlo. Eso son tres agujeros de una vez: escritura de rutas controladas por el paquete (zip-slip, CWE-22), ejecucion de codigo que no paso por revision (RCE), y ademas ni siquiera funciona en Vercel, donde el disco es de SOLO LECTURA salvo /tmp.

Ese mismo test explica que revisa que **todo el codigo viva en `src/`**, precisamente porque una carpeta hermana llamada `plugins/` pasaria entera sin ser leida. Vale la pena leerlo completo antes de rediseñar: te ahorra la discusion.

**(c) El chequeo de rol se queda corto, aunque hoy no se note.**

`membership.role !== 'admin'` en las rutas de plugins. Mire los datos reales de produccion:

- `workspace_members.role` hoy tiene `admin`, `member` y **`manager`**. No existe `owner` en esa tabla.
- El dueño de la organizacion se marca aparte, en `profiles.org_role`, donde hay exactamente 1 `owner`.

Hoy ese unico `owner` **tambien** es `admin` del workspace, asi que la comprobacion funciona de casualidad. El dia que eso deje de coincidir, el dueño de la organizacion recibe un 403 en su propio sistema. Por eso el resto del repo pregunta por las dos cosas (`org_role IN ('owner','admin')` **o** rol de workspace) a traves de los helpers de `@/lib/team-access`, en vez de comparar el string a mano.

---

## 5. Orden sugerido

1. **Decidir el modelo de plugin** (seccion 1). Si es servir desde tu URL, los puntos 2 y 3 se caen solos.
2. Aplicar tus dos migraciones y regenerar tipos. Baja bastante de los 26 errores.
3. Arreglar los dos errores reales de `FlowEditor.tsx`.
4. Autenticar `component` y `download`, quitar el `Access-Control-Allow-Origin: '*'`, meter `applyRateLimit` e `isUuid` en las rutas que sobrevivan.
5. `npx tsc --noEmit` y `npm test` en verde antes del PR.

Al terminar el paso 1 avisanos y hacemos el merge nosotros, resolviendo los conflictos contra el `master` de hoy (son 5 archivos: `features.ts`, `Sidebar.tsx`, `SettingsNav.tsx`, `FlowEditor.tsx` y `api/flows/[flowId]/route.ts`). Ojo con ese ultimo: `master` le agrego `expected_updated_at`, un guardia de 409 contra edicion perdida que tu rama todavia no tiene y que hay que conservar.

---

**Resumen en una linea:** el trabajo esta a salvo y no se perdio nada, pero Flows sigue siendo nativo, y el camino mas corto para que deje de serlo es el iframe que ya construiste apuntando a tu propia URL, no el sistema de subir ZIPs.
