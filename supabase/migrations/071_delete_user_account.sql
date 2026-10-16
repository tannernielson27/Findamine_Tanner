-- 071: in-app account deletion (App Store guideline 5.1.1(v)).
--
-- DELETE /api/v1/account calls public.delete_user_account(user_id), then
-- deletes the Supabase auth user(s) it returns with auth.admin.deleteUser.
--
-- Why a function and not a plain auth-user delete: users.auth_id cascades from
-- auth.users, but ~80 foreign keys point at public.users(id) with no ON DELETE
-- action, so deleting the auth user (and with it the users row) fails on the
-- first row that references the account. Rewriting every FK to CASCADE would
-- also silently destroy shared content other people use (hunts, rosters,
-- surveys a teacher authored). Instead, in ONE transaction, this function:
--
--   1. DELETES the person's own data: play history, photos, messages, posts,
--      friendships, kudos, survey answers, behavioural/privacy event logs,
--      points, badges, settings, notifications, referral links, team and class
--      memberships, ratings, login attempts, and so on.
--   2. KEEPS, linked only to a scrubbed placeholder row ("Deleted user", no
--      email/name/DOB/avatar, auth link removed):
--        - content shared with other people (hunts, locations, tasks, primers,
--          surveys, rosters, featured hunts, hunt-media uploads, moderation
--          decisions the person made, reports they filed);
--        - study_enrollments (stamped withdrawn) and dimension_assignments, so
--          attrition per condition can still be counted. Withdrawn participants
--          are already excluded from every analysis/export;
--        - consent_records with signature name, IP, token and metadata blanked
--          (the date/version a consent was given or refused, nothing else);
--        - audit_log rows with IP and before/after values blanked.
--   3. Writes a data_deletion_audit row and completes pending
--      data_deletion_requests.
--   4. For a parent, does the same for the child/teen accounts they created
--      (users.parent_id), since those exist only under the parent's consent.
--
-- It returns the auth ids to delete and the storage objects to remove (the
-- caller does both through the Supabase APIs, which SQL should not touch).
--
-- Every table/column is looked up before use, so a table missing from a given
-- environment is skipped instead of aborting the deletion.
--
-- Only service_role may execute these functions (SECURITY INVOKER, so they
-- run with the caller's privileges; anon/authenticated have no EXECUTE).

create schema if not exists private;

-- Delete rows of public.<p_table> where <p_column> = p_user_id, if both exist.
create or replace function private.account_delete_rows(p_table text, p_column text, p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer := 0;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_column
  ) then
    execute format('delete from public.%I where %I = $1', p_table, p_column) using p_user_id;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;

-- Scrub one account. Returns {"storage": [{bucket, path}], "rows_deleted": n}.
create or replace function private.account_scrub_user(p_user_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer := 0;
  v_n integer;
  v_storage jsonb := '[]'::jsonb;
  v_meta jsonb;
  v_was_enrolled boolean := false;
  -- (table, column) pairs whose rows are the person's own data.
  v_targets text[][] := array[
    ['team_members', 'user_id'],
    ['team_join_requests', 'user_id'],
    ['team_messages', 'user_id'],
    ['friend_connections', 'requester_id'],
    ['friend_connections', 'addressee_id'],
    ['user_blocks', 'blocker_id'],   -- 072; skipped if not applied yet
    ['user_blocks', 'blocked_id'],
    ['kudos', 'sender_id'],
    ['kudos', 'receiver_id'],
    ['shoutouts', 'sender_id'],
    ['shoutouts', 'receiver_id'],
    ['wall_posts', 'user_id'],
    ['consensus_votes', 'user_id'],
    ['session_goals', 'user_id'],
    ['reflections', 'user_id'],
    ['leaderboard_entries', 'user_id'],
    ['user_badges', 'user_id'],
    ['survey_responses', 'user_id'],
    ['survey_deliveries', 'user_id'],
    ['content_submissions', 'user_id'],
    ['notifications', 'user_id'],
    ['notification_preferences', 'user_id'],
    ['feedback_history', 'user_id'],
    ['behavioral_events', 'user_id'],
    ['roster_entries', 'student_id'],
    ['privacy_settings', 'user_id'],
    ['data_export_requests', 'user_id'],
    ['tutorial_progress', 'user_id'],
    ['accommodations', 'user_id'],
    ['login_attempts', 'user_id'],
    ['parent_child_links', 'parent_id'],
    ['parent_child_links', 'child_id'],
    ['user_profiles', 'user_id'],
    ['player_assessments', 'user_id'],
    ['hunt_enrollments', 'user_id'],
    -- user_sanctions is kept (de-identified) below, not deleted.
    ['privacy_events', 'user_id'],
    ['norm_exposures', 'user_id'],
    ['self_control_interventions', 'user_id'],
    ['points_ledger', 'user_id'],
    ['streaks', 'user_id'],
    ['user_tiers', 'user_id'],
    ['user_milestones', 'user_id'],
    ['feedback_log', 'user_id'],
    ['mentor_sessions', 'mentor_user_id'],
    ['mentor_sessions', 'mentee_user_id'],
    ['mentor_sessions_v2', 'mentor_id'],
    ['mentor_sessions_v2', 'mentee_id'],
    ['terms_policy_acceptances', 'user_id'],
    ['hint_ratings', 'user_id'],
    ['hunt_ratings', 'user_id'],
    ['user_accommodations', 'user_id'],
    ['privacy_index_snapshots', 'user_id'],
    ['referral_codes', 'user_id'],
    ['minion_links', 'recruiter_id'],
    ['minion_links', 'minion_id'],
    ['scheme_selections', 'user_id'],
    ['privacy_checkin_events', 'user_id'],
    ['notice_events', 'user_id'],
    -- Last: cascades find_completions -> find_photos (handled above).
    ['play_sessions', 'user_id']
  ];
  i integer;
begin
  -- Rows that block deleting the person's play history: feedback on, and
  -- reviews of, their find completions (FKs without ON DELETE CASCADE).
  if to_regclass('public.play_sessions') is not null and to_regclass('public.find_completions') is not null then
    create temporary table if not exists pg_temp.account_completions (id uuid primary key) on commit drop;
    -- WHERE true: hosted Supabase preloads safeupdate, which rejects bare DELETEs.
    delete from pg_temp.account_completions where true;
    insert into pg_temp.account_completions
      select fc.id from public.find_completions fc
      join public.play_sessions ps on ps.id = fc.play_session_id
      where ps.user_id = p_user_id
      on conflict do nothing;

    if to_regclass('public.answer_feedback') is not null then
      delete from public.answer_feedback where completion_id in (select id from pg_temp.account_completions);
      get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;
    end if;
    if to_regclass('public.technique_reviews') is not null then
      delete from public.technique_reviews
        where user_id = p_user_id
           or find_completion_id in (select id from pg_temp.account_completions);
      get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;
    end if;

    -- Geo-selfies (private bucket): collect the objects, then the rows.
    if to_regclass('public.find_photos') is not null then
      select v_storage || coalesce(jsonb_agg(jsonb_build_object('bucket', 'geo-selfies', 'path', storage_ref)), '[]'::jsonb)
        into v_storage
        from public.find_photos
        where storage_ref is not null
          and (uploaded_by = p_user_id or completion_id in (select id from pg_temp.account_completions));
      delete from public.find_photos
        where uploaded_by = p_user_id or completion_id in (select id from pg_temp.account_completions);
      get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;
    end if;
  end if;

  -- Moderation copies of the person's chat messages (they hold the text).
  if to_regclass('public.message_moderation_events') is not null then
    delete from public.message_moderation_events
      where user_id = p_user_id
         or message_id in (select id from public.team_messages where user_id = p_user_id);
    get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;
  end if;

  -- Personal uploads (avatars, captures). hunt-media is hunt content that other
  -- players see, so it stays with the hunt.
  if to_regclass('public.media') is not null then
    select v_storage || coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'path', path)), '[]'::jsonb)
      into v_storage
      from public.media
      where uploaded_by = p_user_id and bucket <> 'hunt-media';
    delete from public.media where uploaded_by = p_user_id and bucket <> 'hunt-media';
    get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;
  end if;

  -- Research: keep the enrollment as a withdrawal (attrition counts), stop
  -- everything else, and keep "currently enrolled" sample sizes accurate.
  if to_regclass('public.study_enrollments') is not null then
    select exists (select 1 from public.study_enrollments where user_id = p_user_id)
      into v_was_enrolled;
    update public.study_enrollments set withdrawn_at = p_now
      where user_id = p_user_id and withdrawn_at is null;
    if to_regclass('public.treatment_studies') is not null then
      update public.treatment_studies ts
        set current_sample_size = (
          select count(*) from public.study_enrollments se
          where se.study_id = ts.id and se.withdrawn_at is null
        )
        where ts.id in (select study_id from public.study_enrollments where user_id = p_user_id);
    end if;
  end if;

  for i in 1 .. array_length(v_targets, 1) loop
    v_deleted := v_deleted + private.account_delete_rows(v_targets[i][1], v_targets[i][2], p_user_id);
  end loop;

  -- Sanctions: keep a de-identified record (type, reason, who issued it and
  -- when) on the "Deleted user" placeholder; drop the free-text details.
  if to_regclass('public.user_sanctions') is not null then
    update public.user_sanctions set details = null where user_id = p_user_id;
  end if;

  -- Consent records: keep that consent was given/refused and when; drop who
  -- signed, from where, and the verification token.
  if to_regclass('public.consent_records') is not null then
    -- child_id and verification_token come from 011_coppa_fixes.
    update public.consent_records
      set signature_name = null, ip_address = null, verification_token = null, metadata = '{}'::jsonb
      where user_id = p_user_id or child_id = p_user_id;
  end if;

  if to_regclass('public.audit_log') is not null then
    update public.audit_log set ip_address = null, old_values = null, new_values = null
      where user_id = p_user_id;
  end if;

  if to_regclass('public.data_deletion_requests') is not null then
    update public.data_deletion_requests set status = 'completed', completed_at = p_now
      where user_id = p_user_id and status in ('pending', 'processing');
  end if;

  -- The placeholder row. auth_id is cleared so deleting the auth user cannot
  -- cascade into it; email stays unique and NOT NULL but means nothing.
  v_meta := jsonb_build_object('account_deleted_at', p_now);
  if v_was_enrolled then
    v_meta := v_meta || jsonb_build_object('research_withdrawn_at', p_now);
  end if;

  update public.users set
    auth_id = null,
    email = 'deleted+' || id::text || '@deleted.findamine.invalid',
    display_name = 'Deleted user',
    avatar_url = null,
    date_of_birth = null,
    school_id = null,
    parent_id = null,
    metadata = v_meta,
    status = 'inactive',
    deleted_at = p_now
  where id = p_user_id;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users' and column_name = 'profile_visibility') then
    update public.users set profile_visibility = '{}'::jsonb where id = p_user_id;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users' and column_name = 'profile_visibility_overrides') then
    update public.users set profile_visibility_overrides = '{}'::jsonb where id = p_user_id;
  end if;

  if to_regclass('public.data_deletion_audit') is not null then
    insert into public.data_deletion_audit (user_id, scope, rows_deleted, summary, completed_at)
      values (p_user_id, 'full_account', v_deleted,
              jsonb_build_object('source', 'in_app', 'was_study_participant', v_was_enrolled), p_now);
  end if;

  return jsonb_build_object('storage', v_storage, 'rows_deleted', v_deleted);
end;
$$;

-- Entry point. Returns {"accounts": [{user_id, auth_id}], "storage": [...]}
-- for the account and, for a parent, the child/teen accounts they created.
-- Raises 'account_not_found' if the user does not exist or is already deleted.
create or replace function public.delete_user_account(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_user record;
  v_child record;
  v_accounts jsonb := '[]'::jsonb;
  v_storage jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select id, auth_id, role into v_user
    from public.users
    where id = p_user_id and deleted_at is null
    for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if v_user.role = 'parent' then
    for v_child in
      select id, auth_id from public.users
      where parent_id = p_user_id and deleted_at is null and role in ('child', 'teen')
      for update
    loop
      v_result := private.account_scrub_user(v_child.id, v_now);
      v_storage := v_storage || (v_result -> 'storage');
      v_accounts := v_accounts || jsonb_build_object('user_id', v_child.id, 'auth_id', v_child.auth_id);
    end loop;
  end if;

  v_result := private.account_scrub_user(v_user.id, v_now);
  v_storage := v_storage || (v_result -> 'storage');
  v_accounts := v_accounts || jsonb_build_object('user_id', v_user.id, 'auth_id', v_user.auth_id);

  return jsonb_build_object('accounts', v_accounts, 'storage', v_storage);
end;
$$;

revoke all on function private.account_delete_rows(text, text, uuid) from public, anon, authenticated;
revoke all on function private.account_scrub_user(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_user_account(uuid) from public, anon, authenticated;
grant execute on function private.account_delete_rows(text, text, uuid) to service_role;
grant execute on function private.account_scrub_user(uuid, timestamptz) to service_role;
grant execute on function public.delete_user_account(uuid) to service_role;
