-- 075: private storage bucket for spoken answers to audio_response challenges.
--
-- The recorder (src/components/play/challenge-input.tsx) used to submit only a
-- placeholder like "[audio:12s]" and never upload the recording. It now posts
-- the recording to src/app/api/v1/play/[huntId]/audio/route.ts, which uploads
-- it here with the service-role client and returns the answer reference
-- "[audio:<seconds>s:<path>]" that is stored in find_completions.answer_value.
--
-- Same model as geo-selfies (070): spoken answers are a person's voice, so the
-- bucket is private and no storage.objects policies are added, which leaves
-- anon and authenticated roles with no access. Playback is only through
-- short-lived signed URLs from the route's GET handler (the player who
-- recorded it, or an admin).
--
-- Paths are <users.id>/<find_completion_id>_<ms>.<ext>, so account deletion
-- (src/lib/services/account-deletion.ts PERSONAL_BUCKETS, migration 071)
-- removes them with the rest of the person's folder. Recordings from child
-- accounts (under 13) are never uploaded.
--
-- Size cap matches the route's 4MB check (under Vercel's 4.5MB body limit).
-- MIME types are what MediaRecorder produces: audio/webm (Chrome, Edge,
-- Android), audio/mp4 (Safari, iOS WKWebView), audio/ogg (Firefox).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'challenge-audio',
  'challenge-audio',
  false,
  4194304,
  array['audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/ogg']
)
on conflict (id) do nothing;
