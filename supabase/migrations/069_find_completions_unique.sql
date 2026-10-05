-- 069: one find_completions row per (play_session_id, find_id).
--
-- The table had no unique constraint on that pair, so two in-flight requests
-- for the same stop (for example two GPS fixes inside the arrival radius)
-- could each insert a row. Every later `.maybeSingle()` lookup then failed and
-- the stop could never be answered.
--
-- This migration:
--   1. picks one row to keep per pair (completed first, then arrived, then oldest),
--   2. folds the hint counters of the duplicates into the kept row,
--   3. re-points child rows (photos, feedback, technique reviews) to the kept row,
--   4. deletes the duplicates,
--   5. adds the unique constraint.
--
-- The play API (src/app/api/v1/play/_lib/completions.ts) treats a violation of
-- this constraint as "row already exists", so it is safe to apply while
-- players are mid-hunt.

begin;

-- Block concurrent writes between the de-duplication and the constraint.
lock table public.find_completions in share row exclusive mode;

create temporary table _fc_dupes on commit drop as
select
  id,
  first_value(id) over (
    partition by play_session_id, find_id
    order by
      (completed_at is not null) desc,
      (arrived_at is not null) desc,
      created_at asc,
      id asc
  ) as keep_id
from public.find_completions;

delete from _fc_dupes where id = keep_id;

-- Keep the highest hint counts and the earliest arrival seen on any duplicate.
update public.find_completions k
set
  hints_used = greatest(coalesce(k.hints_used, 0), d.max_hints),
  clue_hints_used = greatest(coalesce(k.clue_hints_used, 0), d.max_clue_hints),
  arrived_at = coalesce(k.arrived_at, d.first_arrived_at)
from (
  select
    x.keep_id,
    max(coalesce(fc.hints_used, 0)) as max_hints,
    max(coalesce(fc.clue_hints_used, 0)) as max_clue_hints,
    min(fc.arrived_at) as first_arrived_at
  from _fc_dupes x
  join public.find_completions fc on fc.id = x.id
  group by x.keep_id
) d
where k.id = d.keep_id;

update public.find_photos p
set completion_id = x.keep_id
from _fc_dupes x
where p.completion_id = x.id;

update public.answer_feedback a
set completion_id = x.keep_id
from _fc_dupes x
where a.completion_id = x.id;

update public.technique_reviews t
set find_completion_id = x.keep_id
from _fc_dupes x
where t.find_completion_id = x.id;

delete from public.find_completions fc
using _fc_dupes x
where fc.id = x.id;

alter table public.find_completions
  add constraint find_completions_session_find_key unique (play_session_id, find_id);

-- Superseded by the unique constraint's index on the same columns (039).
drop index if exists public.idx_fc_session_find;

commit;
