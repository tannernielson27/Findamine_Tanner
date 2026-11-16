-- Clue delivery lock (2026-11-16).
--
-- Hunts choose how clues are handed out in hunts.metadata:
--   clue_delivery  'all_at_once' | 'fixed_order' | 'assigned_order' | 'random_order'
--   clue_orders    for assigned_order: a JSON array of orders, each an array
--                  of find ids listing every stop once
-- Older hunts only have shuffle_stops = true, which means random_order
-- (src/lib/play/clue-delivery.ts).
--
-- The setting must be fixed before a hunt begins. A hunt has begun once it
-- is not a draft or anyone has a play session on it (a hunt can be
-- unpublished after play). The API already rejects such edits with a clear
-- message (src/lib/hunts/delivery-lock.ts); this trigger is the backstop for
-- writes that skip the API, such as a creator's own JWT against PostgREST
-- under the hunts_update_own policy.
--
-- No schema change: the play session's assigned order group is kept in
-- play_sessions.metadata (clue_delivery, clue_order_index).

create or replace function private.effective_clue_delivery(meta jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    coalesce(
      case
        when meta->>'clue_delivery' in ('all_at_once', 'fixed_order', 'assigned_order', 'random_order')
          then meta->>'clue_delivery'
      end,
      case when meta->'shuffle_stops' = 'true'::jsonb then 'random_order' else 'fixed_order' end
    ),
    case
      when meta->>'clue_delivery' = 'assigned_order' then coalesce(meta->'clue_orders', '[]'::jsonb)
      else '[]'::jsonb
    end
  );
$$;

create or replace function private.guard_clue_delivery_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.effective_clue_delivery(coalesce(old.metadata, '{}'::jsonb))
       is not distinct from private.effective_clue_delivery(coalesce(new.metadata, '{}'::jsonb)) then
    return new;
  end if;

  if old.status <> 'draft'
     or new.status <> 'draft'
     or exists (select 1 from public.play_sessions ps where ps.hunt_id = old.id) then
    raise exception 'Clue delivery is locked because this hunt has been published or played.'
      using errcode = 'check_violation',
            hint = 'Clone the hunt to use a different clue delivery setting.';
  end if;

  return new;
end;
$$;

revoke all on function private.effective_clue_delivery(jsonb) from public, anon, authenticated;
revoke all on function private.guard_clue_delivery_lock() from public, anon, authenticated;

drop trigger if exists hunts_clue_delivery_lock on public.hunts;
create trigger hunts_clue_delivery_lock
  before update of metadata on public.hunts
  for each row
  execute function private.guard_clue_delivery_lock();
