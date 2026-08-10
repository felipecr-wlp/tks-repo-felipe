-- Reporte del ultimo envio de campana WLO -> WLI por regla. Aditivo.
-- El motor de automatizaciones guarda aqui lo que WLI devuelve al publicar
-- (campaign_id, published_at, list_name, sent_count, ok, error) para verlo
-- desde el panel de automatizaciones sin consultar al servidor de WLI.
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS last_campaign_report jsonb;
