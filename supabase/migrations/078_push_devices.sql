-- 078: push-notification device tokens for the iOS app.
--
-- The Capacitor wrapper registers for APNs only after the player turns
-- notifications on in Settings (primer first, never on first launch) and posts
-- the device token to POST /api/v1/notifications/devices, which writes here
-- with the service role. DELETE on the same route removes it when they turn
-- notifications off. Nothing sends pushes yet (that needs an APNs key and a
-- sender); this only stores who asked for them.
--
-- Access: an owner may read their own rows (and admins all rows) through RLS.
-- End users get no INSERT/UPDATE/DELETE grant or policy, following 076: every
-- write goes through the API on the service role.
--
-- Account deletion: 071's delete_user_account keeps the public.users row as a
-- "Deleted user" placeholder, so ON DELETE CASCADE alone would never fire. A
-- trigger below removes a user's devices when their row is scrubbed
-- (deleted_at set) or deactivated (status leaves 'active'/'pending_consent'),
-- so a deleted or banned account can't keep receiving pushes. 071 is not
-- edited.

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- APNs device token (lowercase hex) or, for a future Android build, an FCM token.
  token text not null,
  platform text not null default 'ios',
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_devices_token_unique unique (token),
  constraint push_devices_platform_check check (platform in ('ios', 'android')),
  constraint push_devices_token_length check (char_length(token) between 32 and 4096),
  constraint push_devices_app_version_length check (app_version is null or char_length(app_version) <= 40)
);

create index if not exists idx_push_devices_user on public.push_devices(user_id);

alter table public.push_devices enable row level security;

revoke all on table public.push_devices from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.push_devices from authenticated;
grant select on table public.push_devices to authenticated;
grant all on table public.push_devices to service_role;

drop policy if exists "push_devices_select_own" on public.push_devices;
create policy "push_devices_select_own" on public.push_devices
  for select using (user_id = private.user_id() or private.user_role() = 'admin');

-- ── Remove devices when an account is deleted or loses access ───────────

create or replace function private.push_devices_forget_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.deleted_at is not null and old.deleted_at is null)
     or (new.status is distinct from old.status
         and new.status not in ('active', 'pending_consent')) then
    delete from public.push_devices where user_id = new.id;
  end if;
  return new;
end;
$$;

-- Same grants as 076's guard trigger function: it only runs as a trigger
-- (a "returns trigger" function can't be called directly).
revoke all on function private.push_devices_forget_user() from public;
grant execute on function private.push_devices_forget_user() to anon, authenticated, service_role;

drop trigger if exists push_devices_forget_user on public.users;
create trigger push_devices_forget_user
  after update of deleted_at, status on public.users
  for each row execute function private.push_devices_forget_user();
