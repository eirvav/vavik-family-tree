-- Temporary bootstrap scaffolding: the only way a permanent user gets a
-- profile in this phase, since invitations don't exist yet (later phase).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'eirik.vavik@hotmail.no' then
    insert into profiles (user_id, display_name, role)
    values (new.id, 'Eirik Vavik', 'admin')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();
