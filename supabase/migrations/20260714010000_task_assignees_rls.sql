-- ─────────────────────────────────────────────────────────────────────────────
-- Reparacion de seguridad: task_assignees quedo con RLS DESHABILITADA y SIN
-- policies en produccion (las del schema inicial usaban is_project_member(), una
-- funcion que ya no existe, y se cayeron; alguien deshabilito RLS a mano para
-- desbloquear). Eso deja la tabla de asignaciones LEIBLE/ESCRIBIBLE por cualquier
-- usuario autenticado (hallazgo ERROR del linter de Supabase).
--
-- Aqui se re-habilita RLS y se recrean las policies ancladas en el PROYECTO de la
-- tarea, con el MISMO modelo que la tabla `tasks` actual (miembro del proyecto u
-- owner/admin de la org). Se usa `(SELECT auth.uid())` para que Postgres cachee el
-- valor (initplan) y no reaparezca el lint de rendimiento.
--
-- Modelo:
--   SELECT : ves asignaciones de tareas de tus proyectos, o si eres owner/admin.
--   INSERT : asignas en tareas de proyectos donde eres manager/member, u owner/admin.
--   DELETE : quitas asignaciones bajo la misma condicion que INSERT.
--   (No hay UPDATE: la fila es un join PK (task_id, profile_id); se crea/borra.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

-- Limpieza defensiva por si quedara algun resto de policy vieja.
DROP POLICY IF EXISTS "ta_select" ON task_assignees;
DROP POLICY IF EXISTS "ta_insert" ON task_assignees;
DROP POLICY IF EXISTS "ta_delete" ON task_assignees;

CREATE POLICY "ta_select" ON task_assignees FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND (
          t.project_id IN (
            SELECT project_id FROM project_members
            WHERE profile_id = (SELECT auth.uid())
          )
          OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
        )
    )
  );

CREATE POLICY "ta_insert" ON task_assignees FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND (
          t.project_id IN (
            SELECT project_id FROM project_members
            WHERE profile_id = (SELECT auth.uid())
              AND role IN ('manager','member')
          )
          OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
        )
    )
  );

CREATE POLICY "ta_delete" ON task_assignees FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND (
          t.project_id IN (
            SELECT project_id FROM project_members
            WHERE profile_id = (SELECT auth.uid())
              AND role IN ('manager','member')
          )
          OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
        )
    )
  );
