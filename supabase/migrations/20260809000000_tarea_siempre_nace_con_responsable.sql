-- ─────────────────────────────────────────────────────────────────────────────
-- Una tarea no puede NACER sin responsable.
--
-- El dato que motiva esto: al 2026-08-03 habia 47 tareas en el workspace activo,
-- 46 SIN responsable, y CERO completadas en cinco semanas. No era descuido del
-- equipo. Era mecanico: ninguna de las tres pantallas de creacion
-- (GlobalNewTaskModal, CreateTaskInline, SubtasksSection) mandaba `assignee_id`,
-- y cuatro de las seis rutas que insertan tareas tampoco. Era IMPOSIBLE crear una
-- tarea con dueño en un solo paso.
--
-- Una tarea sin responsable no le aparece a nadie en "Mis tareas" (esa vista
-- filtra por assignee_id), no dispara la notificacion de asignacion y no entra en
-- ningun conteo por persona. Existe en la base y en ningun lado mas. Por eso
-- nunca se cerro ninguna: nadie la tenia.
--
-- POR QUE UN TRIGGER Y NO UN ARREGLO EN CADA RUTA: hay SEIS puntos de insercion
-- (api/tasks, projects (siembra de plantilla), import, duplicate, goals/tasks y
-- las herramientas de la IA en kern-tools). Arreglar seis lugares deja el septimo
-- que alguien escriba el mes que viene. Aqui la garantia es del motor y no se
-- puede olvidar.
--
-- SOLO BEFORE INSERT, a proposito, NO en UPDATE. Quitarle el responsable a una
-- tarea que ya existe es una accion deliberada y legitima (la barra de TaskRow la
-- ofrece). Lo que se prohibe es que una tarea NAZCA huerfana por omision.
-- Si esto se extiende a UPDATE, desasignar deja de funcionar en toda la app.
--
-- Si `created_by` viene NULL (insercion de sistema, sin persona detras) no hay a
-- quien asignarle y se deja NULL: es preferible a inventar un responsable.
--
-- No agrega llaves foraneas (no puede cerrar el ciclo que tumba a PostgREST con
-- HTTP 300) ni toca policies (no hay riesgo de recursion 42P17).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_set_default_assignee()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.assignee_id IS NULL AND NEW.created_by IS NOT NULL THEN
    NEW.assignee_id := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_default_assignee ON public.tasks;
CREATE TRIGGER tasks_default_assignee
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_set_default_assignee();

-- SIN BACKFILL, y la razon importa mas que la regla.
--
-- La primera version de esta migracion le devolvia cada huerfana a quien la
-- escribio. Antes de aplicarla se miro QUE eran esas 32 filas: no son pendientes
-- de nadie. Son los renglones de un cronograma de obra ("P1.1 Concrete Sidewalk",
-- "P2.4 Asphalt Crack fill & Sealcoat", "F5.3 Bollards") y dos de ellas son dias
-- festivos ("Labor Day", "Columbus Day").
--
-- Un festivo no tiene responsable. Asignarle 32 de esas a la persona que las
-- capturo le habria llenado "Mis tareas" de trabajo que no es suyo, y eso es
-- exactamente el ruido que este cambio existe para evitar. La regla nueva aplica
-- de aqui en adelante; el pasado se deja como esta y se corrige a mano si alguien
-- decide que alguna si era una tarea de verdad.
--
-- Dato de fondo, para quien lea esto despues: `tasks` se esta usando tambien como
-- almacen de cronograma. Mientras eso siga asi, "tarea sin responsable" no es
-- siempre un defecto, y por eso el trigger solo cubre INSERT y no se convierte en
-- una restriccion NOT NULL.

-- "Mis tareas" filtra por (assignee_id, workspace) y hasta hoy recorria la tabla.
-- Hoy da igual porque casi no hay filas, pero a partir de este cambio toda tarea
-- nueva cae en esa consulta y esa vista pasa a ser la pantalla de entrada de cada
-- persona. El indice se pone ahora, que es barato, y no cuando pese.
CREATE INDEX IF NOT EXISTS tasks_assignee_workspace_idx
  ON public.tasks(assignee_id, workspace_id)
  WHERE is_archived = false;
