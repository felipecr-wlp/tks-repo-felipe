-- ════════════════════════════════════════════════════════════════════════════
-- F3 Docs/Confluence: ocultamiento ESTRICTO de notas en espacios restringidos
-- ════════════════════════════════════════════════════════════════════════════
-- Las policies PERMISSIVE se combinan con OR, por lo que la policy base
-- "notes_select" (creada antes de los espacios) todavia deja ver una nota que
-- vive en un espacio restringido cuando su visibility es 'workspace' (cualquier
-- miembro del workspace la veria). Eso rompe la confidencialidad por departamento
-- (RH, Legal). Para cortar ese acceso sin reescribir la policy base se agrega una
-- policy RESTRICTIVE, que se combina con AND: una nota pasa el filtro solo si NO
-- pertenece a un espacio restringido, o si el usuario es admin de la organizacion,
-- o si es miembro del espacio.
--
-- Decision de diseno: la pertenencia al departamento gobierna. NO hay escape por
-- created_by: si alguien fue removido del espacio restringido, deja de ver sus
-- paginas aunque las haya escrito (segmentacion estricta, intencional).
--
-- El acceso a los espacios (tabla `spaces`) ya era estricto desde F0
-- (policy "spaces_select"); esto cierra el hueco equivalente en `notes`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY "notes_restrict_space" ON notes AS RESTRICTIVE FOR SELECT USING (
  space_id IS NULL
  OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  OR is_space_member(space_id)
  OR NOT EXISTS (
    SELECT 1 FROM spaces s WHERE s.id = notes.space_id AND s.is_restricted = true
  )
);
