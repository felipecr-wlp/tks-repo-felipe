-- ════════════════════════════════════════════════════════════
-- Migration: workspace_invites
-- ════════════════════════════════════════════════════════════
-- Permite a admins de workspace generar códigos de invitación
-- (con password opcional) para que otros usuarios se unan.
--
-- Reglas:
--   - Solo admins de workspace pueden crear/listar/revocar invites
--   - Cualquier usuario autenticado puede consultar un invite por su código
--     (necesario para el flujo /join/[code])
--   - El usuario que se une debe tener mismo org_id que el workspace
--     (o no tener org_id, en cuyo caso se le asigna)
-- ════════════════════════════════════════════════════════════

-- ─── tabla ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_invites (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code            text        NOT NULL UNIQUE,           -- nanoid 16 chars
  password_hash   text,                                  -- opcional (pbkdf2)
  role            text        NOT NULL DEFAULT 'member'
                              CHECK (role IN ('admin','manager','member','viewer')),
  max_uses        int,                                   -- NULL = ilimitado
  uses_count      int         NOT NULL DEFAULT 0,
  expires_at      timestamptz,                           -- NULL = no expira
  revoked_at      timestamptz,
  created_by      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- ─── índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS workspace_invites_workspace_id_idx
  ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_invites_code_idx
  ON workspace_invites(code);

-- ─── policies ────────────────────────────────────────────────────────────────

-- SELECT: admins del workspace + org owners/admins + cualquier autenticado
-- (el último para poder mostrar info del workspace en /join/[code]).
-- Egress: el cliente solo recibe lo que pida explícitamente; no exponer
-- password_hash en queries.
CREATE POLICY "workspace_invites_select" ON workspace_invites FOR SELECT
  USING (
    auth.uid() IS NOT NULL
  );

-- INSERT: admins del workspace u org owners/admins
CREATE POLICY "workspace_invites_insert" ON workspace_invites FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (
      (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
      OR workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE profile_id = auth.uid() AND role = 'admin'
      )
    )
  );

-- UPDATE: admins (para revocar / actualizar uses_count)
-- Nota: el incremento de uses_count en /api/invites/[code]/join se hace con
-- service_role, así que esta policy solo aplica al panel de admin.
CREATE POLICY "workspace_invites_update" ON workspace_invites FOR UPDATE
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE profile_id = auth.uid() AND role = 'admin'
    )
  );

-- DELETE: admins
CREATE POLICY "workspace_invites_delete" ON workspace_invites FOR DELETE
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE profile_id = auth.uid() AND role = 'admin'
    )
  );
