-- Push tokens for the Android (Firebase Cloud Messaging) and iOS (APNs) apps.
-- The website keeps using push_subscriptions (Web Push); dispatch-push sends to both.

create table public.device_tokens (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique check (char_length(token) between 10 and 4096),
  platform   text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

create policy "device tokens self read" on public.device_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "device tokens self delete" on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());

revoke insert, update on public.device_tokens from anon, authenticated;

-- Save this phone's token for the current user. If someone else signed in on
-- this phone before, the token moves to the new account.
create function public.save_device_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You need to be signed in'; end if;
  if p_platform not in ('android', 'ios') then raise exception 'Unknown platform'; end if;
  insert into public.device_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke execute on function public.save_device_token(text, text) from public, anon;
grant execute on function public.save_device_token(text, text) to authenticated;
