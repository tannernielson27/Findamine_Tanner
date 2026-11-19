-- Read rules for the tables hunts are built from (2026-11-19).
--
-- A stop's clue, place, challenge and primer reach a player through the play
-- API, which releases them step by step (start, arrival, difficulty, release
-- time). The API reads with the service role, so nothing in the app depends
-- on these tables being readable with a player's own login. This sets the
-- row-level read rules to match what the API allows.
--
-- With their own login a signed-in user reads:
--   finds        of hunts they created       (admins and researchers: all)
--   locations    they created                (admins and researchers: all)
--   tasks        they created                (admins and researchers: all)
--   primers      they created                (admins and researchers: all)
--   find_completions  their own               (admins and researchers: all)
--   find_photos  their own                    (admins: all)
-- Shared library rows are served by the API (GET /api/v1/locations, /tasks,
-- /primers, /curriculum). A hunt's creator sees their players' progress and
-- photos through the app.
--
-- Write policies (insert, update, delete) on finds, locations, tasks and
-- primers are not changed. On find_photos, changing or deleting a row is for
-- the person who uploaded it and for admins.
--
-- nearby_locations() is called by the API only, so only the service role may
-- execute it. ai_hint_cache holds hints written from a stop's clue and place;
-- the API reads it with the service role, and admins and researchers keep the
-- access they have.
--
-- Two rules for writes made with a user's own login (the API applies the same
-- ones itself, in src/app/api/v1/hunts/find-content-guard.ts and
-- src/lib/hunts/content-access.ts):
--   - a stop may point at a place, challenge or primer its builder can read
--     (their own, or one in the shared library), or one the same hunt already
--     uses; admins and researchers: any
--   - only admins and researchers put a row in the shared library
--
-- Order against the code does not matter: neither the code that is live today
-- nor the code in this branch reads these tables with a player's login.
-- Rewrites no data. Safe to run more than once.

-- ── finds ──────────────────────────────────────────────────────
drop policy if exists finds_select_via_hunt on public.finds;
drop policy if exists finds_select_hunt_editors on public.finds;
create policy finds_select_hunt_editors on public.finds
  for select
  using (
    exists (
      select 1 from public.hunts h
       where h.id = finds.hunt_id
         and (h.created_by = (select private.user_id())
              or (select private.user_role()) in ('admin', 'researcher'))
    )
  );

-- ── locations, tasks, primers ──────────────────────────────────
drop policy if exists locations_select_public on public.locations;
drop policy if exists locations_select_own on public.locations;
create policy locations_select_own on public.locations
  for select
  using (
    created_by = (select private.user_id())
    or (select private.user_role()) in ('admin', 'researcher')
  );

drop policy if exists tasks_select_all on public.tasks;
drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks
  for select
  using (
    created_by = (select private.user_id())
    or (select private.user_role()) in ('admin', 'researcher')
  );

drop policy if exists primers_select_all on public.primers;
drop policy if exists primers_select_own on public.primers;
create policy primers_select_own on public.primers
  for select
  using (
    created_by = (select private.user_id())
    or (select private.user_role()) in ('admin', 'researcher')
  );

-- ── find_completions: where and when a player was at each stop ──
drop policy if exists completions_select_own on public.find_completions;
create policy completions_select_own on public.find_completions
  for select
  using (
    exists (
      select 1 from public.play_sessions ps
       where ps.id = find_completions.play_session_id
         and (ps.user_id = (select private.user_id())
              or (select private.user_role()) in ('admin', 'researcher'))
    )
  );

-- ── find_photos: a player's photos at stops ────────────────────
drop policy if exists photos_own on public.find_photos;
create policy photos_own on public.find_photos
  for all
  using (uploaded_by = (select private.user_id()))
  with check (uploaded_by = (select private.user_id()));

drop policy if exists photos_admin on public.find_photos;
create policy photos_admin on public.find_photos
  for all
  using ((select private.user_role()) = 'admin')
  with check ((select private.user_role()) = 'admin');

-- ── nearby_locations(): the API's, not the public's ────────────
revoke all on function public.nearby_locations(double precision, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.nearby_locations(double precision, double precision, double precision, integer)
  to service_role;

-- ── ai_hint_cache ──────────────────────────────────────────────
drop policy if exists hints_select_all on public.ai_hint_cache;

-- ── What a stop may point at ───────────────────────────────────
-- True for requests made with a user's own login (PostgREST sets the role to
-- anon or authenticated). The service role and operator SQL are not held to
-- the two rules below: the API checks them itself before it writes.
create or replace function private.caller_is_end_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('role', true), '') in ('anon', 'authenticated');
$$;

-- May the caller put this row on a stop of this hunt? Definer rights, because
-- the caller's own read rules hide library rows they did not create.
create or replace function private.may_use_content(p_kind text, p_id uuid, p_hunt_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean := false;
begin
  if p_id is null then
    return true;
  end if;
  if coalesce(private.user_role(), '') in ('admin', 'researcher') then
    return true;
  end if;

  if p_kind = 'location' then
    select exists (select 1 from public.locations r
                    where r.id = p_id and r.deleted_at is null
                      and (r.is_library is true or r.created_by = private.user_id()))
        or exists (select 1 from public.finds f
                    where f.hunt_id = p_hunt_id and f.location_id = p_id and f.deleted_at is null)
      into v_ok;
  elsif p_kind = 'task' then
    select exists (select 1 from public.tasks r
                    where r.id = p_id and r.deleted_at is null
                      and (r.is_library is true or r.created_by = private.user_id()))
        or exists (select 1 from public.finds f
                    where f.hunt_id = p_hunt_id and f.task_id = p_id and f.deleted_at is null)
      into v_ok;
  elsif p_kind = 'primer' then
    select exists (select 1 from public.primers r
                    where r.id = p_id and r.deleted_at is null
                      and (r.is_library is true or r.created_by = private.user_id()))
        or exists (select 1 from public.finds f
                    where f.hunt_id = p_hunt_id and f.primer_id = p_id and f.deleted_at is null)
      into v_ok;
  end if;
  return coalesce(v_ok, false);
end;
$$;

create or replace function private.guard_find_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.caller_is_end_user() then
    return new;
  end if;

  if (tg_op = 'INSERT' or new.location_id is distinct from old.location_id)
     and not private.may_use_content('location', new.location_id, new.hunt_id) then
    raise exception 'That place is not yours or in the shared library.' using errcode = 'insufficient_privilege';
  end if;
  if (tg_op = 'INSERT' or new.task_id is distinct from old.task_id)
     and not private.may_use_content('task', new.task_id, new.hunt_id) then
    raise exception 'That challenge is not yours or in the shared library.' using errcode = 'insufficient_privilege';
  end if;
  if (tg_op = 'INSERT' or new.primer_id is distinct from old.primer_id)
     and not private.may_use_content('primer', new.primer_id, new.hunt_id) then
    raise exception 'That primer is not yours or in the shared library.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists finds_content_refs on public.finds;
create trigger finds_content_refs
  before insert or update of location_id, task_id, primer_id, hunt_id on public.finds
  for each row
  execute function private.guard_find_content();

-- ── Who may put a row in the shared library ────────────────────
create or replace function private.guard_library_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.caller_is_end_user() then
    return new;
  end if;
  if new.is_library is true
     and (tg_op = 'INSERT' or old.is_library is distinct from true)
     and coalesce(private.user_role(), '') not in ('admin', 'researcher') then
    raise exception 'Only an admin can add items to the shared library.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists locations_library_flag on public.locations;
create trigger locations_library_flag
  before insert or update of is_library on public.locations
  for each row execute function private.guard_library_flag();

drop trigger if exists tasks_library_flag on public.tasks;
create trigger tasks_library_flag
  before insert or update of is_library on public.tasks
  for each row execute function private.guard_library_flag();

drop trigger if exists primers_library_flag on public.primers;
create trigger primers_library_flag
  before insert or update of is_library on public.primers
  for each row execute function private.guard_library_flag();

revoke all on function private.caller_is_end_user() from public, anon, authenticated;
revoke all on function private.may_use_content(text, uuid, uuid) from public, anon, authenticated;
revoke all on function private.guard_find_content() from public, anon, authenticated;
revoke all on function private.guard_library_flag() from public, anon, authenticated;
