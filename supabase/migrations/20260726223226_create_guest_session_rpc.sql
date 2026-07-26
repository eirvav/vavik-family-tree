-- supabase/migrations/20260726223226_create_guest_session_rpc.sql

create or replace function create_guest_session(p_user_id uuid, p_lifetime_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into guest_sessions (user_id, issued_at, expires_at, revoked_at)
  values (p_user_id, now(), now() + make_interval(days => p_lifetime_days), null)
  on conflict (user_id) do update
    set issued_at = excluded.issued_at,
        expires_at = excluded.expires_at,
        revoked_at = null;
end;
$$;

revoke all on function create_guest_session(uuid, int) from public;
grant execute on function create_guest_session(uuid, int) to service_role;
