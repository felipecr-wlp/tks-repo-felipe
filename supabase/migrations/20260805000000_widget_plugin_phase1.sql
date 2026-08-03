-- Phase 1: Widget Plugin System
-- Extiende connector_installs para soportar widgets visuales en el dashboard

ALTER TABLE connector_installs ADD COLUMN IF NOT EXISTS plugin_type text NOT NULL DEFAULT 'connector'
  CHECK (plugin_type IN ('connector', 'widget'));

COMMENT ON COLUMN connector_installs.plugin_type IS 'connector: app-to-app API | widget: UI component inyectable en dashboard';

-- Catalog de widgets disponibles (similar a connector_apps pero para widgets)
CREATE TABLE IF NOT EXISTS widget_catalog (
  id           text        PRIMARY KEY,
  name         text        NOT NULL,
  description  text,
  icon         text,
  slot         text        NOT NULL DEFAULT 'dashboard' CHECK (slot IN ('dashboard', 'sidebar', 'header')),
  component    text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE widget_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "widget_catalog_select" ON widget_catalog FOR SELECT USING (true);

-- Seed data: widgets de ejemplo
INSERT INTO widget_catalog (id, name, description, icon, slot, component) VALUES
  ('wlo-counter', 'Contador', 'Widget de ejemplo: contador simple', 'hash', 'dashboard', 'sample-counter'),
  ('wlo-clock', 'Reloj', 'Widget de ejemplo: reloj digital', 'clock', 'dashboard', 'sample-clock')
ON CONFLICT (id) DO NOTHING;
