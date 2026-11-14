-- Pilot instrumentation (2026-11-14): what the app needs so its data can be
-- joined to the Qualtrics surveys (T0, T1, MID, T2) that are the study's
-- source of record.

-- 1. A stable, random Study ID per enrollment. Exports used P0001-style list
-- positions, which shift whenever someone withdraws or a new account sorts
-- earlier, so they could not be joined to Qualtrics responses. The code is
-- never derived from the user id, email or enrollment order.
create or replace function private.new_participant_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- No 0/O, 1/I/L: participants type this into Qualtrics if a link drops it.
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea := uuid_send(gen_random_uuid());
  code text := 'FM-';
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;

revoke all on function private.new_participant_code() from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.new_participant_code() to service_role;

-- A volatile default is evaluated per row, so existing enrollments each get
-- their own code when the column is added.
alter table public.study_enrollments
  add column if not exists participant_code text not null default private.new_participant_code();

alter table public.study_enrollments
  drop constraint if exists study_enrollments_participant_code_key;
alter table public.study_enrollments
  add constraint study_enrollments_participant_code_key unique (study_id, participant_code);

-- 2. Which survey subsets this participant is in. Balanced within the
-- condition cell (cell_key) at enrollment: in each consecutive pair of
-- enrollees in a cell, one is in and one is out (lib/research/survey-halves.ts).
alter table public.study_enrollments add column if not exists cell_key text;
alter table public.study_enrollments add column if not exists mid_survey boolean;
alter table public.study_enrollments add column if not exists peou_block boolean;

create index if not exists idx_study_enrollments_cell
  on public.study_enrollments (study_id, cell_key, enrolled_at);

comment on column public.study_enrollments.participant_code is
  'Random Study ID (FM-XXXXXX) shown to the participant and passed to Qualtrics as sid. Never reused.';
comment on column public.study_enrollments.cell_key is
  'Assigned condition cell (dimension=level pairs, sorted) used to balance mid_survey / peou_block.';
comment on column public.study_enrollments.mid_survey is
  'In the half that gets the Qualtrics week-2 check-in (MID).';
comment on column public.study_enrollments.peou_block is
  'In the half whose Qualtrics T2 link carries peou=1 (PEOU pilot block).';

-- 3. Qualtrics launches: when a participant opened a survey link from the app
-- and when they said they had finished it. Completion itself is recorded in
-- Qualtrics; this is what the app saw, for reconciliation and response-rate
-- follow-up. Written by the API (service role) only.
create table if not exists public.qualtrics_launches (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.treatment_studies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  wave text not null check (wave in ('T0', 'T1', 'MID', 'T2')),
  action text not null check (action in ('launched', 'marked_done')),
  platform text,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_qualtrics_launches_user
  on public.qualtrics_launches (user_id, wave, created_at);

alter table public.qualtrics_launches enable row level security;

-- Participants may read their own rows (the app shows which surveys are done);
-- researchers read everything through the export, which uses the service role.
drop policy if exists qualtrics_launches_select_own on public.qualtrics_launches;
create policy qualtrics_launches_select_own on public.qualtrics_launches
  for select to authenticated
  using (user_id = (select private.user_id()));

comment on table public.qualtrics_launches is
  'Qualtrics survey links opened / marked finished from the app. Completion of record is in Qualtrics.';
