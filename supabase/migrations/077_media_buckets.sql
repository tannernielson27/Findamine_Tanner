-- 077: storage buckets used by POST /api/v1/media/upload.
--
-- The route (src/lib/media/upload-policy.ts) stores into hunt-media, avatars
-- and captures, but no migration created them; on the hosted project none of
-- the three existed (checked 2026-10-15), so every upload failed with
-- "Bucket not found".
--
--   hunt-media  public: hunt content shown to every player of a hunt.
--   avatars     private: a profile field with per-viewer visibility; the
--               route returns a short-lived signed URL.
--   captures    private: photos/recordings players take during a hunt.
--
-- As in 070, no storage.objects policies are added, so anon and
-- authenticated have no direct access; the route uploads and signs URLs with
-- the service-role client. Size and MIME limits mirror the route's policy
-- (2 MB; images for avatars, images/audio/video for hunt-media and captures)
-- so storage rejects anything the route would.
--
-- on conflict do nothing: an existing bucket keeps its settings. In
-- particular this does not flip an existing public bucket to private.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'hunt-media',
    'hunt-media',
    true,
    2097152,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/wav', 'audio/webm',
      'video/mp4', 'video/webm'
    ]
  ),
  (
    'avatars',
    'avatars',
    false,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'captures',
    'captures',
    false,
    2097152,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/wav', 'audio/webm',
      'video/mp4', 'video/webm'
    ]
  )
on conflict (id) do nothing;
