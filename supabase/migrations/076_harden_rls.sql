-- 076: close direct-PostgREST write paths that let a signed-in user change
-- trust fields on their own rows.
--
-- Every write the app makes goes through the API routes on the service-role
-- client; the browser and cookie (user-JWT) clients only read and handle auth
-- (checked 2026-10-15 with a grep of src/ for writes made through
-- createSupabaseServerClient / createSupabaseBrowserClient / ad-hoc
-- createServerClient: none). The policies and grants removed below were
-- therefore only reachable by someone calling PostgREST with their own access
-- token and the public anon key, which is exactly what an attacker does.
--
--   1. public.users: anon and authenticated held table-wide INSERT/UPDATE/
--      DELETE, and users_update_own had no WITH CHECK, so any user could
--      PATCH their own role to 'admin' (or date_of_birth, parent_id, status,
--      auth_id, email, metadata research/consent keys ...). Write grants are
--      revoked, the policy gets a WITH CHECK, and a guard trigger refuses any
--      end-user change outside display_name/avatar_url in case a grant is ever
--      added back. users.metadata is guarded as a whole: nothing writes it
--      with a user JWT, and it holds the research condition, withdrawal,
--      safety acknowledgement and age attestation keys.
--   2. moderation_reports: only admins (and the reporter, for their own
--      reports) may read; only admins may update. 004 let any teacher or
--      game_master read and resolve every report.
--   3. Own-row write policies on tables whose rows carry points, progress,
--      enrolment, consent, friendship, research or sanction state become
--      read-only for end users. See the per-table notes.
--   4. private.user_id() / private.user_role() return null for deleted or
--      non-active accounts.
--   5. Researchers lose direct access to users and user_badges (admin only).
--   6-7. Teams, team memberships, team chat and team walls are readable only
--      by the people involved (members, overseeing teachers, admins) instead
--      of every signed-in user / every teacher; wall posts (which can be
--      anonymous) only by their author and admins.
--   8. Accommodations: the user, their parent or roster teacher, and admins,
--      instead of every teacher and parent.

-- ── 1. public.users ────────────────────────────────────────────

revoke insert, update, delete, truncate, references, trigger
  on table public.users from anon, authenticated;

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- End users (anon/authenticated, i.e. a PostgREST request with the anon key or
-- a user's access token) may change only display_name and avatar_url, and may
-- not insert. The service role, migrations and SECURITY DEFINER functions run
-- as other database roles and are not affected. This applies to admins using
-- their own JWT too: admin changes go through /api/v1/admin/users on the
-- service role.
create or replace function private.guard_users_protected_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['display_name', 'avatar_url', 'updated_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Accounts are created through the registration API'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'Only display_name and avatar_url can be changed directly'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_users_protected_fields() from public;
grant execute on function private.guard_users_protected_fields() to anon, authenticated, service_role;

drop trigger if exists guard_users_protected_fields on public.users;
create trigger guard_users_protected_fields
  before insert or update on public.users
  for each row execute function private.guard_users_protected_fields();

-- ── 2. moderation_reports ──────────────────────────────────────

drop policy if exists "reports_select_admin" on public.moderation_reports;
create policy "reports_select_admin" on public.moderation_reports
  for select using (
    reporter_id = private.user_id()
    or private.user_role() = 'admin'
  );

drop policy if exists "reports_update_admin" on public.moderation_reports;
create policy "reports_update_admin" on public.moderation_reports
  for update
  using (private.user_role() = 'admin')
  with check (private.user_role() = 'admin');

-- ── 3. Trust-bearing rows become read-only for end users ───────

-- points_ledger: any signed-in user could insert points for anyone
-- (WITH CHECK auth.uid() IS NOT NULL). Points are awarded by the API.
drop policy if exists "points_insert_system" on public.points_ledger;

-- streaks: own row was writable (current/longest streak, freezes).
drop policy if exists "streaks_own" on public.streaks;
drop policy if exists "streaks_select_own" on public.streaks;
create policy "streaks_select_own" on public.streaks
  for select using (user_id = private.user_id() or private.user_role() = 'admin');

-- user_milestones: own milestones were insertable (self-awarded milestones).
drop policy if exists "milestones_own" on public.user_milestones;
drop policy if exists "milestones_select_own" on public.user_milestones;
create policy "milestones_select_own" on public.user_milestones
  for select using (
    user_id = private.user_id()
    or private.user_role() in ('teacher', 'admin', 'researcher')
  );

-- consent_records: a user (including a child account) could insert or edit
-- their own consent rows, e.g. a parental-consent or research-consent grant.
-- consent_own (SELECT) is kept.
drop policy if exists "consent_insert" on public.consent_records;
drop policy if exists "consent_update" on public.consent_records;

-- play_sessions / find_completions: own session score and completions were
-- writable (total_score, score, completed_at). Gameplay goes through
-- /api/v1/play on the service role. The SELECT policies are kept.
drop policy if exists "play_insert_own" on public.play_sessions;
drop policy if exists "play_update_own" on public.play_sessions;
drop policy if exists "completions_insert_own" on public.find_completions;
drop policy if exists "completions_update_own" on public.find_completions;

-- hunt_enrollments: own enrolment rows were fully writable (status, team).
drop policy if exists "enrollments_own_or_staff" on public.hunt_enrollments;
drop policy if exists "enrollments_select_own_or_staff" on public.hunt_enrollments;
create policy "enrollments_select_own_or_staff" on public.hunt_enrollments
  for select using (
    user_id = private.user_id()
    or private.user_role() in ('teacher', 'admin', 'researcher')
  );

-- team_members: anyone signed in could insert a membership (any user, any
-- team, any role), and members could update their own row (e.g. role =
-- 'captain'). team_members_authenticated_select is kept.
drop policy if exists "team_members_insert_auth" on public.team_members;
drop policy if exists "team_members_update_own_or_admin" on public.team_members;

-- friend_connections: the requester could update their own request to
-- 'accepted'. Friendship widens profile visibility, so it must go through the
-- API. Select and delete (unfriend) stay.
drop policy if exists "friends_insert_own" on public.friend_connections;
drop policy if exists "friends_update_involved" on public.friend_connections;

-- survey_deliveries: own delivery rows were updatable (status, submitted_at).
drop policy if exists "deliveries_update_own" on public.survey_deliveries;

-- content_submissions: the author could update their own submission,
-- including its review status. Teachers/admins keep update rights.
drop policy if exists "content_update_own_or_admin" on public.content_submissions;
drop policy if exists "content_update_staff" on public.content_submissions;
create policy "content_update_staff" on public.content_submissions
  for update
  using (private.user_role() in ('teacher', 'admin'))
  with check (private.user_role() in ('teacher', 'admin'));

-- user_profiles: own row was writable, including age_band_override and
-- effective_band, which decide which child protections apply.
drop policy if exists "profiles_own" on public.user_profiles;
drop policy if exists "profiles_select_own" on public.user_profiles;
create policy "profiles_select_own" on public.user_profiles
  for select using (
    user_id = private.user_id()
    or private.user_role() in ('teacher', 'admin')
  );

-- terms_policy_acceptances: own acceptance rows were writable (back-dating or
-- forging an acceptance).
drop policy if exists "tpa_own" on public.terms_policy_acceptances;
drop policy if exists "tpa_select_own" on public.terms_policy_acceptances;
create policy "tpa_select_own" on public.terms_policy_acceptances
  for select using (user_id = private.user_id() or private.user_role() = 'admin');

-- privacy_settings / privacy_events / behavioral_events: the privacy study's
-- outcome data. Direct writes skipped the API's change logging, and
-- behavioral_events accepted rows for any user_id.
drop policy if exists "privacy_own" on public.privacy_settings;
drop policy if exists "privacy_select_own" on public.privacy_settings;
create policy "privacy_select_own" on public.privacy_settings
  for select using (user_id = private.user_id() or private.user_role() = 'admin');
drop policy if exists "pe_own_insert" on public.privacy_events;
drop policy if exists "events_insert_auth" on public.behavioral_events;

-- user_sanctions: any teacher or game_master could create, edit or lift any
-- user's sanctions. They keep read access; writes are admin-only.
drop policy if exists "sanctions_admin" on public.user_sanctions;
drop policy if exists "sanctions_staff_read" on public.user_sanctions;
drop policy if exists "sanctions_admin_write" on public.user_sanctions;
create policy "sanctions_staff_read" on public.user_sanctions
  for select using (private.user_role() in ('teacher', 'game_master', 'admin'));
create policy "sanctions_admin_write" on public.user_sanctions
  for all
  using (private.user_role() = 'admin')
  with check (private.user_role() = 'admin');

-- ── 4. Role helpers ignore deleted and inactive accounts ───────
--
-- private.user_id() / private.user_role() back almost every policy. They now
-- return null for a soft-deleted account or one whose status is not 'active'
-- (inactive, suspended, banned, pending_consent), so a suspended teacher or a
-- deleted admin loses role-based access at once. Own-row reads of public.users
-- use auth_id = auth.uid() directly (users_select_own), so proxy.ts can still
-- read a pending_consent child's status and send them to /consent-pending;
-- every other read or write the app makes for such an account goes through the
-- service role. CREATE OR REPLACE keeps the OIDs the policies reference.

create or replace function private.user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.users u
  where u.auth_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
$$;

create or replace function private.user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role from public.users u
  where u.auth_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
  limit 1
$$;

revoke execute on function private.user_id() from public;
revoke execute on function private.user_role() from public;
grant execute on function private.user_id() to anon, authenticated, service_role;
grant execute on function private.user_role() to anon, authenticated, service_role;

-- hunts_update_creators (016) duplicates hunts_update_own but resolves the
-- caller with its own users lookup, which would skip the check above.
drop policy if exists "hunts_update_creators" on public.hunts;

-- ── 5. Researchers lose direct access to users and badges ──────
-- Researchers read study data through the service-role API; nothing reads
-- other users' rows with a researcher JWT.

drop policy if exists "users_admin_all" on public.users;
create policy "users_admin_all" on public.users
  for all
  using (private.user_role() = 'admin')
  with check (private.user_role() = 'admin');

drop policy if exists "user_badges_admin" on public.user_badges;
create policy "user_badges_admin" on public.user_badges
  for all
  using (private.user_role() = 'admin')
  with check (private.user_role() = 'admin');

-- ── 6. Oversight helpers ───────────────────────────────────────
-- SECURITY DEFINER so policies on team_members can ask about team_members
-- without recursing into their own RLS.

-- The caller is an active member of the team.
create or replace function private.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = private.user_id()
      and tm.status = 'active'
  );
$$;

-- The caller is a teacher responsible for the team: a member is a student on
-- one of their rosters, or the team plays a hunt they created.
create or replace function private.teacher_oversees_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() = 'teacher', false)
    and (
      exists (
        select 1
        from public.team_members tm
        join public.roster_entries re on re.student_id = tm.user_id
        join public.rosters r on r.id = re.roster_id
        where tm.team_id = p_team_id
          and r.teacher_id = private.user_id()
          and r.deleted_at is null
      )
      or exists (
        select 1
        from public.teams t
        join public.hunts h on h.id = t.hunt_id
        where t.id = p_team_id
          and h.created_by = private.user_id()
      )
    );
$$;

-- The caller is responsible for this user: their parent (users.parent_id or a
-- verified parent_child_links row) or the teacher of a roster they are on.
create or replace function private.oversees_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_id() is not null
    and (
      exists (
        select 1 from public.users u
        where u.id = p_user_id and u.parent_id = private.user_id()
      )
      or exists (
        select 1 from public.parent_child_links l
        where l.child_id = p_user_id
          and l.parent_id = private.user_id()
          and l.verified
      )
      or exists (
        select 1
        from public.roster_entries re
        join public.rosters r on r.id = re.roster_id
        where re.student_id = p_user_id
          and r.teacher_id = private.user_id()
          and r.deleted_at is null
      )
    );
$$;

revoke all on function private.is_team_member(uuid) from public;
revoke all on function private.teacher_oversees_team(uuid) from public;
revoke all on function private.oversees_user(uuid) from public;
grant execute on function private.is_team_member(uuid) to anon, authenticated, service_role;
grant execute on function private.teacher_oversees_team(uuid) to anon, authenticated, service_role;
grant execute on function private.oversees_user(uuid) to anon, authenticated, service_role;

-- ── 7. Teams, team chat and team walls ─────────────────────────
-- The only user-JWT read among these tables is realtime team chat
-- (src/components/social/team-chat.tsx: team_messages, for team members).
-- Teams, memberships and wall posts, join-by-code included, are read through
-- the service-role API. These replace the 072 versions: a teacher reads only
-- the chat of teams they oversee, not every team's.

drop policy if exists "messages_select_team_member" on public.team_messages;
create policy "messages_select_team_member" on public.team_messages
  for select using (
    private.user_role() = 'admin'
    or (
      team_messages.moderation_status <> 'removed'
      and (
        (
          private.is_team_member(team_messages.team_id)
          and not private.is_blocked_between(team_messages.user_id, private.user_id())
        )
        or private.teacher_oversees_team(team_messages.team_id)
      )
    )
  );

-- Wall posts can be anonymous and RLS cannot hide one column of a row, so
-- direct reads are limited to the author's own posts. Everyone else reads the
-- wall through /api/v1/social/wall.
drop policy if exists "wall_select_team_member" on public.wall_posts;
create policy "wall_select_team_member" on public.wall_posts
  for select using (
    private.user_role() = 'admin'
    or (
      wall_posts.user_id = private.user_id()
      and wall_posts.moderation_status <> 'removed'
    )
  );

drop policy if exists "teams_select_all" on public.teams;
drop policy if exists "teams_select_involved" on public.teams;
create policy "teams_select_involved" on public.teams
  for select using (
    private.user_role() = 'admin'
    or private.is_team_member(teams.id)
    or private.teacher_oversees_team(teams.id)
  );

-- Anyone signed in could create teams, and any teacher/hunt creator/
-- researcher could edit any team. Team management is in the API.
drop policy if exists "teams_insert_auth" on public.teams;
drop policy if exists "teams_update_member_or_admin" on public.teams;

drop policy if exists "team_members_authenticated_select" on public.team_members;
drop policy if exists "team_members_select_involved" on public.team_members;
create policy "team_members_select_involved" on public.team_members
  for select using (
    private.user_role() = 'admin'
    or team_members.user_id = private.user_id()
    or private.is_team_member(team_members.team_id)
    or private.teacher_oversees_team(team_members.team_id)
  );

-- ── 8. Accommodations ──────────────────────────────────────────
-- accommodations_own_or_staff let every teacher and parent read and write
-- every user's accommodations. Now the user reads their own; their parent or
-- roster teacher reads and writes them; admins see and change everything.

drop policy if exists "accommodations_own_or_staff" on public.accommodations;
drop policy if exists "accommodations_select" on public.accommodations;
drop policy if exists "accommodations_write_guardian" on public.accommodations;
create policy "accommodations_select" on public.accommodations
  for select using (
    accommodations.user_id = private.user_id()
    or private.user_role() = 'admin'
    or private.oversees_user(accommodations.user_id)
  );
create policy "accommodations_write_guardian" on public.accommodations
  for all
  using (private.user_role() = 'admin' or private.oversees_user(accommodations.user_id))
  with check (private.user_role() = 'admin' or private.oversees_user(accommodations.user_id));
