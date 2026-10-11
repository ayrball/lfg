-- Every minute: queue reminders / "needs players" nudges, then deliver any
-- notifications that haven't been pushed yet. This is the safety net behind
-- the app's own "dispatch now" call, so pushes go out even if the user who
-- triggered them closed the app.
--
-- One-time setup (SQL editor) so the database knows where the push function lives:
--   select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');

create extension if not exists pg_cron;
create extension if not exists pg_net;

create function public.cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  perform public.run_scheduled_jobs();

  if exists (select 1 from public.notifications
             where pushed_at is null and created_at > now() - interval '1 hour') then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
    if v_url is not null then
      perform net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/dispatch-push',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
    end if;
  end if;
end;
$$;

revoke execute on function public.cron_tick() from public, anon, authenticated;

select cron.schedule('pickup-tick', '* * * * *', 'select public.cron_tick()');
