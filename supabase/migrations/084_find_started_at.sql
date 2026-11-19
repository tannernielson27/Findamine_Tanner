-- Per-stop start time (2026-11-18, issue #16).
--
-- A stop's details (clue, map, distance, hot/cold, place name) are released
-- only once the player starts that stop, and the start is timed on the server:
--   find_completions.started_at   set once by POST /api/v1/play/[huntId]/start-stop
--                                 ("I'm ready"), never overwritten
-- The play API treats a stop with no completion row as not started and sends
-- none of its details (src/app/api/v1/play/_lib/stop-start.ts).
--
-- Apply this BEFORE deploying the code that reads the column: the play routes
-- select started_at and fail without it. The old code ignores the column, so
-- applying it first is safe while players are mid-hunt.
--
-- Backfill: before this change a completion row was only ever created by the
-- "I'm ready" tap on a primer, a clue hint, or an arrival, all of which mean
-- the player had already seen the stop. Every existing row therefore counts as
-- started, at its arrival if it has one and otherwise when it was created.
-- Rows the old code writes between this migration and the deploy have no
-- started_at; the API reads those the same way (stopStartedAt), and running
-- this file again after the deploy fills them in.
--
-- Safe to run more than once: the column is added only if missing and the
-- backfill only touches rows that have no start time yet.

alter table public.find_completions
  add column if not exists started_at timestamptz;

update public.find_completions
   set started_at = coalesce(arrived_at, created_at)
 where started_at is null;

comment on column public.find_completions.started_at is
  'When the player started this stop ("I''m ready"): the moment its details were released. Set once by the play API, never overwritten.';
