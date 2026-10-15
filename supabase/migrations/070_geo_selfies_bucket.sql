-- 070: private storage bucket for geo-selfies.
--
-- The capture route (src/app/api/v1/play/[huntId]/capture/route.ts) uploaded
-- to a `hunt-media` bucket that no migration ever created, so every geo-selfie
-- from a non-child player failed with "Bucket not found".
--
-- Geo-selfies are photos of participants, so the bucket is private: no
-- storage.objects policies are added, which leaves anon and authenticated
-- roles with no access. The route uploads with the service-role client and
-- stores only the object path in find_photos.storage_ref.
--
-- Size cap matches the route's 10MB check. HEIC/HEIF covers iOS uploads that
-- are not converted to JPEG.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'geo-selfies',
  'geo-selfies',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;
