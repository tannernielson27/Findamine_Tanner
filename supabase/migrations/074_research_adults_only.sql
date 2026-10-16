-- 074: the research study is adults-only (owner decision, 2026-10-15).
--
-- App side (same change): src/lib/utils/research-eligibility.ts is the one rule
-- the (app) layout, the consent route and the enrollment service share. Minors
-- (role child/teen, or a date of birth under 18) and staff are never shown the
-- consent gate, can't record a research consent, and are never randomized.
--
-- This migration cleans up what the old rule let through, and fixes the
-- starting privacy map for everyone outside the study:
--
--   1. Minors who were enrolled are WITHDRAWN with the same semantics as
--      POST /api/v1/research/withdraw: metadata.research_withdrawn_at stamped
--      (every storyline switch falls back on it), study_enrollments.withdrawn_at
--      set (excluded from crons and the export; never re-enrolled), unanswered
--      survey deliveries abandoned, current_sample_size refreshed, and a
--      study_withdrawn behavioral event written. Assignments stay on record.
--      One deliberate difference: crew (minion_links) are NOT deleted. The
--      route tears them down to stop study-gated payouts; the crew economy is
--      no longer gated for non-participants, so the links are plain game state.
--   2. Minors' research consent records (granted or declined) are revoked with
--      a reason, so nothing reads them as live consent.
--   3. Withdrawn minors whose privacy map is still the untouched "public"
--      condition (every field "everyone"), or empty, get the non-participant
--      defaults below.
--   4. Everyone never enrolled whose map is empty (enforced as "everyone") gets
--      the non-participant defaults: nothing visible to "everyone", real name
--      and personality scores "nobody". Kids bands use the kids column, all
--      others the teen column of PROFILE_FIELDS. Must match
--      nonParticipantDefaults() in src/lib/utils/non-participant-defaults.ts
--      (a vitest reads this file to keep them in sync). The metadata stamp
--      lets an adult who consents later still receive their assigned default.
--
-- Enrolled adults are untouched. Idempotent: a second run changes nothing.
-- One DO block, so it is atomic however it is run (CLI or SQL editor).

do $$
begin
  create temporary table m074_minors on commit drop as
    select u.id
      from public.users u
     where u.role in ('child', 'teen')
        or (u.date_of_birth is not null and age(current_date, u.date_of_birth) < interval '18 years');

  create temporary table m074_withdrawn on commit drop as
    select se.user_id, count(*)::int as enrollments
      from public.study_enrollments se
      join m074_minors m on m.id = se.user_id
     where se.withdrawn_at is null
     group by se.user_id;

  -- 1a. The stop key first: every manipulation reads it.
  update public.users u
     set metadata = coalesce(u.metadata, '{}'::jsonb) || jsonb_build_object('research_withdrawn_at', now())
    from m074_withdrawn w
   where u.id = w.user_id
     and not (coalesce(u.metadata, '{}'::jsonb) ? 'research_withdrawn_at');

  -- 1b. Withdraw the enrollments.
  update public.study_enrollments se
     set withdrawn_at = now()
    from m074_withdrawn w
   where se.user_id = w.user_id
     and se.withdrawn_at is null;

  -- 1c. Close unanswered surveys.
  update public.survey_deliveries d
     set status = 'abandoned'
    from m074_withdrawn w
   where d.user_id = w.user_id
     and d.status in ('pending', 'opened');

  -- 1d. Keep current_sample_size meaning "currently enrolled".
  update public.treatment_studies ts
     set current_sample_size = (
           select count(*) from public.study_enrollments se
            where se.study_id = ts.id and se.withdrawn_at is null
         );

  -- 1e. Same event the withdraw route writes, marked as this migration's doing.
  insert into public.behavioral_events (user_id, event_type, event_name, payload, platform)
  select w.user_id, 'study_withdrawn', 'study_withdrawn',
         jsonb_build_object(
           'enrollments_withdrawn', w.enrollments,
           'manipulations_stopped', true,
           'reason', 'adults_only',
           'source', 'migration_074'
         ),
         'server'
    from m074_withdrawn w;

  -- 2. Revoke minors' research consent decisions.
  update public.consent_records c
     set revoked_at = now(),
         metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('revoked_reason', 'adults_only_074')
    from m074_minors m
   where c.user_id = m.id
     and c.consent_type = 'research'
     and c.revoked_at is null;

  -- Non-participant default maps (see header, step 4).
  create temporary table m074_defaults on commit drop as
    select u.id,
           case
             when p.effective_band in ('primary', 'intermediate')
               or (coalesce(p.effective_band, '') not in ('primary', 'intermediate', 'teen', 'adult') and u.role = 'child')
             then '{"display_name":"team","avatar":"team","real_name":"nobody","personality_scores":"nobody","badges":"team","total_score":"team","hunt_history":"nobody","friends_list":"nobody"}'::jsonb
             else '{"display_name":"class","avatar":"class","real_name":"nobody","personality_scores":"nobody","badges":"class","total_score":"class","hunt_history":"team","friends_list":"team"}'::jsonb
           end as defaults
      from public.users u
      left join public.user_profiles p on p.user_id = u.id
     where u.deleted_at is null;

  -- 3. Withdrawn minors still on the untouched public map, or an empty one.
  update public.users u
     set profile_visibility = d.defaults,
         metadata = coalesce(u.metadata, '{}'::jsonb) || jsonb_build_object('non_participant_defaults_at', now())
    from m074_defaults d
    join m074_minors m on m.id = d.id
   where u.id = d.id
     and exists (select 1 from public.study_enrollments se where se.user_id = u.id)
     and (
       coalesce(u.profile_visibility, '{}'::jsonb) = '{}'::jsonb
       or u.profile_visibility = '{"display_name":"everyone","avatar":"everyone","real_name":"everyone","personality_scores":"everyone","badges":"everyone","total_score":"everyone","hunt_history":"everyone","friends_list":"everyone"}'::jsonb
     );

  -- 4. Never-enrolled users with an empty map.
  update public.users u
     set profile_visibility = d.defaults,
         metadata = coalesce(u.metadata, '{}'::jsonb) || jsonb_build_object('non_participant_defaults_at', now())
    from m074_defaults d
   where u.id = d.id
     and coalesce(u.profile_visibility, '{}'::jsonb) = '{}'::jsonb
     and not exists (select 1 from public.study_enrollments se where se.user_id = u.id);
end $$;
