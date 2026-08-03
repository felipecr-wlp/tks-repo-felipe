-- Configuracion de plugins por usuario
-- Cada usuario puede activar/desactivar plugins para su propia sesion

CREATE TABLE IF NOT EXISTS user_plugin_settings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  install_id  uuid        NOT NULL REFERENCES connector_installs(id) ON DELETE CASCADE,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, install_id)
);

ALTER TABLE user_plugin_settings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ups_user ON user_plugin_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_ups_install ON user_plugin_settings(install_id);

CREATE POLICY "user_plugin_settings_select" ON user_plugin_settings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "user_plugin_settings_insert" ON user_plugin_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_plugin_settings_update" ON user_plugin_settings FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "user_plugin_settings_delete" ON user_plugin_settings FOR DELETE
  USING (user_id = auth.uid());
