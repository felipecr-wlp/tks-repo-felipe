-- 2026-07-18: Cierre de hueco de seguridad detectado por el linter de Supabase.
-- Tres funciones SECURITY DEFINER eran invocables por anon (y authenticated)
-- via /rest/v1/rpc/*, exponiendo reputacion de perfiles y permitiendo spamear
-- create_default_statuses sin sesion. La app las llama unicamente con el
-- service role (admin client) o por trigger, asi que revocar es seguro.
-- NOTA: auth_org_id() NO se toca porque las policies RLS lo ejecutan con el
-- rol del usuario; revocarlo romperia todas las policies que lo usan.
--
-- CORRECCION (verificado 2026-07-18 via pg_proc.proacl): el REVOKE original
-- solo quitaba grants directos a anon/authenticated, pero estas funciones
-- nunca tuvieron grant individual, solo el grant implicito a PUBLIC
-- ("=X/postgres" en proacl). anon/authenticated heredan EXECUTE via PUBLIC,
-- asi que el REVOKE de anon/authenticated no cerraba nada en la practica.
-- Version correcta: revocar de PUBLIC y re-otorgar explicito a service_role.
-- Verificado en prod con has_function_privilege(): anon/authenticated ahora
-- devuelven false, service_role sigue en true.
-- Ya aplicada a produccion via MCP execute_sql el 2026-07-18.

REVOKE EXECUTE ON FUNCTION public.profile_reputation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_default_statuses(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.profile_reputation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_default_statuses(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
