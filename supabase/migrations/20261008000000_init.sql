-- Pickup: initial schema
-- Games are hosted at a venue (lat/lng). Players near a venue get pinged,
-- RSVP (with an automatic waitlist), check in on-site, and chat per game.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Public player profile (visible to other signed-in users).
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  sports       text[] not null default '{}',   -- empty = interested in every sport
  skill_level  text not null default 'any'
               check (skill_level in ('any', 'beginner', 'intermediate', 'advanced')),
  created_at   timestamptz not null default now()
);

-- Private per-user settings (home location is never exposed to other users).
create table public.user_settings (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  home_lat              double precision check (home_lat between -90 and 90),
  home_lng              double precision check (home_lng between -180 and 180),
  home_location         extensions.geography(point, 4326) generated always as (
                          case when home_lat is not null and home_lng is not null then
                            extensions.st_setsrid(extensions.st_makepoint(home_lng, home_lat), 4326)::extensions.geography
                          end
                        ) stored,
  notify_radius_miles   int not null default 10 check (notify_radius_miles between 1 and 50),
  notifications_enabled boolean not null default true
);
create index user_settings_home_location_idx on public.user_settings using gist (home_location);

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid not null references public.profiles (id) on delete cascade,
  sport             text not null check (char_length(sport) between 1 and 30),
  title             text not null check (char_length(title) between 1 and 80),
  description       text check (char_length(description) <= 1000),
  venue_name        text not null check (char_length(venue_name) between 1 and 120),
  venue_address     text check (char_length(venue_address) <= 240),
  lat               double precision not null check (lat between -90 and 90),
  lng               double precision not null check (lng between -180 and 180),
  location          extensions.geography(point, 4326) generated always as (
                      extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
                    ) stored,
  starts_at         timestamptz not null,
  duration_minutes  int not null default 90 check (duration_minutes between 15 and 600),
  min_players       int not null default 2 check (min_players >= 2),
  max_players       int not null check (max_players between 2 and 100),
  skill_level       text not null default 'any'
                    check (skill_level in ('any', 'beginner', 'intermediate', 'advanced')),
  ping_radius_miles int not null default 10 check (ping_radius_miles between 1 and 50),
  status            text not null default 'open' check (status in ('open', 'cancelled')),
  created_at        timestamptz not null default now(),
  check (max_players >= min_players)
);
create index games_location_idx on public.games using gist (location);
create index games_starts_at_idx on public.games (starts_at);

create table public.rsvps (
  game_id       uuid not null references public.games (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        text not null check (status in ('going', 'maybe', 'waitlist', 'declined')),
  checked_in_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),  -- also orders the waitlist
  primary key (game_id, user_id)
);
create index rsvps_user_idx on public.rsvps (user_id);

create table public.messages (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_game_idx on public.messages (game_id, created_at);

create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- In-app inbox. Rows with pushed_at = null are delivered as Web Push by the
-- dispatch-push edge function.
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    uuid references public.games (id) on delete cascade,
  kind       text not null,  -- new_game | rsvp | promoted | cancelled | updated
  title      text not null,
  body       text not null default '',
  read_at    timestamptz,
  pushed_at  timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_pending_idx on public.notifications (id) where pushed_at is null;

-- ---------------------------------------------------------------------------
-- New users get a profile + settings row automatically
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    ), 40)
  );
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------

create view public.game_details
with (security_invoker = true)
as
select
  g.id, g.host_id, p.display_name as host_name,
  g.sport, g.title, g.description, g.venue_name, g.venue_address, g.lat, g.lng,
  g.starts_at, g.duration_minutes, g.min_players, g.max_players, g.skill_level,
  g.ping_radius_miles, g.status, g.created_at,
  (select count(*) from public.rsvps r where r.game_id = g.id and r.status = 'going')::int    as going_count,
  (select count(*) from public.rsvps r where r.game_id = g.id and r.status = 'waitlist')::int as waitlist_count
from public.games g
join public.profiles p on p.id = g.host_id;

-- Open, not-yet-finished games within p_radius_miles of a point.
create function public.nearby_games(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision default 10,
  p_sport text default null
)
returns setof public.game_details
language sql
stable
set search_path = public, extensions
as $$
  select gd.*
  from public.game_details gd
  join public.games g on g.id = gd.id
  where g.status = 'open'
    and g.starts_at + make_interval(mins => g.duration_minutes) > now()
    and (p_sport is null or g.sport = p_sport)
    and st_dwithin(
          g.location,
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
          least(greatest(p_radius_miles, 0.1), 100) * 1609.344
        )
  order by g.starts_at
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_participant(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.games where id = p_game_id and host_id = auth.uid())
      or exists (select 1 from public.rsvps
                 where game_id = p_game_id and user_id = auth.uid()
                   and status in ('going', 'maybe', 'waitlist'));
$$;

-- Move waitlisted players into open spots (oldest first) and notify them.
create function public.promote_waitlist(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_open  int;
  v_user  uuid;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found or v_game.status <> 'open' then return; end if;

  select v_game.max_players - count(*) into v_open
  from public.rsvps where game_id = p_game_id and status = 'going';

  for v_user in
    select user_id from public.rsvps
    where game_id = p_game_id and status = 'waitlist'
    order by updated_at, created_at
    limit greatest(v_open, 0)
  loop
    update public.rsvps set status = 'going', updated_at = now()
    where game_id = p_game_id and user_id = v_user;

    insert into public.notifications (user_id, game_id, kind, title, body)
    values (v_user, p_game_id, 'promoted', 'You''re in! A spot opened up',
            v_game.title || ' · ' || v_game.venue_name);
  end loop;
end;
$$;

-- Notify everyone with an active RSVP (except the actor).
create function public.notify_participants(p_game_id uuid, p_kind text, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, game_id, kind, title, body)
  select r.user_id, p_game_id, p_kind, p_title, p_body
  from public.rsvps r
  where r.game_id = p_game_id
    and r.status in ('going', 'maybe', 'waitlist')
    and r.user_id is distinct from auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Actions (called from the app via supabase.rpc)
-- ---------------------------------------------------------------------------

create function public.create_game(
  p_sport text,
  p_title text,
  p_description text,
  p_venue_name text,
  p_venue_address text,
  p_lat double precision,
  p_lng double precision,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_min_players int,
  p_max_players int,
  p_skill_level text,
  p_ping_radius_miles int
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_loc geography;
begin
  if v_uid is null then raise exception 'You need to be signed in'; end if;
  if p_starts_at < now() - interval '5 minutes' then
    raise exception 'The start time must be in the future';
  end if;
  if p_starts_at > now() + interval '90 days' then
    raise exception 'Games can be scheduled at most 90 days ahead';
  end if;
  if (select count(*) from public.games
      where host_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can host at most 10 games per day';
  end if;

  insert into public.games (
    host_id, sport, title, description, venue_name, venue_address, lat, lng,
    starts_at, duration_minutes, min_players, max_players, skill_level, ping_radius_miles
  ) values (
    v_uid, p_sport, trim(p_title), nullif(trim(p_description), ''), trim(p_venue_name),
    nullif(trim(p_venue_address), ''), p_lat, p_lng, p_starts_at, p_duration_minutes,
    p_min_players, p_max_players, coalesce(p_skill_level, 'any'), p_ping_radius_miles
  )
  returning id, location into v_id, v_loc;

  insert into public.rsvps (game_id, user_id, status) values (v_id, v_uid, 'going');

  -- Ping nearby players who play this sport, within both the game's radius
  -- and the player's own preferred radius.
  insert into public.notifications (user_id, game_id, kind, title, body)
  select s.user_id, v_id, 'new_game',
         'New ' || p_sport || ' game nearby',
         trim(p_title) || ' · ' || trim(p_venue_name) || ' · '
           || round((st_distance(s.home_location, v_loc) / 1609.344)::numeric, 1) || ' mi away'
  from public.user_settings s
  join public.profiles p on p.id = s.user_id
  where s.user_id <> v_uid
    and s.notifications_enabled
    and (cardinality(p.sports) = 0 or p_sport = any (p.sports))
    and st_dwithin(s.home_location, v_loc, p_ping_radius_miles * 1609.344)
    and st_dwithin(s.home_location, v_loc, least(p_ping_radius_miles, s.notify_radius_miles) * 1609.344);

  return v_id;
end;
$$;

create function public.update_game(
  p_game_id uuid,
  p_title text,
  p_description text,
  p_venue_name text,
  p_venue_address text,
  p_lat double precision,
  p_lng double precision,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_min_players int,
  p_max_players int,
  p_skill_level text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.host_id is distinct from auth.uid() then raise exception 'Only the host can edit this game'; end if;
  if v_game.status <> 'open' then raise exception 'This game was cancelled'; end if;
  if p_max_players < (select count(*) from public.rsvps where game_id = p_game_id and status = 'going') then
    raise exception 'More players are already going than that — raise the limit or ask people to drop out';
  end if;

  update public.games set
    title = trim(p_title),
    description = nullif(trim(p_description), ''),
    venue_name = trim(p_venue_name),
    venue_address = nullif(trim(p_venue_address), ''),
    lat = p_lat,
    lng = p_lng,
    starts_at = p_starts_at,
    duration_minutes = p_duration_minutes,
    min_players = p_min_players,
    max_players = p_max_players,
    skill_level = coalesce(p_skill_level, 'any')
  where id = p_game_id;

  perform public.promote_waitlist(p_game_id);

  if v_game.starts_at <> p_starts_at or v_game.lat <> p_lat or v_game.lng <> p_lng then
    perform public.notify_participants(p_game_id, 'updated', 'Game details changed',
      trim(p_title) || ' · ' || trim(p_venue_name));
  end if;
end;
$$;

create function public.cancel_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.host_id is distinct from auth.uid() then raise exception 'Only the host can cancel this game'; end if;
  if v_game.status = 'cancelled' then return; end if;

  update public.games set status = 'cancelled' where id = p_game_id;
  perform public.notify_participants(p_game_id, 'cancelled', 'Game cancelled',
    v_game.title || ' · ' || v_game.venue_name);
end;
$$;

-- RSVP as going / maybe / declined. "going" on a full game joins the waitlist.
-- Returns the resulting status.
create function public.set_rsvp(p_game_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_game  public.games%rowtype;
  v_prev  text;
  v_new   text := p_status;
  v_going int;
  v_name  text;
begin
  if v_uid is null then raise exception 'You need to be signed in'; end if;
  if p_status not in ('going', 'maybe', 'declined') then raise exception 'Invalid RSVP'; end if;

  -- Lock the game so concurrent RSVPs can't overfill it.
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'open' then raise exception 'This game was cancelled'; end if;
  if v_game.starts_at + make_interval(mins => v_game.duration_minutes) < now() then
    raise exception 'This game has already finished';
  end if;
  if v_uid = v_game.host_id and p_status <> 'going' then
    raise exception 'Hosts can''t leave their own game — cancel it instead';
  end if;

  select status into v_prev from public.rsvps where game_id = p_game_id and user_id = v_uid;

  if p_status = 'going' then
    if v_prev in ('going', 'waitlist') then
      return v_prev;  -- nothing to do; keep waitlist position
    end if;
    select count(*) into v_going from public.rsvps where game_id = p_game_id and status = 'going';
    if v_going >= v_game.max_players then v_new := 'waitlist'; end if;
  end if;

  insert into public.rsvps (game_id, user_id, status)
  values (p_game_id, v_uid, v_new)
  on conflict (game_id, user_id) do update
    set status = excluded.status,
        updated_at = now(),
        checked_in_at = case when excluded.status = 'going' then public.rsvps.checked_in_at end;

  if v_prev = 'going' and v_new <> 'going' then
    perform public.promote_waitlist(p_game_id);
  end if;

  if v_new = 'going' and v_prev is distinct from 'going' and v_uid <> v_game.host_id then
    select coalesce(display_name, 'Someone') into v_name from public.profiles where id = v_uid;
    insert into public.notifications (user_id, game_id, kind, title, body)
    values (v_game.host_id, p_game_id, 'rsvp', v_name || ' is going',
            v_game.title || ' · ' || (v_going + 1) || '/' || v_game.max_players || ' players');
  end if;

  return v_new;
end;
$$;

-- Check in at the venue. Allowed from 30 min before start until the game
-- ends, and only within 250 m of the venue.
create function public.check_in(p_game_id uuid, p_lat double precision, p_lng double precision)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_game public.games%rowtype;
  v_dist double precision;
  v_at   timestamptz;
begin
  if v_uid is null then raise exception 'You need to be signed in'; end if;
  select * into v_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'open' then raise exception 'This game was cancelled'; end if;
  if now() < v_game.starts_at - interval '30 minutes' then
    raise exception 'Check-in opens 30 minutes before the start time';
  end if;
  if now() > v_game.starts_at + make_interval(mins => v_game.duration_minutes) then
    raise exception 'This game has already finished';
  end if;

  v_dist := st_distance(v_game.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography);
  if v_dist > 250 then
    raise exception 'You need to be at the venue to check in (you''re about % m away)', round(v_dist::numeric);
  end if;

  update public.rsvps
     set checked_in_at = coalesce(checked_in_at, now())
   where game_id = p_game_id and user_id = v_uid and status = 'going'
  returning checked_in_at into v_at;

  if v_at is null then raise exception 'Only players who are going can check in'; end if;
  return v_at;
end;
$$;

-- Save this browser's push subscription for the current user. Re-assigns the
-- endpoint if another account used the same browser before.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You need to be signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

-- Used only by the dispatch-push edge function (service role): atomically
-- claims undelivered notifications so concurrent calls never double-send.
create function public.claim_pending_pushes(p_limit int default 500)
returns table (id bigint, user_id uuid, game_id uuid, kind text, title text, body text, starts_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.notifications n
       set pushed_at = now()
     where n.id in (
       select notifications.id from public.notifications
        where notifications.pushed_at is null and notifications.created_at > now() - interval '1 hour'
        order by notifications.id
        limit p_limit
        for update skip locked
     )
    returning n.id, n.user_id, n.game_id, n.kind, n.title, n.body
  )
  select c.id, c.user_id, c.game_id, c.kind, c.title, c.body, g.starts_at
  from claimed c
  left join public.games g on g.id = c.game_id;
$$;

-- Internal helpers must not be callable from the browser.
revoke execute on function public.promote_waitlist(uuid) from public, anon, authenticated;
revoke execute on function public.notify_participants(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.claim_pending_pushes(int) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.claim_pending_pushes(int) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.user_settings      enable row level security;
alter table public.games              enable row level security;
alter table public.rsvps              enable row level security;
alter table public.messages           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications      enable row level security;

-- Profiles: anyone signed in can read; you edit only your own.
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);
create policy "profiles self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Settings: private to the owner.
create policy "settings self read" on public.user_settings
  for select to authenticated using (user_id = auth.uid());
create policy "settings self update" on public.user_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Games: readable by signed-in users. Writes go through the RPCs above.
create policy "games readable" on public.games
  for select to authenticated using (true);

-- RSVPs: rosters are visible to signed-in users. Writes go through set_rsvp/check_in.
create policy "rsvps readable" on public.rsvps
  for select to authenticated using (true);

-- Chat: only the host and players with an active RSVP.
create policy "messages participant read" on public.messages
  for select to authenticated using (public.is_participant(game_id));
create policy "messages participant write" on public.messages
  for insert to authenticated with check (user_id = auth.uid() and public.is_participant(game_id));

-- Push subscriptions: owner only.
create policy "push self read" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "push self delete" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Notifications: owner can read and mark read.
create policy "notifications self read" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications self update" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only these columns may be changed directly from the browser.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, sports, skill_level) on public.profiles to authenticated;
revoke update on public.user_settings from anon, authenticated;
grant update (home_lat, home_lng, notify_radius_miles, notifications_enabled) on public.user_settings to authenticated;
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (live rosters, chat and notification badge)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.games, public.rsvps, public.messages, public.notifications;
