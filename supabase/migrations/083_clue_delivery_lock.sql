-- Clue delivery, study hunts and the stop lock (2026-11-16).
--
-- Hunts choose how clues are handed out (src/lib/play/clue-delivery.ts):
--   hunts.metadata.clue_delivery  'all_at_once' | 'fixed_order' | 'assigned_order' | 'random_order'
--   public.hunt_clue_orders       for assigned_order: the creator's orders, each
--                                 a JSON array listing every find id once
--   hunts.metadata.study_hunt     true for hunts used in a study
-- Older hunts only have metadata.shuffle_stops = true, meaning random_order.
--
-- 1. The orders live in their own table, not in hunts.metadata, because
--    public hunts are readable by anyone (hunts_select_public) and players must
--    not see the other orders. RLS is on with no policies: only the service
--    role (the API) reads or writes it. Owners and reviewers get the orders
--    through the hunts API; players get only their own resolved order.
--
-- 2. A hunt is locked once it is not a draft or anyone has a play session on
--    it (a hunt can be unpublished after play). From then on:
--      - every hunt: its clue delivery setting and its orders can't change;
--      - study hunts, and hunts with assigned orders: the set and order of
--        stops is frozen too (no stop added, removed by soft or hard delete,
--        moved to another hunt, or re-sorted). A stop's content can still be
--        edited. Other hunts keep the unpublish -> edit -> resubmit workflow.
--    The API rejects all of this with a clear 409 (src/lib/hunts/delivery-lock.ts);
--    these triggers are the backstop for writes that skip the API, e.g. a
--    creator's own JWT against PostgREST under the hunts/finds policies.
--
-- 3. The study flag lives in hunts.metadata (beside clue_delivery) rather than
--    a column so the app keeps working before this migration is applied, and
--    because the API already guards metadata writes. Only admins and
--    researchers (their own JWT) or trusted server-side callers (the service
--    role, i.e. the API, which checks the role itself; or operator SQL with no
--    JWT) may set or clear it. Once a study hunt is locked, nobody may clear
--    it: that would undo the stop freeze.
--
--    Cascades are allowed: when a hunt row itself is deleted, its finds and
--    orders go with it. Operators running maintenance SQL (e.g. the teardown
--    block of supabase/seed/college_campus_hunts.sql against a played study
--    hunt) can opt out of every lock for their transaction with:
--        set local findamine.allow_locked_edits = 'on';
--
-- 4. No other schema change: each play session's mode and assigned order
--    group are kept in play_sessions.metadata (clue_delivery, clue_order_index).

-- ── 1. Orders table ────────────────────────────────────────────
create table if not exists public.hunt_clue_orders (
  hunt_id uuid primary key references public.hunts(id) on delete cascade,
  orders jsonb not null default '[]'::jsonb check (jsonb_typeof(orders) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.hunt_clue_orders enable row level security;
revoke all on table public.hunt_clue_orders from anon, authenticated;
grant select, insert, update, delete on table public.hunt_clue_orders to service_role;

drop trigger if exists set_hunt_clue_orders_updated_at on public.hunt_clue_orders;
create trigger set_hunt_clue_orders_updated_at
  before update on public.hunt_clue_orders
  for each row execute function public.set_updated_at();

-- Move any orders already saved in hunts.metadata (pre-083 builds of this
-- feature) into the table, then strip the key so the publicly readable
-- metadata never carries them. Runs before the lock triggers below exist, so
-- played or published hunts are moved too. No hunt in production is expected
-- to have the key; this closes the gap regardless.
insert into public.hunt_clue_orders (hunt_id, orders)
select h.id, h.metadata->'clue_orders'
  from public.hunts h
 where h.metadata ? 'clue_orders'
   and jsonb_typeof(h.metadata->'clue_orders') = 'array'
on conflict (hunt_id) do nothing;

update public.hunts
   set metadata = metadata - 'clue_orders'
 where metadata ? 'clue_orders';

-- ── 2. Lock helpers ────────────────────────────────────────────
create or replace function private.locked_edits_allowed()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('findamine.allow_locked_edits', true), '') = 'on';
$$;

create or replace function private.hunt_is_locked(p_hunt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- A hunt that no longer exists (cascade delete in progress) is not locked.
  select not private.locked_edits_allowed()
     and exists (
       select 1 from public.hunts h
        where h.id = p_hunt_id
          and (h.status <> 'draft'
               or exists (select 1 from public.play_sessions ps where ps.hunt_id = h.id))
     );
$$;

create or replace function private.effective_clue_delivery(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when meta->>'clue_delivery' in ('all_at_once', 'fixed_order', 'assigned_order', 'random_order')
        then meta->>'clue_delivery'
    end,
    case when meta->'shuffle_stops' = 'true'::jsonb then 'random_order' else 'fixed_order' end
  );
$$;

-- Study hunts and assigned-order hunts freeze their stops once locked.
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
               or private.effective_clue_delivery(coalesce(h.metadata, '{}'::jsonb)) = 'assigned_order')
     );
$$;

-- May this request change the study flag? Server-side callers (service role,
-- operator SQL) are trusted; end users only when they are admins/researchers.
-- Reads the session's role setting, as private.caller_is_reviewer (073) does:
-- PostgREST sets it to anon/authenticated, and SECURITY DEFINER doesn't change it.
create or replace function private.caller_may_set_study_flag()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('role', true), '') not in ('anon', 'authenticated')
      or private.caller_is_reviewer();
$$;

-- ── 3. Hunt settings: clue delivery and the study flag (hunts.metadata) ──
create or replace function private.guard_hunt_delivery_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_study boolean := case when tg_op = 'UPDATE'
                            then coalesce(old.metadata->'study_hunt' = 'true'::jsonb, false)
                            else false end;
  new_study boolean := coalesce(new.metadata->'study_hunt' = 'true'::jsonb, false);
begin
  if private.locked_edits_allowed() then
    return new;
  end if;

  if old_study is distinct from new_study then
    if not private.caller_may_set_study_flag() then
      raise exception 'Only admins and researchers can mark or unmark a study hunt.'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and old_study and not new_study
       and (old.status <> 'draft' or private.hunt_is_locked(old.id)) then
      raise exception 'This study hunt has been published or played, so it can''t stop being a study hunt.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and private.effective_clue_delivery(coalesce(old.metadata, '{}'::jsonb))
         is distinct from private.effective_clue_delivery(coalesce(new.metadata, '{}'::jsonb))
     -- Checked against the row as it was: publishing and the edit can't be combined to dodge it.
     and (old.status <> 'draft' or new.status <> 'draft' or private.hunt_is_locked(old.id)) then
    raise exception 'Clue delivery is locked because this hunt has been published or played.'
      using errcode = 'check_violation',
            hint = 'Clone the hunt to use a different clue delivery setting.';
  end if;
  return new;
end;
$$;

drop trigger if exists hunts_clue_delivery_lock on public.hunts;
create trigger hunts_clue_delivery_lock
  before insert or update of metadata on public.hunts
  for each row
  execute function private.guard_hunt_delivery_settings();

-- ── 4. Assigned orders (hunt_clue_orders) ──────────────────────
create or replace function private.guard_clue_orders_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.orders is not distinct from new.orders and old.hunt_id = new.hunt_id then
    return new;
  end if;
  if private.hunt_is_locked(case when tg_op = 'DELETE' then old.hunt_id else new.hunt_id end)
     or (tg_op = 'UPDATE' and private.hunt_is_locked(old.hunt_id)) then
    raise exception 'Clue orders are locked because this hunt has been published or played.'
      using errcode = 'check_violation',
            hint = 'Clone the hunt to use different orders.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists hunt_clue_orders_lock on public.hunt_clue_orders;
create trigger hunt_clue_orders_lock
  before insert or update or delete on public.hunt_clue_orders
  for each row
  execute function private.guard_clue_orders_lock();

-- ── 5. The set and order of stops (finds) on study / assigned-order hunts ──
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
    raise exception 'Stops are locked because this study hunt (or hunt with assigned orders) has been published or played.'
      using errcode = 'check_violation',
            hint = 'Stops can no longer be added, removed or reordered. Clone the hunt to change its stops.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists finds_locked_stops on public.finds;
create trigger finds_locked_stops
  before insert or delete or update of sort_order, deleted_at, hunt_id on public.finds
  for each row
  execute function private.guard_locked_stops();

revoke all on function private.locked_edits_allowed() from public, anon, authenticated;
revoke all on function private.hunt_is_locked(uuid) from public, anon, authenticated;
revoke all on function private.effective_clue_delivery(jsonb) from public, anon, authenticated;
revoke all on function private.hunt_stops_frozen(uuid) from public, anon, authenticated;
revoke all on function private.caller_may_set_study_flag() from public, anon, authenticated;
revoke all on function private.guard_hunt_delivery_settings() from public, anon, authenticated;
revoke all on function private.guard_clue_orders_lock() from public, anon, authenticated;
revoke all on function private.guard_locked_stops() from public, anon, authenticated;
