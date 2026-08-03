-- Podar el relleno del marketplace: dejar instalado SOLO lo que ya se usa.
--
-- Contexto: la migracion anterior (20260807000000) instalo las 8 herramientas en
-- TODOS los workspaces. Eso era obligatorio para que voltear la bandera no
-- hiciera desaparecer pantallas en uso, pero deja el marketplace sin sentido: si
-- todo viene instalado, la pestaña "Disponibles" queda vacia y no hay nada que
-- instalar. Un marketplace donde ya tenes todo es un catalogo de adorno.
--
-- Esta migracion lo corrige al reves: quita las 8 claves, EXCEPTO donde hay
-- evidencia de que el equipo ya las esta usando. Nadie pierde una pantalla que
-- estaba usando; los demas la ven en "Disponibles" y la instalan en un clic.
--
-- ── Que cuenta como "ya la estan usando" ────────────────────────────────────
-- Una fila en la base de esa herramienta, del workspace. No es una encuesta ni
-- un recuerdo: es la unica senal que no miente y que se puede volver a correr.
--
--   whiteboards -> whiteboards
--   flows       -> flows
--   goals       -> goals
--   projects    -> projects o project_members
--   cv          -> la MISMA senal que projects, a proposito (ver abajo)
--   tracking    -> time_entries
--   academia    -> academy_access, academy_progress o academy_certificates,
--                  cruzando por workspace_members (esas tablas son por persona,
--                  no por workspace)
--
-- ── Las dos que no tienen tabla propia, y por que se resuelven distinto ──────
--
--   `cv` no guarda nada: la pantalla ARMA el perfil leyendo el historial de
--   proyectos de cada persona. Medirla por su propia tabla daria cero siempre y
--   la sacaria de un workspace donde de verdad muestra algo. Por eso hereda la
--   evidencia de projects: si hay historial, el CV tiene contenido que mostrar.
--
--   `analytics` tampoco guarda nada, pero es un REPORTE derivado de tareas y
--   tiempo, y tareas hay en todos lados. Heredar de tareas la dejaria instalada
--   en todas partes, que es exactamente lo que esta migracion viene a deshacer.
--   Se quita en todos. Es una pantalla de solo lectura: si alguien la extraña, un
--   admin la reinstala en un clic y no se perdio nada, porque nunca hubo nada
--   guardado que perder.
--
-- ── Lo que esta migracion NO toca ───────────────────────────────────────────
-- `contenidos` no esta en la lista. No la instalo el relleno: la instalo una
-- persona antes de todo esto. Quitarla no seria deshacer un efecto colateral
-- mio, seria revertir una decision de alguien. Se queda.
--
-- ── Cuidado al re-correr ────────────────────────────────────────────────────
-- Idempotente en el estado de HOY, pero NO es inocua a mano: solo quita, nunca
-- reinstala. Si manana un admin instala `analytics` a proposito y alguien vuelve
-- a ejecutar este archivo, se la quita de nuevo. Como migracion corre una sola
-- vez y queda registrada; no ejecutarla suelta contra produccion.

UPDATE public.workspaces w
SET installed_features = sub.nuevo
FROM (
  SELECT
    w2.id,
    COALESCE(
      (
        SELECT array_agg(clave ORDER BY clave)
        FROM unnest(w2.installed_features) AS clave
        WHERE
          -- Lo que el relleno no puso, no se toca.
          clave <> ALL (ARRAY[
            'whiteboards', 'flows', 'academia', 'goals',
            'analytics', 'tracking', 'projects', 'cv'
          ]::text[])
          -- Lo que si puso, se queda solo si hay evidencia de uso.
          OR clave = ANY (uso.usadas)
      ),
      '{}'::text[]
    ) AS nuevo
  FROM public.workspaces w2
  CROSS JOIN LATERAL (
    SELECT array_remove(ARRAY[
      CASE WHEN EXISTS (
        SELECT 1 FROM public.whiteboards t WHERE t.workspace_id = w2.id
      ) THEN 'whiteboards' END,

      CASE WHEN EXISTS (
        SELECT 1 FROM public.flows t WHERE t.workspace_id = w2.id
      ) THEN 'flows' END,

      CASE WHEN EXISTS (
        SELECT 1 FROM public.goals t WHERE t.workspace_id = w2.id
      ) THEN 'goals' END,

      CASE WHEN EXISTS (
        SELECT 1 FROM public.time_entries t WHERE t.workspace_id = w2.id
      ) THEN 'tracking' END,

      CASE WHEN EXISTS (
        SELECT 1 FROM public.projects p WHERE p.workspace_id = w2.id
        UNION ALL
        SELECT 1 FROM public.project_members pm
          JOIN public.projects p ON p.id = pm.project_id
         WHERE p.workspace_id = w2.id
      ) THEN 'projects' END,

      -- Misma senal que projects: el CV es la lectura de ese historial.
      CASE WHEN EXISTS (
        SELECT 1 FROM public.projects p WHERE p.workspace_id = w2.id
        UNION ALL
        SELECT 1 FROM public.project_members pm
          JOIN public.projects p ON p.id = pm.project_id
         WHERE p.workspace_id = w2.id
      ) THEN 'cv' END,

      CASE WHEN EXISTS (
        SELECT 1 FROM public.academy_access a
          JOIN public.workspace_members m ON m.profile_id = a.profile_id
         WHERE m.workspace_id = w2.id
        UNION ALL
        SELECT 1 FROM public.academy_progress a
          JOIN public.workspace_members m ON m.profile_id = a.profile_id
         WHERE m.workspace_id = w2.id
        UNION ALL
        SELECT 1 FROM public.academy_certificates a
          JOIN public.workspace_members m ON m.profile_id = a.profile_id
         WHERE m.workspace_id = w2.id
      ) THEN 'academia' END
    ], NULL) AS usadas
  ) uso
) sub
WHERE sub.id = w.id;
