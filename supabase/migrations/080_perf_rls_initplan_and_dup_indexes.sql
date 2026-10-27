-- Performance cleanup flagged by the Supabase performance advisor (2026-10-26).
--
-- 1. RLS "initplan" fix: wrapping auth.uid() / current_setting() in a scalar
--    subquery lets Postgres evaluate it once per statement instead of once per
--    row. Same logic, same roles; only the evaluation strategy changes.
--    users_select_own runs on nearly every request, so it matters most.
--
-- 2. Duplicate indexes on task_standard_alignments: idx_tsa_* duplicate
--    idx_task_alignments_*, and the (task_id, standard_id) unique key already
--    covers lookups by task_id, so idx_task_alignments_task is redundant too.

BEGIN;

ALTER POLICY users_select_own ON public.users
  USING (auth_id = (SELECT auth.uid()));

ALTER POLICY users_update_own ON public.users
  USING (auth_id = (SELECT auth.uid()))
  WITH CHECK (auth_id = (SELECT auth.uid()));

ALTER POLICY consensus_insert_auth ON public.consensus
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY fl_insert ON public.feedback_log
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY af_insert ON public.answer_feedback
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY hunts_delete_creators ON public.hunts
  USING (
    created_by = (SELECT u.id FROM public.users u WHERE u.auth_id = (SELECT auth.uid()))
    OR (SELECT private.user_role()) = ANY (ARRAY['admin'::text, 'researcher'::text])
  );

ALTER POLICY hunt_ratings_authenticated_insert ON public.hunt_ratings
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'authenticated'
    OR (SELECT current_setting('role', true)) = 'rls_pgrest_supabase_super_admin'
  );

ALTER POLICY hint_ratings_authenticated_insert ON public.hint_ratings
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'authenticated'
    OR (SELECT current_setting('role', true)) = 'rls_pgrest_supabase_super_admin'
  );

DROP INDEX IF EXISTS public.idx_tsa_standard;
DROP INDEX IF EXISTS public.idx_tsa_task;
DROP INDEX IF EXISTS public.idx_task_alignments_task;

COMMIT;
