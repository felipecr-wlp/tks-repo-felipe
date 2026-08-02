-- Poblar el marketplace de herramientas: rellenar ANTES de voltear la bandera.
--
-- Contexto: el marketplace (Configuracion > Herramientas) ya existe y funciona,
-- pero tenia una sola herramienta instalable (`contenidos`). Las otras 16 eran
-- de fabrica, asi que la pestaña "Disponibles" mostraba un solo renglon y la
-- funcion parecia decorativa. Este cambio pasa 8 pantallas opcionales al
-- catalogo instalable.
--
-- EL ORDEN NO ES NEGOCIABLE, y es la razon de que esta migracion exista sola:
--
--   `effectiveHidden(hidden, installed)` esconde TODA herramienta instalable que
--   el workspace no tenga en `installed_features`. El default de una instalable
--   es NO instalada, a proposito: una herramienta que apareciera sola dejaria de
--   ser instalable.
--
--   Consecuencia: marcar `installable: true` en una pantalla QUE YA SE USA la
--   hace desaparecer de golpe en todos los workspaces existentes, porque ninguno
--   la tiene en la columna. Nadie la desinstalo; simplemente cambio la regla
--   bajo sus pies. El equipo abre el lunes y le faltan ocho pantallas.
--
--   Por eso primero se rellena la columna (aqui) y despues se voltea la bandera
--   en `src/lib/features.ts`. Nunca al reves.
--
-- Esta migracion es segura de correr ANTES de que el codigo se despliegue:
-- mientras las claves no sean instalables, `normalizeInstalled()` las descarta y
-- `effectiveHidden()` ni las mira. No hay ventana en la que algo se esconda.
--
-- Aditiva e idempotente: conserva lo que cada workspace ya tuviera (por ejemplo
-- `contenidos`) y correrla dos veces da el mismo resultado.

UPDATE public.workspaces
SET installed_features = (
  SELECT array_agg(DISTINCT clave ORDER BY clave)
  FROM unnest(
    installed_features || ARRAY[
      'whiteboards',   -- pizarras
      'flows',         -- diagramas de flujo
      'academia',      -- capacitaciones
      'goals',         -- metas
      'analytics',     -- reportes de productividad
      'tracking',      -- registro de tiempo
      'projects',      -- bolsa de oportunidades
      'cv'             -- perfil profesional interno
    ]::text[]
  ) AS clave
);

-- Nota sobre lo que NO se movio, porque la omision es la decision:
--   home (bloqueada), inbox, my-tasks, general, reportes, notes, calendar y guia
--   siguen siendo de fabrica. Son el piso de un workspace recien creado; una
--   bandeja de entrada o una guia de uso que hubiera que instalar convertiria el
--   primer dia de alguien nuevo en una busqueda del tesoro.
