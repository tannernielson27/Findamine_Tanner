-- Difficulty lock (2026-11-19, issue #15).
--
-- A hunt's difficulty is how much navigation help its players get
-- (src/lib/play/navigation-help.ts):
--   hunts.metadata.navigation_help   'easy' | 'medium' | 'hard'; absent or
--                                    anything else means easy
--
-- It may change only while the hunt is an unplayed draft: the same lock as
-- clue delivery (migration 083). The API rejects a change with a 409
-- (src/app/api/v1/hunts/navigation-help-guard.ts). This trigger is the
-- backstop for writes that skip the API, and it closes the gap between the
-- API's check and its write (a first play or a publish landing in between).
-- Same opt-out for operator SQL as migration 083:
--     set local findamine.allow_locked_edits = 'on';
--
-- Needs 083 (private.locked_edits_allowed, private.hunt_is_locked). Adds no
-- column and rewrites nothing. Safe to apply before or after the code that
-- reads the setting, and safe to run more than once.

-- Mirrors readNavigationHelp(): only the strings 'medium' and 'hard' are
-- levels other than easy.
create or replace function private.effective_navigation_help(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(meta->'navigation_help') = 'string'
     and meta->>'navigation_help' in ('medium', 'hard')
      then meta->>'navigation_help'
    else 'easy'
  end;
$$;

create or replace function private.guard_hunt_navigation_help()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.locked_edits_allowed() then
    return new;
  end if;

  if private.effective_navigation_help(coalesce(old.metadata, '{}'::jsonb))
       is distinct from private.effective_navigation_help(coalesce(new.metadata, '{}'::jsonb))
     -- Checked against the row as it was: publishing and the edit can't be combined to dodge it.
     and (old.status <> 'draft' or new.status <> 'draft' or private.hunt_is_locked(old.id)) then
    raise exception 'Difficulty is locked because this hunt has been published or played.'
      using errcode = 'check_violation',
            hint = 'Clone the hunt to use a different difficulty.';
  end if;
  return new;
end;
$$;

drop trigger if exists hunts_navigation_help_lock on public.hunts;
create trigger hunts_navigation_help_lock
  before update of metadata on public.hunts
  for each row
  execute function private.guard_hunt_navigation_help();

revoke all on function private.effective_navigation_help(jsonb) from public, anon, authenticated;
revoke all on function private.guard_hunt_navigation_help() from public, anon, authenticated;
