# Skill: Generar SQL Migration

Genera migraciones SQL completas para Supabase siguiendo los estándares del proyecto Work OS.

## Argumento
$ARGUMENTS — nombre de la tabla o feature a migrar (ej: "tasks" o "file-visibility")

## Lo que genera siempre

1. `CREATE TABLE` con todos los campos
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
3. Políticas RLS para SELECT / INSERT / UPDATE / DELETE
4. Índices necesarios para las queries más frecuentes
5. Columna `search_vector` si aplica (tsvector GIN)
6. Comentario de cabecera con propósito y fecha

## Plantilla de referencia

```sql
-- ============================================================
-- Migration: [nombre]
-- Descripción: [propósito]
-- Fecha: [fecha]
-- ============================================================

-- TABLA
CREATE TABLE IF NOT EXISTS [tabla] (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- ... campos específicos ...
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE [tabla] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[tabla]_select" ON [tabla] FOR SELECT
USING (
  organization_id = auth_org_id()
  AND (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = [tabla].workspace_id
        AND profile_id = auth.uid()
    )
  )
);

CREATE POLICY "[tabla]_insert" ON [tabla] FOR INSERT
WITH CHECK (organization_id = auth_org_id());

CREATE POLICY "[tabla]_update" ON [tabla] FOR UPDATE
USING (organization_id = auth_org_id());

CREATE POLICY "[tabla]_delete" ON [tabla] FOR DELETE
USING (
  organization_id = auth_org_id()
  AND (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
);

-- ÍNDICES
CREATE INDEX idx_[tabla]_org     ON [tabla](organization_id);
CREATE INDEX idx_[tabla]_workspace ON [tabla](workspace_id);
-- ... índices adicionales según uso ...

-- UPDATED_AT trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER [tabla]_updated_at
  BEFORE UPDATE ON [tabla]
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

## Reglas especiales de visibilidad (si aplica)

Para tablas con campo `visibility: enum('private','project','team','workspace')`:

```sql
-- Policy SELECT con visibilidad
CREATE POLICY "[tabla]_select_visibility" ON [tabla] FOR SELECT
USING (
  organization_id = auth_org_id()
  AND (
    -- Admins ven todo
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR
    -- El creador siempre ve el suyo (incluye private)
    created_by = auth.uid()
    OR
    -- Visibilidad workspace
    (visibility = 'workspace' AND EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = [tabla].workspace_id AND profile_id = auth.uid()
    ))
    OR
    -- Visibilidad project
    (visibility = 'project' AND EXISTS (
      SELECT 1 FROM project_members
      WHERE project_id = [tabla].project_id AND profile_id = auth.uid()
    ))
    OR
    -- Visibilidad team
    (visibility = 'team' AND EXISTS (
      SELECT 1 FROM team_members tm
      JOIN projects p ON p.team_id = tm.team_id
      WHERE p.id = [tabla].project_id AND tm.profile_id = auth.uid()
    ))
  )
);
```

## Instrucciones de uso

Al invocar `/gen-migration [nombre]`, genera el archivo SQL completo para
`supabase/migrations/[timestamp]_[nombre].sql` siguiendo la plantilla anterior,
adaptada a los campos específicos solicitados.
