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
-- execute it.
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
