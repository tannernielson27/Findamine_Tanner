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
--      cards), 5 MB, JPEG/PNG/WebP/HEIC(HEIF) only. Public buckets serve
--      objects by URL without any storage.objects SELECT policy, so none is
--      added (one would also let clients list every object).
--   3. storage.objects write policies for direct (JWT) access. The route
--      uses the service role and is not affected. A hunt's creator, or an
--      admin/researcher, may add objects under that hunt's folder. Replacing
--      or deleting an existing object is admin/researcher only: an approved
--      cover's URL stays the same if its bytes are swapped, so letting a
--      creator overwrite one would change a reviewed image without review.
--      Creators replace a cover by uploading a new object and pointing
--      cover_image_url at it, which the trigger below sends to review.
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
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- ── 3. Storage policies ───────────────────────────────────

-- True when the caller may manage covers for the hunt whose id is the first
-- path segment of an object name. SECURITY DEFINER so it can read hunts
-- regardless of the caller's hunts RLS; it only answers yes/no.
create or replace function private.can_write_hunt_cover(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role(), '') in ('admin', 'researcher')
    or exists (
      select 1
      from public.hunts h
      where h.id::text = (storage.foldername(p_object_name))[1]
        and h.deleted_at is null
        and h.created_by = private.user_id()
    );
$$;

revoke all on function private.can_write_hunt_cover(text) from public;
grant execute on function private.can_write_hunt_cover(text) to authenticated, service_role;

drop policy if exists "hunt_covers_insert_owner" on storage.objects;
create policy "hunt_covers_insert_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hunt-covers'
    and array_length(storage.foldername(name), 1) = 1
    and private.can_write_hunt_cover(name)
  );

drop policy if exists "hunt_covers_update_staff" on storage.objects;
create policy "hunt_covers_update_staff" on storage.objects
  for update to authenticated
  using (bucket_id = 'hunt-covers' and coalesce(private.user_role(), '') in ('admin', 'researcher'))
  with check (bucket_id = 'hunt-covers' and coalesce(private.user_role(), '') in ('admin', 'researcher'));

drop policy if exists "hunt_covers_delete_staff" on storage.objects;
create policy "hunt_covers_delete_staff" on storage.objects
  for delete to authenticated
  using (bucket_id = 'hunt-covers' and coalesce(private.user_role(), '') in ('admin', 'researcher'));

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
