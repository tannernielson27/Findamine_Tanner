-- 067: lock the thesis cohort design (decision D-R1, 2026-09-15).
--
-- One cohort, one run:
--   privacy_control_complexity  simple / moderate / complex   (sort 0)
--   privacy_default             public / private only         (sort 1)
--   forfeit_notice              shown / silent                (sort 2, storyline S3)
-- privacy_friction is unlinked: everyone gets the low-friction page.
-- referral_gate stays unlinked, so the disclosure gate is on for everyone.
-- 3 x 2 x 2 = 12 cells; target 480 complete (enroll up to 600).
--
-- Refuses to run once anyone is enrolled: assignments are permanent, so the
-- design of a live study must never change underneath its participants.

do $$
declare
  v_study      uuid;
  v_complexity uuid;
  v_default    uuid;
  v_friction   uuid;
  v_forfeit    uuid;
begin
  select id into v_study from public.treatment_studies where study_code = 'privacy_pilot_2026';
  if v_study is null then
    raise notice '067: privacy_pilot_2026 not found; nothing to configure';
    return;
  end if;

  if exists (select 1 from public.study_enrollments where study_id = v_study) then
    raise exception '067: privacy_pilot_2026 already has enrollments; its design cannot change';
  end if;

  select id into v_complexity from public.treatment_dimensions where name = 'privacy_control_complexity';
  select id into v_default    from public.treatment_dimensions where name = 'privacy_default';
  select id into v_friction   from public.treatment_dimensions where name = 'privacy_friction';
  select id into v_forfeit    from public.treatment_dimensions where name = 'forfeit_notice';
  if v_complexity is null or v_default is null or v_forfeit is null then
    raise exception '067: a required dimension is missing (apply 044, 050 and 059 first)';
  end if;

  if v_friction is not null then
    delete from public.treatment_study_dimensions
     where study_id = v_study and dimension_id = v_friction;
  end if;

  insert into public.treatment_study_dimensions (study_id, dimension_id, sort_order, active_levels)
  values (v_study, v_complexity, 0, null)
  on conflict (study_id, dimension_id)
    do update set sort_order = excluded.sort_order, active_levels = excluded.active_levels;

  insert into public.treatment_study_dimensions (study_id, dimension_id, sort_order, active_levels)
  values (v_study, v_default, 1, array['public', 'private'])
  on conflict (study_id, dimension_id)
    do update set sort_order = excluded.sort_order, active_levels = excluded.active_levels;

  insert into public.treatment_study_dimensions (study_id, dimension_id, sort_order, active_levels)
  values (v_study, v_forfeit, 2, null)
  on conflict (study_id, dimension_id)
    do update set sort_order = excluded.sort_order, active_levels = excluded.active_levels;

  update public.treatment_studies
     set description = 'Honors thesis: privacy control complexity (simple/moderate/complex) x default '
                    || '(public/private), with a randomized referral forfeit notice (shown/silent). '
                    || 'Friction fixed low. Single cohort.',
         target_sample_size = 480,
         updated_at = now()
   where id = v_study;
end $$;
