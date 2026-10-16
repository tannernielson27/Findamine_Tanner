-- 073: review gate between "publish" and the public hunt catalogue.
--
-- Teachers and hunt creators used to publish straight into /browse with no
-- review (App Store guideline 1.2: user-generated content needs moderation).
-- Publishing now puts a hunt in review_status = 'pending'. It stays playable
-- by its creator, reviewers, and students on the creator's rosters, but it is
-- only listed publicly (is_public = true) once an admin or researcher approves
-- it through POST /api/v1/hunts/{id}/review.
--
--   not_submitted  never published, or unpublished back to a draft
--   pending        published, waiting for a reviewer
--   approved       listed in the public catalogue
--   rejected       a reviewer declined it; review_reason says why
--
-- Every existing catalogue query already filters on is_public = true
-- (browse page, hunts API, search API, search_hunts(), hunts/finds RLS), so
-- tying is_public to approval gates all of them at once.

-- safety_affirmed_*: the creator's "this hunt is safe for its audience"
-- affirmation (PublishSafetyCheck dialog), required by the publish route.
alter table public.hunts
  add column if not exists safety_affirmed_at timestamptz,
  add column if not exists safety_affirmed_by uuid references public.users(id),
  add column if not exists review_status text not null default 'not_submitted',
  add column if not exists review_reason text,
  add column if not exists review_submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id);

alter table public.hunts
  drop constraint if exists hunts_review_status_check;
alter table public.hunts
  add constraint hunts_review_status_check
  check (review_status in ('not_submitted', 'pending', 'approved', 'rejected'));

-- Grandfather: every hunt that is already out of draft keeps its current
-- visibility, so the catalogue does not empty out when this ships.
update public.hunts
set review_status = 'approved',
    reviewed_at = now(),
    review_reason = 'Grandfathered: published before publish review existed (migration 073)'
where status <> 'draft'
  and review_status = 'not_submitted';

-- A draft that was somehow left public is taken out of the catalogue.
update public.hunts
set is_public = false
where is_public = true
  and review_status <> 'approved';

-- Only an approved hunt may be listed publicly.
alter table public.hunts
  drop constraint if exists hunts_public_requires_approval;
alter table public.hunts
  add constraint hunts_public_requires_approval
  check (is_public is not true or review_status = 'approved');

create index if not exists idx_hunts_review_pending
  on public.hunts (review_submitted_at)
  where review_status = 'pending' and deleted_at is null;

-- hunts_update_own lets a creator update their own row through PostgREST with
-- their own JWT. Stop that path from self-approving: only the service role
-- (the API routes) or an admin/researcher may change review fields or
-- is_public. Migrations and the service role run as other database roles and
-- are not affected.
--
-- It also stops a creator taking a draft live without the publish route
-- (which records the safety affirmation and submits for review): with their
-- own JWT a non-reviewer may not move a hunt out of 'draft'.
--
-- current_user is the right test here because this function is SECURITY
-- INVOKER: it is 'authenticated'/'anon' for a PostgREST request and the owner
-- when a SECURITY DEFINER function below (requeue_hunt_for_review) writes.
create or replace function private.guard_hunt_review_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if coalesce(private.user_role(), '') in ('admin', 'researcher') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.review_status := 'not_submitted';
    new.review_reason := null;
    new.review_submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.safety_affirmed_at := null;
    new.safety_affirmed_by := null;
    new.is_public := false;
    return new;
  end if;

  if new.review_status is distinct from old.review_status
     or new.review_reason is distinct from old.review_reason
     or new.review_submitted_at is distinct from old.review_submitted_at
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.safety_affirmed_at is distinct from old.safety_affirmed_at
     or new.safety_affirmed_by is distinct from old.safety_affirmed_by
     or (new.is_public is true and old.is_public is not true) then
    raise exception 'Hunt review fields can only be changed by a reviewer'
      using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status is distinct from 'draft' then
    raise exception 'Publish a hunt through the publish route'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_hunt_review_fields() from public;
grant execute on function private.guard_hunt_review_fields() to anon, authenticated, service_role;

drop trigger if exists guard_hunt_review_fields on public.hunts;
create trigger guard_hunt_review_fields
  before insert or update on public.hunts
  for each row execute function private.guard_hunt_review_fields();

-- ── Edit after approval ────────────────────────────────
-- A reviewer approved specific content. Any later change to what players see
-- (hunt text, audience, mode, area, grades, metadata; a stop's clue, hints,
-- challenge, primer, place, scaffolding or settings; a shared
-- task/primer/location a listed hunt uses) takes the hunt out of the
-- catalogue and back to 'pending', whoever makes the edit and through
-- whichever path (API routes on the service role, or PostgREST directly), and
-- whatever the hunt's status. Only a reviewer editing with their own JWT is
-- exempt, and an update that itself records a review decision is left alone.
--
-- Editing a hunt that is already 'pending' moves review_submitted_at to now(),
-- so a reviewer's approval can be made conditional on the version they saw
-- (the review route compares review_submitted_at).
--
-- Moving a hunt back to 'draft' takes it out of review and out of the
-- catalogue (review_status 'not_submitted', is_public false), the same as the
-- unpublish route, so draft -> edit -> republish cannot keep an old approval.

-- True when the request comes from an admin/researcher using their own JWT.
-- It reads the session's role setting rather than current_user: PostgREST
-- does SET LOCAL ROLE anon/authenticated, which a SECURITY DEFINER function
-- does not change, whereas current_user inside one is the function owner.
create or replace function private.caller_is_reviewer()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (current_user in ('anon', 'authenticated')
          or coalesce(current_setting('role', true), '') in ('anon', 'authenticated'))
     and coalesce(private.user_role(), '') in ('admin', 'researcher');
$$;

revoke all on function private.caller_is_reviewer() from public;
grant execute on function private.caller_is_reviewer() to anon, authenticated, service_role;

-- Runs as the owner, so guard_hunt_review_fields lets it through.
create or replace function private.requeue_hunt_for_review(p_hunt_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.hunts
  set review_status = 'pending',
      is_public = false,
      review_reason = null,
      reviewed_at = null,
      reviewed_by = null,
      review_submitted_at = now()
  where id = p_hunt_id
    and review_status in ('approved', 'pending');
$$;

revoke all on function private.requeue_hunt_for_review(uuid) from public;

-- Hunts: requeue in place (BEFORE UPDATE, one write). Runs after
-- guard_hunt_review_fields because triggers fire in name order.
create or replace function private.requeue_hunt_on_content_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  -- Back to draft: out of review and out of the catalogue.
  if new.status = 'draft'
     and old.status is distinct from 'draft'
     and new.review_status is distinct from 'not_submitted' then
    new.review_status := 'not_submitted';
    new.is_public := false;
    new.review_reason := null;
    new.review_submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    return new;
  end if;

  -- An update that records a review decision is left alone.
  if new.review_status is distinct from old.review_status
     or private.caller_is_reviewer() then
    return new;
  end if;

  v_changed := new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.theme is distinct from old.theme
    or new.theme_narrative is distinct from old.theme_narrative
    or new.target_audience is distinct from old.target_audience
    or new.play_mode is distinct from old.play_mode
    or new.identity_mode is distinct from old.identity_mode
    or new.center_latitude is distinct from old.center_latitude
    or new.center_longitude is distinct from old.center_longitude
    or new.search_radius_km is distinct from old.search_radius_km
    or new.grade_range_min is distinct from old.grade_range_min
    or new.grade_range_max is distinct from old.grade_range_max
    or new.subject_domains is distinct from old.subject_domains
    or new.metadata is distinct from old.metadata;
  if not v_changed then
    return new;
  end if;

  if new.review_status = 'approved' then
    new.review_status := 'pending';
    new.is_public := false;
    new.review_reason := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_submitted_at := now();
  elsif new.review_status = 'pending' then
    new.review_submitted_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.requeue_hunt_on_content_change() from public;
grant execute on function private.requeue_hunt_on_content_change() to anon, authenticated, service_role;

drop trigger if exists requeue_hunt_on_content_change on public.hunts;
create trigger requeue_hunt_on_content_change
  before update on public.hunts
  for each row execute function private.requeue_hunt_on_content_change();

-- Finds: a new live stop, a restored stop, or a change to a stop's text or
-- to the challenge/primer/place it points at.
create or replace function private.requeue_hunt_on_find_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.caller_is_reviewer() or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT'
     or old.deleted_at is not null
     or new.clue_text is distinct from old.clue_text
     or new.clue_hints is distinct from old.clue_hints
     or new.reading_check is distinct from old.reading_check
     or new.scaffolding_level is distinct from old.scaffolding_level
     or new.hot_cold_enabled is distinct from old.hot_cold_enabled
     or new.metadata is distinct from old.metadata
     or new.task_id is distinct from old.task_id
     or new.primer_id is distinct from old.primer_id
     or new.location_id is distinct from old.location_id then
    perform private.requeue_hunt_for_review(new.hunt_id);
  end if;
  return new;
end;
$$;

revoke all on function private.requeue_hunt_on_find_change() from public;
grant execute on function private.requeue_hunt_on_find_change() to anon, authenticated, service_role;

drop trigger if exists requeue_hunt_on_find_change on public.finds;
create trigger requeue_hunt_on_find_change
  after insert or update on public.finds
  for each row execute function private.requeue_hunt_on_find_change();

-- Tasks, primers and locations are shared library rows: requeue every
-- approved hunt with a live stop that uses the edited row.
create or replace function private.requeue_hunts_using_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hunt uuid;
  v_changed boolean;
begin
  if private.caller_is_reviewer() then
    return new;
  end if;

  if tg_table_name = 'tasks' then
    v_changed := new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.content is distinct from old.content
      or new.feedback is distinct from old.feedback
      or new.challenge_type is distinct from old.challenge_type;
  elsif tg_table_name = 'primers' then
    v_changed := new.title is distinct from old.title
      or new.content is distinct from old.content;
  else -- locations
    v_changed := new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.address is distinct from old.address
      or new.safety_notes is distinct from old.safety_notes
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.radius_meters is distinct from old.radius_meters;
  end if;
  if not v_changed then
    return new;
  end if;

  for v_hunt in
    select distinct f.hunt_id
    from public.finds f
    where f.deleted_at is null
      and case tg_table_name
            when 'tasks' then f.task_id = new.id
            when 'primers' then f.primer_id = new.id
            else f.location_id = new.id
          end
  loop
    perform private.requeue_hunt_for_review(v_hunt);
  end loop;
  return new;
end;
$$;

revoke all on function private.requeue_hunts_using_content() from public;
grant execute on function private.requeue_hunts_using_content() to anon, authenticated, service_role;

drop trigger if exists requeue_hunts_using_task on public.tasks;
create trigger requeue_hunts_using_task
  after update on public.tasks
  for each row execute function private.requeue_hunts_using_content();

drop trigger if exists requeue_hunts_using_primer on public.primers;
create trigger requeue_hunts_using_primer
  after update on public.primers
  for each row execute function private.requeue_hunts_using_content();

drop trigger if exists requeue_hunts_using_location on public.locations;
create trigger requeue_hunts_using_location
  after update on public.locations
  for each row execute function private.requeue_hunts_using_content();

-- Unlisted (pending/rejected) hunts used to be readable by anyone through the
-- anon key because only is_public gated them; is_public now does that job, so
-- hunts_select_public and finds_select_via_hunt need no change.
