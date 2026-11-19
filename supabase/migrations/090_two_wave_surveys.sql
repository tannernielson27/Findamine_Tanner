-- Two-wave survey plan (2026-11-19).
--
-- The two-week study uses two Qualtrics surveys, START and END, in place of
-- the pilot's T0 / T1 / MID / T2 (src/lib/research/qualtrics.ts). The launch
-- log (082) only accepted the four pilot wave names, so a tap on "Open
-- survey" or "I finished" for START or END would be rejected.
--
-- This widens that check and changes nothing else: no row is rewritten.
-- Apply BEFORE setting QUALTRICS_TWO_WAVE_FROM in the app's environment.
-- Old code never writes the new names, so applying this first is safe.
-- Safe to run more than once.

do $$
declare
  c record;
begin
  -- Drop whatever check currently limits `wave` (082 left it with a generated
  -- name), then add it back under a fixed name with the two new waves.
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.qualtrics_launches'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%wave%'
  loop
    execute format('alter table public.qualtrics_launches drop constraint %I', c.conname);
  end loop;

  alter table public.qualtrics_launches
    add constraint qualtrics_launches_wave_check
    check (wave in ('T0', 'T1', 'MID', 'T2', 'START', 'END'));
end $$;
