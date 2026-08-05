-- Abrir la actividad por dentro.
--
-- Hasta hoy una actividad del reporte era UNA linea de texto y nada mas. Eso
-- alcanza para "Revise GA, GSC y Ahrefs" y se queda corto para todo lo demas:
-- "Optimice dos paginas" no dice cuales, y el enlace de lo que se entrego, que
-- es el unico dato que el mando quiere ver, terminaba pegado dentro de la misma
-- linea o simplemente no se guardaba.
--
-- La consecuencia no era una molestia de formato. Un reporte sin la evidencia
-- enlazada obliga a preguntar por chat "¿donde quedo?", y esa pregunta se hace
-- una vez de cada tres. Las otras dos veces el trabajo queda sin registro de
-- que existio.
--
-- UNA columna, no una tabla de comentarios:
--   - El detalle es del autor y de nadie mas. No hay hilo, no hay respuestas, no
--     hay a quien notificar. Una tabla aparte solo agregaria un join y un
--     segundo lugar donde equivocarse con los permisos.
--   - Es HTML del MISMO editor que ya usa el resumen del dia y la descripcion de
--     tareas (Tiptap). Por eso los enlaces salen gratis y sin inventar un
--     saneador nuevo: `sanitizeRichText` ya fuerza rel=noopener y ya bloquea
--     javascript:. Un campo de URL propio habria sido una segunda superficie que
--     validar, con menos utilidad.
--
-- Nace NULL en todas las filas y la pantalla trata NULL como "sin detalle". No
-- hay backfill ni valor por defecto: una actividad de una linea sigue siendo
-- valida y no debe verse como si le faltara algo.

ALTER TABLE daily_report_entries
  ADD COLUMN IF NOT EXISTS details text;

COMMENT ON COLUMN daily_report_entries.details IS
  'Detalle largo de la actividad, en HTML del editor (Tiptap). Aqui viven los enlaces a lo entregado. NULL = la actividad es solo su linea.';
