-- Pickup: onboarding, safety tools, reminders & nudges, notification limits,
-- check-in areas and a public game page.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.profiles add column onboarded boolean not null default false;
update public.profiles p set onboarded = true
  from public.user_settings s
 where s.user_id = p.id and s.home_lat is not null;

create function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

alter table public.user_settings
  add column timezone          text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  -- Local hours; pings are inbox-only between quiet_start and quiet_end. Null = no quiet hours.
  add column quiet_start       smallint default 22 check (quiet_start between 0 and 23),
  add column quiet_end         smallint default 8 check (quiet_end between 0 and 23),
  add column max_pings_per_day smallint not null default 5 check (max_pings_per_day between 0 and 50);

alter table public.games
  add column checkin_radius_m int not null default 300 check (checkin_radius_m between 100 and 2000),
  add column reminder_sent_at timestamptz,
  add column nudge_sent_at    timestamptz;

alter table public.rsvps drop constraint rsvps_status_check;
alter table public.rsvps add constraint rsvps_status_check
  check (status in ('going', 'maybe', 'waitlist', 'declined', 'removed'));

grant update (onboarded) on public.profiles to authenticated;
grant update (timezone, quiet_start, quiet_end, max_pings_per_day) on public.user_settings to authenticated;

-- The view picks up the new games column.
create or replace view public.game_details
with (security_invoker = true)
as
select
  g.id, g.host_id, p.display_name as host_name,
  g.sport, g.title, g.description, g.venue_name, g.venue_address, g.lat, g.lng,
  g.starts_at, g.duration_minutes, g.min_players, g.max_players, g.skill_level,
  g.ping_radius_miles, g.status, g.created_at,
  (select count(*) from public.rsvps r where r.game_id = g.id and r.status = 'going')::int    as going_count,
  (select count(*) from public.rsvps r where r.game_id = g.id and r.status = 'waitlist')::int as waitlist_count,
  g.checkin_radius_m
from public.games g
join public.profiles p on p.id = g.host_id;

-- ---------------------------------------------------------------------------
-- Safety: blocks and reports
-- ---------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Reviewed by the admin in the Supabase dashboard (Table Editor → reports).
create table public.reports (
  id               bigint generated always as identity primary key,
  reporter_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  game_id          uuid references public.games (id) on delete set null,
  message_id       bigint references public.messages (id) on delete set null,
  reason           text not null check (char_length(reason) between 1 and 500),
  created_at       timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

alter table public.blocks  enable row level security;
alter table public.reports enable row level security;

create policy "blocks self read" on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy "blocks self insert" on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy "blocks self delete" on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

create policy "reports self insert" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
create policy "reports self read" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

revoke update on public.blocks, public.reports from anon, authenticated;

create function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- ---------------------------------------------------------------------------
-- Quiet hours: during a user's quiet hours, low-priority notifications go to
-- the inbox only (no push).
-- ---------------------------------------------------------------------------

create function public.in_quiet_hours(p_tz text, p_start smallint, p_end smallint)
returns boolean
language sql
stable
as $$
  select case
    when p_start is null or p_end is null or p_start = p_end then false
    when p_start < p_end then h >= p_start and h < p_end
    else h >= p_start or h < p_end
  end
  from (select extract(hour from now() at time zone coalesce(p_tz, 'UTC'))::int as h) x;
$$;

create function public.notifications_quiet_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.user_settings%rowtype;
begin
  if new.pushed_at is null and new.kind in ('new_game', 'needs_players', 'rsvp', 'chat', 'game_on', 'full') then
    select * into s from public.user_settings where user_id = new.user_id;
    if found and public.in_quiet_hours(s.timezone, s.quiet_start, s.quiet_end) then
      new.pushed_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_quiet_hours
  before insert on public.notifications
  for each row execute function public.notifications_quiet_hours();

-- ---------------------------------------------------------------------------
-- Pinging nearby players (shared by create_game and the "needs players" nudge)
-- ---------------------------------------------------------------------------

-- Notifies players near the venue who play the sport, haven't RSVPed, haven't
-- already had this kind of ping for the game, haven't blocked (or been blocked
-- by) the host, and are under their daily ping limit. Returns how many.
create function public.ping_nearby(p_game_id uuid, p_kind text, p_title text)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game  public.games%rowtype;
  v_count int;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then return 0; end if;

  insert into public.notifications (user_id, game_id, kind, title, body)
  select s.user_id, v_game.id, p_kind, p_title,
         v_game.title || ' · ' || v_game.venue_name || ' · '
           || round((st_distance(s.home_location, v_game.location) / 1609.344)::numeric, 1) || ' mi away'
  from public.user_settings s
  join public.profiles p on p.id = s.user_id
  where s.user_id <> v_game.host_id
    and s.notifications_enabled
    and (cardinality(p.sports) = 0 or v_game.sport = any (p.sports))
    and st_dwithin(s.home_location, v_game.location, v_game.ping_radius_miles * 1609.344)
    and st_dwithin(s.home_location, v_game.location, least(v_game.ping_radius_miles, s.notify_radius_miles) * 1609.344)
    and not exists (select 1 from public.rsvps r where r.game_id = v_game.id and r.user_id = s.user_id)
    and not exists (select 1 from public.notifications n
                    where n.game_id = v_game.id and n.user_id = s.user_id and n.kind = p_kind)
    and not public.is_blocked_pair(s.user_id, v_game.host_id)
    and (select count(*) from public.notifications n
         where n.user_id = s.user_id and n.kind in ('new_game', 'needs_players')
           and n.created_at > now() - interval '24 hours') < s.max_pings_per_day;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Actions (replacing the first versions)
-- ---------------------------------------------------------------------------

drop function public.create_game(text, text, text, text, text, double precision, double precision,
                                 timestamptz, int, int, int, text, int);
drop function public.update_game(uuid, text, text, text, text, double precision, double precision,
                                 timestamptz, int, int, int, text);
drop function public.check_in(uuid, double precision, double precision);

-- Returns {"id": <game id>, "pinged": <players notified>}.
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
  p_ping_radius_miles int,
  p_checkin_radius_m int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_pinged int;
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
    host_id, sport, title, description, venue_name, venue_address, lat, lng, starts_at,
    duration_minutes, min_players, max_players, skill_level, ping_radius_miles, checkin_radius_m
  ) values (
    v_uid, p_sport, trim(p_title), nullif(trim(p_description), ''), trim(p_venue_name),
    nullif(trim(p_venue_address), ''), p_lat, p_lng, p_starts_at, p_duration_minutes,
    p_min_players, p_max_players, coalesce(p_skill_level, 'any'), p_ping_radius_miles,
    coalesce(p_checkin_radius_m, 300)
  )
  returning id into v_id;

  insert into public.rsvps (game_id, user_id, status) values (v_id, v_uid, 'going');

  v_pinged := public.ping_nearby(v_id, 'new_game', 'New ' || p_sport || ' game nearby');
  return jsonb_build_object('id', v_id, 'pinged', v_pinged);
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
  p_skill_level text,
  p_checkin_radius_m int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_moved boolean;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.host_id is distinct from auth.uid() then raise exception 'Only the host can edit this game'; end if;
  if v_game.status <> 'open' then raise exception 'This game was cancelled'; end if;
  if p_max_players < (select count(*) from public.rsvps where game_id = p_game_id and status = 'going') then
    raise exception 'More players are already going than that — raise the limit or ask people to drop out';
  end if;

  v_moved := p_starts_at <> v_game.starts_at;
  if v_moved and p_starts_at < now() - interval '5 minutes' then
    raise exception 'The start time must be in the future';
  end if;
  if v_moved and p_starts_at > now() + interval '90 days' then
    raise exception 'Games can be scheduled at most 90 days ahead';
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
    skill_level = coalesce(p_skill_level, 'any'),
    checkin_radius_m = coalesce(p_checkin_radius_m, checkin_radius_m),
    reminder_sent_at = case when v_moved then null else reminder_sent_at end,
    nudge_sent_at = case when v_moved then null else nudge_sent_at end
  where id = p_game_id;

  perform public.promote_waitlist(p_game_id);

  if v_moved or v_game.lat <> p_lat or v_game.lng <> p_lng then
    perform public.notify_participants(p_game_id, 'updated', 'Game details changed',
      trim(p_title) || ' · ' || trim(p_venue_name));
  end if;
end;
$$;

-- Check in at the venue. Allowed from 30 min before start until the game
-- ends, within the game's check-in area (plus up to 150 m of GPS error).
create function public.check_in(
  p_game_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision default null
)
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
  if v_dist > v_game.checkin_radius_m + least(greatest(coalesce(p_accuracy_m, 0), 0), 150) then
    raise exception 'You need to be at the venue to check in (you''re about % m from the pin)', round(v_dist::numeric);
  end if;

  update public.rsvps
     set checked_in_at = coalesce(checked_in_at, now())
   where game_id = p_game_id and user_id = v_uid and status = 'going'
  returning checked_in_at into v_at;

  if v_at is null then raise exception 'Only players who are going can check in'; end if;
  return v_at;
end;
$$;

-- Tell the host about joins without a push per person: milestone pings when
-- the game reaches its minimum or fills up, otherwise one rolling notification.
create function public.notify_host_join(p_game_id uuid, p_name text, p_going int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id;

  if p_going = v_game.min_players then
    insert into public.notifications (user_id, game_id, kind, title, body)
    select r.user_id, p_game_id, 'game_on', 'Game on! 🎉',
           v_game.title || ' has ' || p_going || ' players — see you there'
    from public.rsvps r where r.game_id = p_game_id and r.status = 'going';
  elsif p_going = v_game.max_players then
    insert into public.notifications (user_id, game_id, kind, title, body)
    values (v_game.host_id, p_game_id, 'full', 'Your game is full',
            v_game.title || ' · ' || p_going || '/' || v_game.max_players || ' players');
  else
    update public.notifications
       set title = p_name || ' and others are going',
           body = v_game.title || ' · ' || p_going || '/' || v_game.max_players || ' players'
     where id = (select id from public.notifications
                 where user_id = v_game.host_id and game_id = p_game_id and kind = 'rsvp' and read_at is null
                 order by id desc limit 1);
    if not found then
      insert into public.notifications (user_id, game_id, kind, title, body)
      values (v_game.host_id, p_game_id, 'rsvp', p_name || ' is going',
              v_game.title || ' · ' || p_going || '/' || v_game.max_players || ' players');
    end if;
  end if;
end;
$$;

create or replace function public.set_rsvp(p_game_id uuid, p_status text)
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
  if public.is_blocked_pair(v_uid, v_game.host_id) then
    raise exception 'You can''t join this game';
  end if;

  select status into v_prev from public.rsvps where game_id = p_game_id and user_id = v_uid;
  if v_prev = 'removed' then raise exception 'The host removed you from this game'; end if;

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
    perform public.notify_host_join(p_game_id, v_name, v_going + 1);
  end if;

  return v_new;
end;
$$;

-- Host removes a player. They can't RSVP to this game again.
create function public.remove_player(p_game_id uuid, p_user_id uuid)
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
  if v_game.host_id is distinct from auth.uid() then raise exception 'Only the host can remove players'; end if;
  if p_user_id = v_game.host_id then raise exception 'You can''t remove yourself — cancel the game instead'; end if;

  update public.rsvps
     set status = 'removed', checked_in_at = null, updated_at = now()
   where game_id = p_game_id and user_id = p_user_id and status <> 'removed';
  if not found then raise exception 'That player isn''t in this game'; end if;

  perform public.promote_waitlist(p_game_id);

  insert into public.notifications (user_id, game_id, kind, title, body)
  values (p_user_id, p_game_id, 'removed', 'The host removed you from a game',
          v_game.title || ' · ' || v_game.venue_name);
end;
$$;

-- Public, read-only game info for share links (works signed out).
create function public.get_public_game(p_id uuid)
returns setof public.game_details
language sql
stable
security definer
set search_path = public
as $$
  select * from public.game_details where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Chat notifications: the host's messages always notify players; other
-- messages notify only people with no unread chat notification for the game.
-- ---------------------------------------------------------------------------

create function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_name text;
  v_host boolean;
begin
  select * into v_game from public.games where id = new.game_id;
  select coalesce(display_name, 'Someone') into v_name from public.profiles where id = new.user_id;
  v_host := new.user_id = v_game.host_id;

  insert into public.notifications (user_id, game_id, kind, title, body)
  select r.user_id, new.game_id, 'chat',
         case when v_host then '📣 ' || v_name || ' (host) · ' else v_name || ' · ' end || v_game.title,
         left(new.body, 140)
  from (
    select user_id from public.rsvps
     where game_id = new.game_id and status in ('going', 'maybe', 'waitlist')
    union
    select v_game.host_id
  ) r
  where r.user_id <> new.user_id
    and not public.is_blocked_pair(r.user_id, new.user_id)
    and (v_host or not exists (
          select 1 from public.notifications n
           where n.user_id = r.user_id and n.game_id = new.game_id and n.kind = 'chat' and n.read_at is null));
  return new;
end;
$$;

create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.on_message_insert();

-- ---------------------------------------------------------------------------
-- Scheduled jobs (run every minute by pg_cron — see the next migration)
-- ---------------------------------------------------------------------------

-- 1. One hour before start: remind everyone going.
-- 2. One to three hours before start, if short of players: ping nearby players
--    once more (including people pinged before) and tell the host.
create function public.run_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  v_short int;
  v_n     int;
  v_rem   int := 0;
  v_nudge int := 0;
begin
  for g in
    select x.*, (select count(*) from public.rsvps r where r.game_id = x.id and r.status = 'going')::int as going
    from public.games x
    where x.status = 'open' and x.reminder_sent_at is null
      and x.starts_at > now() and x.starts_at <= now() + interval '65 minutes'
    for update of x skip locked
  loop
    v_short := greatest(g.min_players - g.going, 0);
    insert into public.notifications (user_id, game_id, kind, title, body)
    select r.user_id, g.id, 'reminder', 'Starts in 1 hour: ' || g.title,
           g.venue_name || case when v_short > 0 then ' · still needs ' || v_short || ' more'
                                else ' · ' || g.going || ' players going' end
    from public.rsvps r where r.game_id = g.id and r.status = 'going';
    update public.games set reminder_sent_at = now() where id = g.id;
    v_rem := v_rem + 1;
  end loop;

  for g in
    select x.*, (select count(*) from public.rsvps r where r.game_id = x.id and r.status = 'going')::int as going
    from public.games x
    where x.status = 'open' and x.nudge_sent_at is null
      and x.starts_at > now() + interval '65 minutes' and x.starts_at <= now() + interval '3 hours'
      and x.created_at < now() - interval '1 hour'
    for update of x skip locked
  loop
    v_short := g.min_players - g.going;
    if v_short > 0 then
      v_n := public.ping_nearby(g.id, 'needs_players', 'Needs ' || v_short || ' more: ' || g.sport || ' nearby');
      insert into public.notifications (user_id, game_id, kind, title, body)
      values (g.host_id, g.id, 'needs_players_host', 'Your game needs ' || v_short || ' more',
              case when v_n > 0 then 'We pinged ' || v_n || ' more players nearby. Share the link to fill it faster.'
                   else 'Share the link with friends to fill it faster.' end);
      v_nudge := v_nudge + 1;
    end if;
    update public.games set nudge_sent_at = now() where id = g.id;
  end loop;

  return jsonb_build_object('reminders', v_rem, 'nudges', v_nudge);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions for the new functions
-- ---------------------------------------------------------------------------

revoke execute on function public.ping_nearby(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.notify_host_join(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.run_scheduled_jobs() from public, anon, authenticated;
revoke execute on function public.notifications_quiet_hours() from public, anon, authenticated;
revoke execute on function public.on_message_insert() from public, anon, authenticated;
grant execute on function public.run_scheduled_jobs() to service_role;
grant execute on function public.get_public_game(uuid) to anon, authenticated;
