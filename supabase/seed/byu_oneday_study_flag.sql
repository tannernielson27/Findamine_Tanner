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
--
-- Keeping the hunt listed: any metadata change by a non-reviewer fires
-- private.requeue_hunt_on_content_change (073), which moves an approved hunt
-- back to review_status 'pending' and sets is_public = false. Operator SQL
-- counts as a non-reviewer, so the flag update alone would pull this live
-- hunt out of the catalogue. The study flag is not content a reviewer needs
-- to look at again, so the block puts the review fields back exactly as they
-- were. The second update changes review_status, so the requeue trigger
-- leaves it alone, and it doesn't touch metadata, so the 083 trigger doesn't
-- fire.

do $$
declare
  v_hunt constant uuid := '8b2643d5-b432-4938-8fba-a88549c8e45e';
  r record;
begin
  select h.review_status, h.is_public, h.review_reason, h.review_submitted_at,
         h.reviewed_at, h.reviewed_by
    into r
    from public.hunts h
   where h.id = v_hunt
     and h.metadata->>'seed' = 'byu_oneday_v1'
     and coalesce(h.metadata->'study_hunt', 'false'::jsonb) <> 'true'::jsonb
   for update;

  if not found then
    raise notice 'Nothing to do: hunt % is missing, not seed byu_oneday_v1, or already a study hunt.', v_hunt;
    return;
  end if;

  update public.hunts
     set metadata = coalesce(metadata, '{}'::jsonb) || '{"study_hunt": true}'::jsonb
   where id = v_hunt;

  update public.hunts
     set review_status = r.review_status,
         is_public = r.is_public,
         review_reason = r.review_reason,
         review_submitted_at = r.review_submitted_at,
         reviewed_at = r.reviewed_at,
         reviewed_by = r.reviewed_by
   where id = v_hunt
     and review_status is distinct from r.review_status;

  raise notice 'Hunt % is now a study hunt (review_status %, is_public %).', v_hunt, r.review_status, r.is_public;
end;
$$;

-- Expect exactly one row, with study_hunt = true and the review state unchanged
-- (approved and public if it was before).
select id, title, status, review_status, is_public,
       metadata->>'seed' as seed, metadata->'study_hunt' as study_hunt
  from public.hunts
 where id = '8b2643d5-b432-4938-8fba-a88549c8e45e';
