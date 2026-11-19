-- Scoring version 2 (2026-11-18, issue #11).
--
-- Hunts now carry a scoring version in their metadata
-- (src/lib/hunts/scoring-version.ts):
--   hunts.metadata.scoring_version            1 | 2; absent means 1
--   hunts.metadata.scoring_solve_window_min   version 2, optional: minutes until
--                                             solve-time points reach zero
-- Version 1 scores a stop out of 100, version 2 out of 1000. Every hunt that
-- exists when this is applied has no scoring_version, so it stays on version 1
-- and nothing stored is rewritten: no score, total or ledger row is touched
-- here.
--
-- 1. play_sessions.total_solve_ms: total time from each stop's start to its
--    completion, written by the answer route. It is the leaderboard tiebreak
--    (higher score, then lower solve time, then earlier finish). Sessions
--    finished before this have none and sort after those that do.
--
-- 2. Scoring is locked once a hunt has a play session, so one hunt's board
--    never mixes two scales. The API rejects the change with a 409
--    (src/app/api/v1/hunts/delivery-guard.ts); this trigger is the backstop for
--    writes that skip the API. Same opt-out for operator SQL as migration 083:
--        set local findamine.allow_locked_edits = 'on';
--
-- 3. Functions that add up or compare scores from more than one hunt now count
--    every stop out of 100 whichever version its hunt is on: a version 2 score
--    is divided by 10 (public.comparable_score). Without this a version 2 hunt
--    would count ten times as much as a version 1 hunt. Their names, arguments
--    and result columns are unchanged, so the code deployed before this keeps
--    working. overall_leaderboard() also gets the tiebreak order.
--    get_session_leaderboard() is new: the weekly, monthly and subject boards,
--    ranked on the common scale.
--    get_hunt_analytics() and get_stop_analytics() report on a single hunt, in
--    that hunt's own scale, and are left alone.
--
-- Needs 083 (private.locked_edits_allowed) and 084 (find_completions.started_at).
-- Apply BEFORE deploying the code that reads total_solve_ms: the hunt
-- leaderboard selects it. The old code ignores the column and calls the same
-- functions, so applying this first is safe while people are mid-hunt.
--
-- Safe to run more than once.

-- ── 1. Tiebreak column ─────────────────────────────────────────
alter table public.play_sessions
  add column if not exists total_solve_ms bigint;

comment on column public.play_sessions.total_solve_ms is
  'Total solve time across the session''s finished stops, in ms (each stop''s start to its completion). Leaderboard tiebreak: lower is better. Null for sessions from before migration 085.';

-- ── 2. Version helpers ─────────────────────────────────────────
-- Mirrors readScoringVersion(): only the JSON number 2 means version 2.
create or replace function public.scoring_version(p_hunt_metadata jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_hunt_metadata->'scoring_version' = '2'::jsonb then 2 else 1 end;
$$;

-- A score on the common scale: a stop out of 100 on either version.
-- Mirrors toComparablePoints() / comparableTotal(); callers round.
create or replace function public.comparable_score(p_score numeric, p_hunt_metadata jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when public.scoring_version(p_hunt_metadata) = 2 then p_score / 10.0 else p_score end;
$$;

comment on function public.scoring_version(jsonb) is
  'The scoring version of a hunt from its metadata: 2 only when scoring_version is the number 2, otherwise 1.';
comment on function public.comparable_score(numeric, jsonb) is
  'A score put on the common 0-100-per-stop scale: version 2 scores (out of 1000 per stop) are divided by 10.';

-- Mirrors readSolveWindowMinutes(): a whole number of minutes from 5 to 1440.
create or replace function private.effective_solve_window_min(meta jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(meta->'scoring_solve_window_min') = 'number' then
      case
        when (meta->>'scoring_solve_window_min')::numeric = trunc((meta->>'scoring_solve_window_min')::numeric)
         and (meta->>'scoring_solve_window_min')::numeric between 5 and 1440
        then (meta->>'scoring_solve_window_min')::numeric::integer
      end
  end;
$$;

-- ── 3. Scoring lock ────────────────────────────────────────────
create or replace function private.guard_hunt_scoring_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.locked_edits_allowed() then
    return new;
  end if;

  if (public.scoring_version(coalesce(old.metadata, '{}'::jsonb))
        is distinct from public.scoring_version(coalesce(new.metadata, '{}'::jsonb))
      or private.effective_solve_window_min(coalesce(old.metadata, '{}'::jsonb))
        is distinct from private.effective_solve_window_min(coalesce(new.metadata, '{}'::jsonb)))
     and exists (select 1 from public.play_sessions ps where ps.hunt_id = old.id) then
    raise exception 'Scoring is locked because this hunt has been played.'
      using errcode = 'check_violation',
            hint = 'Clone the hunt to use different scoring.';
  end if;
  return new;
end;
$$;

drop trigger if exists hunts_scoring_lock on public.hunts;
create trigger hunts_scoring_lock
  before update of metadata on public.hunts
  for each row
  execute function private.guard_hunt_scoring_settings();

revoke all on function private.effective_solve_window_min(jsonb) from public, anon, authenticated;
revoke all on function private.guard_hunt_scoring_settings() from public, anon, authenticated;

-- ── 4. Overall leaderboard: common scale and tiebreak ──────────
-- As migration 010, except: each session's total is put on the common scale
-- before summing, and equal totals are ordered by total solve time (only when
-- every one of the player's sessions has one), then by when the player last
-- finished a hunt.
create or replace function public.overall_leaderboard(p_limit int default 25)
returns table (
  user_id uuid,
  total_score bigint,
  hunts_completed bigint,
  display_name text,
  avatar_url text,
  role text,
  best_codename text
)
language sql
stable
set search_path = public
as $$
  select
    ps.user_id,
    round(sum(public.comparable_score(coalesce(ps.total_score, 0), h.metadata)))::bigint as total_score,
    count(*)::bigint as hunts_completed,
    u.display_name,
    u.avatar_url,
    u.role,
    -- Pick the most recently used codename for display
    (select ps2.codename
     from public.play_sessions ps2
     where ps2.user_id = ps.user_id
       and ps2.codename is not null
       and ps2.status = 'completed'
     order by ps2.completed_at desc nulls last
     limit 1
    ) as best_codename
  from public.play_sessions ps
  join public.users u on u.id = ps.user_id
  left join public.hunts h on h.id = ps.hunt_id
  where ps.status = 'completed'
    and u.deleted_at is null
  group by ps.user_id, u.display_name, u.avatar_url, u.role
  order by
    total_score desc,
    case when count(ps.total_solve_ms) = count(*) then sum(ps.total_solve_ms) end asc nulls last,
    max(ps.completed_at) asc nulls last,
    ps.user_id
  limit p_limit;
$$;

-- ── 5. Other cross-hunt aggregates: common scale ───────────────
-- Each is its migration 039 definition with the score put on the common scale.

create or replace function public.get_user_improvements(p_limit int default 25)
returns table(
  user_id uuid,
  display_name text,
  first_score int,
  latest_score int,
  improvement int
) language sql stable set search_path = public as $$
  with user_scores as (
    select
      ps.user_id,
      first_value(sc.score) over (partition by ps.user_id order by ps.completed_at asc) as first_score,
      first_value(sc.score) over (partition by ps.user_id order by ps.completed_at desc) as latest_score
    from public.play_sessions ps
    left join public.hunts h on h.id = ps.hunt_id
    cross join lateral (
      select round(public.comparable_score(ps.total_score, h.metadata))::int as score
    ) sc
    where ps.status = 'completed' and ps.total_score is not null
  ),
  improvements as (
    select distinct on (us.user_id)
      us.user_id,
      us.first_score,
      us.latest_score,
      (us.latest_score - us.first_score) as improvement
    from user_scores us
    where us.latest_score > us.first_score
    order by us.user_id, improvement desc
  )
  select
    i.user_id,
    u.display_name,
    i.first_score,
    i.latest_score,
    i.improvement
  from improvements i
  join public.users u on u.id = i.user_id
  order by i.improvement desc
  limit p_limit;
$$;

create or replace function public.get_speed_run_leaderboard(p_limit int default 25)
returns table(
  user_id uuid,
  display_name text,
  hunt_title text,
  duration_min numeric,
  score int
) language sql stable set search_path = public as $$
  select
    ps.user_id,
    u.display_name,
    h.title as hunt_title,
    round(extract(epoch from (ps.completed_at - ps.started_at)) / 60.0, 1) as duration_min,
    round(public.comparable_score(ps.total_score, h.metadata))::int as score
  from public.play_sessions ps
  join public.users u on u.id = ps.user_id
  join public.hunts h on h.id = ps.hunt_id
  where ps.status = 'completed'
    and public.comparable_score(ps.total_score, h.metadata) >= 60
    and ps.started_at is not null
    and ps.completed_at is not null
  order by duration_min asc
  limit p_limit;
$$;

create or replace function public.get_hunt_insights(p_limit int default 10)
returns table(
  hunt_id uuid,
  title text,
  target_audience text,
  plays bigint,
  avg_score numeric,
  avg_duration_min numeric
) language sql stable set search_path = public as $$
  select
    h.id as hunt_id,
    h.title,
    h.target_audience,
    count(ps.id) as plays,
    round(avg(public.comparable_score(ps.total_score, h.metadata)), 0) as avg_score,
    round(avg(extract(epoch from (ps.completed_at - ps.started_at)) / 60.0), 0) as avg_duration_min
  from public.hunts h
  join public.play_sessions ps on ps.hunt_id = h.id
  where ps.status = 'completed'
    and h.is_public = true
    and h.deleted_at is null
  group by h.id, h.title, h.target_audience
  having count(ps.id) >= 3
  order by avg_score desc
  limit p_limit;
$$;

create or replace function public.get_roster_avg_scores(p_roster_id uuid)
returns table(
  user_id uuid,
  avg_score numeric,
  hunts_completed bigint
) language sql stable set search_path = public as $$
  select
    re.student_id as user_id,
    coalesce(round(avg(public.comparable_score(ps.total_score, h.metadata)), 0), 0) as avg_score,
    count(ps.id) as hunts_completed
  from public.roster_entries re
  left join public.play_sessions ps on ps.user_id = re.student_id and ps.status = 'completed'
  left join public.hunts h on h.id = ps.hunt_id
  where re.roster_id = p_roster_id
  group by re.student_id;
$$;

create or replace function public.get_challenge_type_effectiveness()
returns table(
  challenge_type text,
  avg_score numeric,
  sample_size bigint
) language sql stable set search_path = public as $$
  select
    t.challenge_type,
    round(avg(public.comparable_score(fc.score, h.metadata)), 0) as avg_score,
    count(fc.id) as sample_size
  from public.find_completions fc
  join public.finds f on f.id = fc.find_id
  join public.tasks t on t.id = f.task_id
  left join public.hunts h on h.id = f.hunt_id
  where fc.score is not null and fc.completed_at is not null
  group by t.challenge_type
  having count(fc.id) >= 5
  order by avg_score desc;
$$;

create or replace function public.get_user_stats(p_user_id uuid)
returns table(
  hunts_completed bigint,
  total_score bigint,
  badges_earned bigint,
  current_streak int
) language sql stable set search_path = public as $$
  select
    (select count(*) from public.play_sessions where user_id = p_user_id and status = 'completed'),
    (select coalesce(round(sum(public.comparable_score(ps.total_score, h.metadata))), 0)::bigint
       from public.play_sessions ps
       left join public.hunts h on h.id = ps.hunt_id
      where ps.user_id = p_user_id and ps.status = 'completed'),
    (select count(*) from public.user_badges where user_id = p_user_id),
    (select coalesce(current_streak, 0) from public.streaks where user_id = p_user_id limit 1);
$$;

create or replace function public.get_audience_insights()
returns table(
  target_audience text,
  total_plays bigint,
  avg_score numeric
) language sql stable set search_path = public as $$
  select
    h.target_audience,
    count(ps.id) as total_plays,
    round(avg(public.comparable_score(ps.total_score, h.metadata)), 0) as avg_score
  from public.play_sessions ps
  join public.hunts h on h.id = ps.hunt_id
  where ps.status = 'completed'
  group by h.target_audience
  having count(ps.id) >= 3;
$$;

-- ── 6. Session boards (weekly, monthly, by subject): common scale ──
-- GET /api/v1/leaderboard/types ranked these by the raw session total in the
-- route. The ranking has to happen here, on the common scale and before the
-- limit, or a version 2 session would outrank every version 1 session. One row
-- per completed session, as before. Called with the service role only.
create or replace function public.get_session_leaderboard(
  p_since timestamptz default null,
  p_subject text default null,
  p_limit int default 25
)
returns table(
  user_id uuid,
  total_score int,
  display_name text
) language sql stable set search_path = public as $$
  select
    ps.user_id,
    round(public.comparable_score(coalesce(ps.total_score, 0), h.metadata))::int as total_score,
    u.display_name
  from public.play_sessions ps
  left join public.users u on u.id = ps.user_id
  left join public.hunts h on h.id = ps.hunt_id
  where ps.status = 'completed'
    and (p_since is null or ps.completed_at >= p_since)
    and (p_subject is null or h.subject_domains @> array[p_subject])
  order by total_score desc, ps.completed_at asc nulls last, ps.id
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.get_session_leaderboard(timestamptz, text, int) from public, anon, authenticated;
grant execute on function public.get_session_leaderboard(timestamptz, text, int) to service_role;

comment on function public.get_session_leaderboard(timestamptz, text, int) is
  'Completed play sessions ranked by total on the common 0-100-per-stop scale, optionally since a time and for one subject. Service role only.';
