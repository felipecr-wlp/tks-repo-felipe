-- Funciones (pantallas) ocultas por persona dentro de un workspace.
--
-- Se guarda lo OCULTO, no lo permitido: una pantalla nueva le aparece a todos
-- sin tener que darla de alta persona por persona, y nadie se queda encerrado
-- por un olvido del admin. El default '{}' significa "ve todo", que es el
-- comportamiento que ya tenia la app antes de esta columna.
--
-- El contenido son claves del catalogo de src/lib/features.ts. No se hace FK a
-- una tabla de catalogo a proposito: el catalogo es codigo, viaja con el deploy,
-- y una clave vieja que sobre se ignora al leer (normalizeHidden).

alter table public.workspace_members
  add column if not exists hidden_features text[] not null default '{}';

comment on column public.workspace_members.hidden_features is
  'Claves de funciones del catalogo (src/lib/features.ts) ocultas para esta persona en este workspace. Vacio = ve todo.';
