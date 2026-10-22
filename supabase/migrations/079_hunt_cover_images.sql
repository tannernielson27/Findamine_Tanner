-- 079: hunt cover photos.
--
-- Image-led hunt cards (design overhaul) need a photo per hunt. Creators
-- upload one through POST /api/v1/hunts/[id]/cover, which checks the file by
-- its bytes, stores it in the hunt-covers bucket under <hunt id>/<file> and
-- records its public URL in hunts.cover_image_url. A hunt without one shows
-- generated contour art.
--
--   1. hunts.cover_image_url: nullable; when set, an https URL to an object
--      in the hunt-covers bucket (a Supabase public-object URL). Covers are
--      shown to every player, so a URL on some other host would let a
--      creator make players' browsers load a third-party image.
--   2. hunt-covers bucket: public read (covers appear on public catalogue
--      cards), 4 MB (under Vercel's ~4.5 MB request limit), JPEG/PNG/WebP/HEIC(HEIF) only. Public buckets serve
--      objects by URL without any storage.objects SELECT policy, so none is
--      added (one would also let clients list every object).
--   3. The cover route (service role) is the only writer: no storage write
--      policies for the bucket, and a trigger refuses cover_image_url
--      changes from user JWTs and URLs outside the hunt's own folder.
--      (Security review 2026-10-21: a creator could otherwise set the
--      column directly via hunts_update_own and point it at any host.)
--   4. Publish review: cover_image_url joins the columns whose change takes
--      an approved hunt back to 'pending' (requeue_hunt_on_content_change,
--      073). The function is restated from 073 with that one column added.

-- ── 1. Column ─────────────────────────────────────────────

alter table public.hunts
  add column if not exists cover_image_url text;

alter table public.hunts
  drop constraint if exists hunts_cover_image_url_check;

alter table public.hunts
  add constraint hunts_cover_image_url_check
  check (
    cover_image_url is null
    or (
      length(cover_image_url) <= 2048
      and cover_image_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/hunt-covers/[0-9a-fA-F-]{36}/[A-Za-z0-9-]+\.[a-z0-9]{1,5}$'
    )
  );

comment on column public.hunts.cover_image_url is
  'Public URL of the hunt''s cover photo in the hunt-covers bucket; null shows generated art. Set only via POST/DELETE /api/v1/hunts/[id]/cover. Changing it on an approved hunt sends it back to review.';

-- ── 2. Bucket ─────────────────────────────────────────────
-- As in 070/077: on conflict do nothing, so an existing bucket keeps its
-- settings.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hunt-covers',
  'hunt-covers',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- ── 3. Writes go through the cover route only ─────────────
-- No storage.objects write policies for this bucket: the cover route
-- (service role) is the only writer, so every stored file has passed its
-- byte check and size limit. Drop any policies an earlier draft created.

drop policy if exists "hunt_covers_insert_owner" on storage.objects;
drop policy if exists "hunt_covers_update_staff" on storage.objects;
drop policy if exists "hunt_covers_delete_staff" on storage.objects;
drop function if exists private.can_write_hunt_cover(text);

-- hunts.cover_image_url may change only through that route. hunts_update_own
-- lets a creator update their own row with their JWT, so without this guard
-- they could point the cover at any host (players' browsers would load it)
-- or at another hunt's file. Callers with a user JWT (authenticated / anon)
-- are refused; the service role and direct SQL (migrations, dashboard) pass.
-- Whoever sets it, the URL must point into this hunt's own folder.
create or replace function private.guard_hunt_cover_image()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if tg_op = 'UPDATE' and new.cover_image_url is not distinct from old.cover_image_url then
    return new;
  end if;
  if new.cover_image_url is null then
    if tg_op = 'UPDATE' and v_role in ('authenticated', 'anon') then
      raise exception 'cover_image_url can only be changed through the cover upload'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if v_role in ('authenticated', 'anon') then
    raise exception 'cover_image_url can only be changed through the cover upload'
      using errcode = '42501';
  end if;
  if position('/storage/v1/object/public/hunt-covers/' || new.id::text || '/' in new.cover_image_url) = 0 then
    raise exception 'cover_image_url must point into this hunt''s folder of the hunt-covers bucket'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_hunt_cover_image() from public;

drop trigger if exists guard_hunt_cover_image on public.hunts;
create trigger guard_hunt_cover_image
  before insert or update of cover_image_url on public.hunts
  for each row execute function private.guard_hunt_cover_image();

-- ── 4. Publish review ─────────────────────────────────────
-- Identical to 073 except for the cover_image_url line.

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
    or new.metadata is distinct from old.metadata
    or new.cover_image_url is distinct from old.cover_image_url;
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
