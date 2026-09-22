-- 066: move the RLS helper functions out of the exposed API schema.
--
-- public.user_id() and public.user_role() are SECURITY DEFINER, so PostgREST
-- served them at /rest/v1/rpc/* to anyone holding the anon key (advisor lints
-- 0028/0029). They cannot simply lose EXECUTE: 145 policies call them and those
-- policies apply to anon and authenticated alike.
--
-- ALTER FUNCTION ... SET SCHEMA keeps each function's OID, and policies store a
-- reference to the OID, so every existing policy follows the move unchanged.
-- `private` is not in PostgREST's exposed schemas, so the RPC endpoints go away.
--
-- New migrations must call private.user_id() / private.user_role().

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

alter function public.user_id() set schema private;
alter function public.user_role() set schema private;

-- Policies evaluate as the calling role, so the callers keep EXECUTE.
revoke execute on function private.user_id() from public;
revoke execute on function private.user_role() from public;
grant execute on function private.user_id() to anon, authenticated, service_role;
grant execute on function private.user_role() to anon, authenticated, service_role;
