-- One-way follows between players (2026-11-19).
--
-- A follow needs no approval: follower -> followee. It is the second social
-- tie next to crews (minion_links, 046) and mutual friends
-- (friend_connections).
--
-- What a follow changes about who can see what is decided in the API
-- (src/lib/social/social-tiers.ts), for adult accounts only:
--   * someone in your crew sees what you share with the "team" audience
--   * someone YOU follow sees what you share with the "class" audience
-- Being followed gives the follower nothing extra: they see what you share
-- with everyone until you follow them back.
--
-- The API writes with the service role and checks roles and blocks itself
-- (src/app/api/v1/social/follows). The policies below cover direct access with
-- a user's own login: a person reads the rows they are on either side of and
-- can remove a row from either side (unfollow, or remove a follower). Creating
-- a follow is API-only.
--
-- Needs 066 (private.user_id, private.user_role).
-- Old code ignores the table, so apply this BEFORE deploying the code that
-- reads it. Safe to run more than once.

create table if not exists public.player_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.users(id) on delete cascade,
  followee_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint player_follows_no_self check (follower_id <> followee_id),
  constraint player_follows_pair_unique unique (follower_id, followee_id)
);

comment on table public.player_follows is
  'One-way follows: follower_id follows followee_id. No approval step. See src/lib/social/social-tiers.ts for what it changes about visibility.';

-- (follower_id, followee_id) is covered by the unique constraint's index.
create index if not exists idx_player_follows_followee on public.player_follows(followee_id);

alter table public.player_follows enable row level security;

drop policy if exists "player_follows_select_own" on public.player_follows;
create policy "player_follows_select_own" on public.player_follows
  for select using (
    follower_id = (select private.user_id())
    or followee_id = (select private.user_id())
    or (select private.user_role()) in ('admin', 'researcher')
  );

drop policy if exists "player_follows_delete_own" on public.player_follows;
create policy "player_follows_delete_own" on public.player_follows
  for delete using (
    follower_id = (select private.user_id()) or followee_id = (select private.user_id())
  );

-- No insert or update policy. A follow is created only through the API, which
-- checks both accounts' roles and blocks (a direct insert could not: the
-- caller's own login cannot read the other person's role). A follow is never
-- edited, only created or removed.
revoke insert, update on table public.player_follows from anon, authenticated;
