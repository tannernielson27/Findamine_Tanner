-- Mark "Four Finds on Upper Campus" (seed byu_oneday_v1) as a study hunt.
--
-- Data step, not a migration: run it once against production with the SQL
-- editor (or psql) after migration 083. It is idempotent: re-running changes
-- nothing once the flag is set, and it only touches the one hunt, guarded by
-- both its id and its seed tag so it can't hit anything else.
--
-- Study hunts freeze their stops once published or played (no add, remove or
-- reorder; src/lib/hunts/delivery-lock.ts). Setting the flag on a live hunt is
-- allowed; clearing it afterwards is not. Operator SQL (no JWT) is trusted by
-- the 083 trigger, so no opt-out setting is needed here.

update public.hunts
   set metadata = coalesce(metadata, '{}'::jsonb) || '{"study_hunt": true}'::jsonb
 where id = '8b2643d5-b432-4938-8fba-a88549c8e45e'
   and metadata->>'seed' = 'byu_oneday_v1'
   and coalesce(metadata->'study_hunt', 'false'::jsonb) <> 'true'::jsonb;

-- Expect exactly one row, with study_hunt = true.
select id, title, status, metadata->>'seed' as seed, metadata->'study_hunt' as study_hunt
  from public.hunts
 where id = '8b2643d5-b432-4938-8fba-a88549c8e45e';
