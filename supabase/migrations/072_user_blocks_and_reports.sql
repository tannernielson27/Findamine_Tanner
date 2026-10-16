-- 072: user blocking + richer moderation reports (App Store guideline 1.2).
--
-- Apple requires apps with user-generated content to let people report
-- objectionable content, block abusive users, and filter content. This adds:
--
--   1. public.user_blocks: blocker -> blocked. Mutual in effect (enforced in
--      the API, src/lib/moderation/blocks.ts): neither side sees the other's
--      chat messages, kudos, wall posts or shoutouts, and neither can send the
--      other kudos, shoutouts or friend requests. Blocking deletes any
--      friend_connections row between the pair.
--   2. moderation_reports: entity_type also allows kudos, hunt and review;
--      new reported_user_id + content_snapshot columns so /admin/moderation
--      can show who said what even after the original changes or is removed.
--      The reporter's own reports are also used to hide a reported chat
--      message / kudos from the reporter immediately (no extra table).
--   3. kudos and shoutouts gain moderation_status (like team_messages and
--      wall_posts already have) so a moderator's "remove" is a soft removal.
--   4. team_messages / wall_posts / kudos / shoutouts SELECT policies exclude
--      rows from people the viewer blocked or who blocked the viewer, and
--      rows a moderator removed (admins excepted), so realtime chat (which
--      reads through RLS from the browser) respects blocks and removals too.
--      Kudos lose the "any teacher" read branch; shoutouts are no longer
--      readable by every signed-in user.
--
-- Account deletion (071, private.account_delete_rows list) removes a user's
-- user_blocks rows in both directions.

-- ── 1. user_blocks ─────────────────────────────────────────────

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_no_self check (blocker_id <> blocked_id),
  constraint user_blocks_pair_unique unique (blocker_id, blocked_id)
);

-- (blocker_id, blocked_id) is covered by the unique constraint's index.
create index if not exists idx_user_blocks_blocked on public.user_blocks(blocked_id);

alter table public.user_blocks enable row level security;

-- A person sees, creates and removes only their own blocks. They cannot see
-- who has blocked them. The API uses the service role; these policies cover
-- direct client access.
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks
  for select using (blocker_id = private.user_id() or private.user_role() = 'admin');

drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks
  for insert with check (blocker_id = private.user_id());

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
  for delete using (blocker_id = private.user_id());

-- Used by the policies in section 3. SECURITY DEFINER so it can see blocks
-- made by the other person (which the caller's own RLS hides).
create or replace function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

revoke execute on function private.is_blocked_between(uuid, uuid) from public;
grant execute on function private.is_blocked_between(uuid, uuid) to anon, authenticated, service_role;

-- ── 2. moderation_reports ──────────────────────────────────────

alter table public.moderation_reports
  drop constraint if exists moderation_reports_entity_type_check;
alter table public.moderation_reports
  add constraint moderation_reports_entity_type_check
  check (entity_type in ('message', 'wall_post', 'content', 'user', 'shoutout', 'kudos', 'hunt', 'review'));

alter table public.moderation_reports
  add column if not exists reported_user_id uuid references public.users(id) on delete set null,
  add column if not exists content_snapshot text;

alter table public.moderation_reports
  drop constraint if exists moderation_reports_snapshot_length;
alter table public.moderation_reports
  add constraint moderation_reports_snapshot_length
  check (content_snapshot is null or char_length(content_snapshot) <= 1000);

create index if not exists idx_mod_reports_reported_user
  on public.moderation_reports(reported_user_id) where reported_user_id is not null;
-- "What has this person reported?" — used to hide reported items from the reporter.
create index if not exists idx_mod_reports_reporter_entity
  on public.moderation_reports(reporter_id, entity_type, entity_id);

-- ── 3. Soft removal for kudos / shoutouts ──────────────────────

alter table public.kudos
  add column if not exists moderation_status text not null default 'approved';
alter table public.kudos
  drop constraint if exists kudos_moderation_status_check;
alter table public.kudos
  add constraint kudos_moderation_status_check
  check (moderation_status in ('approved', 'flagged', 'removed'));

alter table public.shoutouts
  add column if not exists moderation_status text not null default 'approved';
alter table public.shoutouts
  drop constraint if exists shoutouts_moderation_status_check;
alter table public.shoutouts
  add constraint shoutouts_moderation_status_check
  check (moderation_status in ('approved', 'flagged', 'removed'));

-- ── 4. Block- and moderation-aware read policies ───────────────
--
-- Rows a moderator removed (moderation_status = 'removed') are hidden from
-- everyone but admins, and rows between two people where either blocked the
-- other are hidden from both. The API reads these tables with the service
-- role and filters the same way; these policies cover direct client access
-- (realtime team chat reads team_messages through RLS from the browser).
-- 076 replaces the team_messages and wall_posts policies again, scoping the
-- teacher branch to teams the teacher oversees.

drop policy if exists "messages_select_team_member" on public.team_messages;
create policy "messages_select_team_member" on public.team_messages
  for select using (
    private.user_role() = 'admin'
    or (
      team_messages.moderation_status <> 'removed'
      and (
        (
          exists (
            select 1 from public.team_members tm
            where tm.team_id = team_messages.team_id
            and tm.user_id = private.user_id() and tm.status = 'active'
          )
          and not private.is_blocked_between(team_messages.user_id, private.user_id())
        )
        or private.user_role() = 'teacher'
      )
    )
  );

drop policy if exists "wall_select_team_member" on public.wall_posts;
create policy "wall_select_team_member" on public.wall_posts
  for select using (
    private.user_role() = 'admin'
    or (
      wall_posts.moderation_status <> 'removed'
      and (
        (
          exists (
            select 1 from public.team_members tm
            where tm.team_id = wall_posts.team_id
            and tm.user_id = private.user_id() and tm.status = 'active'
          )
          and not private.is_blocked_between(wall_posts.user_id, private.user_id())
        )
        or private.user_role() = 'teacher'
      )
    )
  );

-- Kudos: sender and receiver only (003 also let every teacher read every
-- kudos). Admins see everything.
drop policy if exists "kudos_select_involved" on public.kudos;
create policy "kudos_select_involved" on public.kudos
  for select using (
    private.user_role() = 'admin'
    or (
      (kudos.sender_id = private.user_id() or kudos.receiver_id = private.user_id())
      and kudos.moderation_status <> 'removed'
      and not private.is_blocked_between(kudos.sender_id, kudos.receiver_id)
    )
  );

-- Shoutouts: 003 made every shoutout world-readable (USING (true)), 040 narrowed
-- that to any signed-in user. The app reads them only through the service
-- role, so direct access is limited to the sender and receiver.
drop policy if exists "shoutouts_select_all" on public.shoutouts;
drop policy if exists "shoutouts_authenticated_select" on public.shoutouts;
drop policy if exists "shoutouts_select_involved" on public.shoutouts;
create policy "shoutouts_select_involved" on public.shoutouts
  for select using (
    private.user_role() = 'admin'
    or (
      (shoutouts.sender_id = private.user_id() or shoutouts.receiver_id = private.user_id())
      and shoutouts.moderation_status <> 'removed'
      and not private.is_blocked_between(shoutouts.sender_id, shoutouts.receiver_id)
    )
  );
