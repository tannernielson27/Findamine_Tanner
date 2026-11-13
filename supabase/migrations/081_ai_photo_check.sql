-- AI landmark check for stop photos (docs/ARRIVAL_VERIFICATION_PRIVACY.md).
-- The feature stays off until LANDMARK_PHOTO_CHECK=on; this only adds storage.

-- R1: a player's explicit yes/no to having their stop photos checked by an AI
-- service, with the version of the notice they saw.
-- R8: keyed on the auth user, so deleting the account's sign-in (the last step
-- of account deletion) removes the choice too.
create table if not exists public.ai_photo_check_choices (
  auth_id uuid primary key references auth.users(id) on delete cascade,
  allowed boolean not null,
  notice_version text not null,
  decided_at timestamptz not null default now()
);

comment on table public.ai_photo_check_choices is
  'Opt-in for the AI landmark check on stop photos. Written by the API (service role) only. Not research data.';

alter table public.ai_photo_check_choices enable row level security;

-- Players may read their own choice; all writes go through the API.
drop policy if exists ai_photo_check_choices_select_own on public.ai_photo_check_choices;
create policy ai_photo_check_choices_select_own on public.ai_photo_check_choices
  for select to authenticated
  using ((select auth.uid()) = auth_id);

-- R5: only the verdict is kept: {verdict, confidence, model, notice_version, checked_at}.
-- Deleted with the photo (find_photos rows go with account deletion, migration 071).
alter table public.find_photos add column if not exists landmark_check jsonb;

comment on column public.find_photos.landmark_check is
  'AI landmark check result: {verdict: match|no_match|unsure|error, confidence, model, notice_version, checked_at}. Null = not checked.';

-- New stops default to 25 m (lib/play/arrival-check.ts DEFAULT_STOP_RADIUS_M);
-- existing stops keep the radius their creator chose.
alter table public.locations alter column radius_meters set default 25;
