-- Duplicate-game guard: hosting a second open game within 150 m and 30 minutes
-- of one you already host is almost always an accidental double submit. The
-- app catches the 'duplicate_game' error (DETAIL = the existing game's id) and
-- asks before creating it again with p_allow_duplicate => true.

drop function public.create_game(text, text, text, text, text, double precision, double precision,
                                 timestamptz, int, int, int, text, int, int);

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
  p_checkin_radius_m int default 300,
  p_allow_duplicate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid;
  v_existing uuid;
  v_pinged   int;
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

  if not coalesce(p_allow_duplicate, false) then
    select g.id into v_existing
    from public.games g
    where g.host_id = v_uid
      and g.status = 'open'
      and abs(extract(epoch from (g.starts_at - p_starts_at))) <= 30 * 60
      and st_dwithin(g.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 150)
    order by abs(extract(epoch from (g.starts_at - p_starts_at)))
    limit 1;

    if v_existing is not null then
      raise exception using
        message = 'duplicate_game',
        detail = v_existing::text,
        hint = 'You already host a game at this place and time. Pass p_allow_duplicate => true to create another.';
    end if;
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
