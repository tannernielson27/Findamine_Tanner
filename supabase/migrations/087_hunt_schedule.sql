-- Multi-day scheduled hunts (2026-11-19, issue #14).
--
-- A scheduled hunt runs over a set window and releases its stops at set
-- times. Everyone shares the window; a player can join at any point while it
-- is open and gets every stop released so far
-- (src/lib/hunts/schedule.ts).
--
--   hunts.starts_at / hunts.ends_at   the window, in UTC. Both null on every
--                                     hunt that exists today: those stay
--                                     play-anytime hunts and nothing about
--                                     them changes.
--   finds.release_at                  when the stop opens. Null means "at the
--                                     hunt's start". The play API sends
--                                     nothing about a stop before then.
--   hunts.metadata.schedule_timezone  the time zone the creator entered the
--                                     times in (display only; the server
--                                     compares instants).
--
-- 1. The columns, with a check that a window is whole and runs forward.
-- 2. The schedule is locked once the hunt is published or played: the same
--    rule as clue delivery (083) and difficulty (086). The API refuses the
--    change with a 409 (PUT /api/v1/hunts/[id]/schedule); these triggers are
--    the backstop for writes that skip the API. Operator opt-out as in 083:
--        set local findamine.allow_locked_edits = 'on';
--    A locked scheduled hunt also freezes its stops (no add, remove or
--    reorder), through the stop lock from 083.
-- 3. hunt_schedule_notices: one row per notice sent to a player about a
--    release or the hunt ending, so the notification job can run as often as
--    it likes without sending anything twice. Service role only.
--
-- Needs 083 (private.locked_edits_allowed, private.hunt_is_locked).
-- Apply BEFORE deploying the code: the play routes select the new columns.
-- The old code ignores them, so applying this first is safe mid-hunt.
-- Rewrites nothing. Safe to run more than once.

-- ── 1. Columns ─────────────────────────────────────────────────
alter table public.hunts
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

alter table public.finds
  add column if not exists release_at timestamptz;

comment on column public.hunts.starts_at is
  'Scheduled hunts: when the hunt opens for everyone (UTC). Null on play-anytime hunts.';
comment on column public.hunts.ends_at is
  'Scheduled hunts: when the hunt closes (UTC). Null on play-anytime hunts.';
comment on column public.finds.release_at is
  'Scheduled hunts: when this stop opens to players (UTC). Null means at the hunt''s start. Ignored on play-anytime hunts.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'hunts_schedule_window' and conrelid = 'public.hunts'::regclass
  ) then
    alter table public.hunts
      add constraint hunts_schedule_window check (
        (starts_at is null and ends_at is null)
        or (starts_at is not null and ends_at is not null and ends_at > starts_at)
      );
  end if;
end $$;

-- The notification job looks for hunts whose window is open, and for stops
-- released since it last ran.
create index if not exists hunts_schedule_idx
  on public.hunts (starts_at, ends_at)
  where starts_at is not null and deleted_at is null;

create index if not exists finds_release_at_idx
  on public.finds (hunt_id, release_at)
  where release_at is not null and deleted_at is null;

-- ── 2. Schedule lock ───────────────────────────────────────────
create or replace function private.guard_hunt_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.locked_edits_allowed() then
    return new;
  end if;

  if (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
     -- Checked against the row as it was: publishing and the edit can't be combined to dodge it.
     and (old.status <> 'draft' or new.status <> 'draft' or private.hunt_is_locked(old.id)) then
    raise exception 'The schedule is locked because this hunt has been published or played.'
      using errcode = 'check_violation',
            hint = 'Unpublish the hunt (if nobody has played it) or clone it to change the schedule.';
  end if;
  return new;
end;
$$;

drop trigger if exists hunts_schedule_lock on public.hunts;
create trigger hunts_schedule_lock
  before update of starts_at, ends_at on public.hunts
  for each row
  execute function private.guard_hunt_schedule();

create or replace function private.guard_find_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.locked_edits_allowed() then
    return new;
  end if;

  if old.release_at is distinct from new.release_at and private.hunt_is_locked(old.hunt_id) then
    raise exception 'The schedule is locked because this hunt has been published or played.'
      using errcode = 'check_violation',
            hint = 'Unpublish the hunt (if nobody has played it) or clone it to change the schedule.';
  end if;
  return new;
end;
$$;

drop trigger if exists finds_release_lock on public.finds;
create trigger finds_release_lock
  before update of release_at on public.finds
  for each row
  execute function private.guard_find_release();

revoke all on function private.guard_hunt_schedule() from public, anon, authenticated;
revoke all on function private.guard_find_release() from public, anon, authenticated;

-- A locked scheduled hunt freezes its stops, as a locked study hunt or one
-- with assigned orders already does (083): a stop added after the lock would
-- have no release time and open at once, and removing a stop and adding it
-- back would do the same to one that is not out yet. Same function as 083
-- with the schedule added; the finds_locked_stops trigger from 083 calls it.
create or replace function private.hunt_stops_frozen(p_hunt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.hunt_is_locked(p_hunt_id)
     and exists (
       select 1 from public.hunts h
        where h.id = p_hunt_id
          and (h.metadata->'study_hunt' = 'true'::jsonb
               or private.effective_clue_delivery(coalesce(h.metadata, '{}'::jsonb)) = 'assigned_order'
               or h.starts_at is not null)
     );
$$;

-- Same as 083 with a message that fits all three cases.
create or replace function private.guard_locked_stops()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched boolean;
begin
  if tg_op = 'INSERT' then
    touched := new.deleted_at is null and private.hunt_stops_frozen(new.hunt_id);
  elsif tg_op = 'DELETE' then
    touched := old.deleted_at is null and private.hunt_stops_frozen(old.hunt_id);
  else
    -- Only position, removal/restore and moving between hunts count; content edits are fine.
    if old.sort_order is not distinct from new.sort_order
       and (old.deleted_at is null) = (new.deleted_at is null)
       and old.hunt_id = new.hunt_id then
      return new;
    end if;
    touched := private.hunt_stops_frozen(old.hunt_id) or private.hunt_stops_frozen(new.hunt_id);
  end if;

  if touched then
    raise exception 'Stops are locked because this hunt (a study hunt, one with assigned orders, or a scheduled one) has been published or played.'
      using errcode = 'check_violation',
            hint = 'Stops can no longer be added, removed or reordered. Clone the hunt to change its stops.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.hunt_stops_frozen(uuid) from public, anon, authenticated;
revoke all on function private.guard_locked_stops() from public, anon, authenticated;

-- ── 3. Notices already sent ────────────────────────────────────
create table if not exists public.hunt_schedule_notices (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('release', 'ending_soon')),
  -- The moment the notice is about: the release time, or the hunt's end.
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (hunt_id, user_id, kind, due_at)
);

comment on table public.hunt_schedule_notices is
  'One row per schedule notice sent to a player (a release, or the hunt ending soon). The unique key makes the notification job safe to run repeatedly.';

alter table public.hunt_schedule_notices enable row level security;
revoke all on table public.hunt_schedule_notices from anon, authenticated;
grant all on table public.hunt_schedule_notices to service_role;
