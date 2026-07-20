-- ─────────────────────────────────────────────────────────────────────────────
-- Fundamento para métricas de rendimiento: tasks.completed_at.
--
-- Las tareas no tenían timestamp de completado (updated_at cambia con cualquier
-- edición, así que no sirve para atribuir "cerrada en el mes X"). Agregamos una
-- columna completed_at que un trigger mantiene:
--   * al entrar a un estado con category='done' -> se fija now() (si estaba NULL)
--   * al salir de done (o status NULL) -> se limpia a NULL
--
-- El trigger corre BEFORE INSERT/UPDATE OF status_id. Lee task_statuses SOLO para
-- resolver la categoría (no es una policy RLS: no hay riesgo de recursión 42P17).
-- Backfill conservador: para las tareas ya en done, usa updated_at.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.tasks_set_completed_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  cat text;
BEGIN
  IF NEW.status_id IS NULL THEN
    NEW.completed_at := NULL;
    RETURN NEW;
  END IF;

  SELECT category INTO cat FROM public.task_statuses WHERE id = NEW.status_id;

  IF cat = 'done' THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_completed_at ON public.tasks;
CREATE TRIGGER tasks_completed_at
  BEFORE INSERT OR UPDATE OF status_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_set_completed_at();

-- Backfill de las tareas ya cerradas (usa updated_at como aproximación).
UPDATE public.tasks t
  SET completed_at = t.updated_at
  FROM public.task_statuses s
  WHERE s.id = t.status_id
    AND s.category = 'done'
    AND t.completed_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_completed_at_idx ON public.tasks(workspace_id, completed_at);
