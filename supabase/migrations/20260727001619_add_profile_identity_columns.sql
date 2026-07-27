-- supabase/migrations/20260727001619_add_profile_identity_columns.sql

alter table profiles
  add column email text,
  add column first_name text,
  add column last_name text;

update profiles
set email = 'eirik.vavik@hotmail.no',
    first_name = 'Eirik',
    last_name = 'Vavik'
where user_id = (select id from auth.users where email = 'eirik.vavik@hotmail.no');

alter table profiles
  alter column email set not null,
  alter column first_name set not null,
  alter column last_name set not null;

alter table profiles
  add constraint profiles_email_unique unique (email);

alter table profiles drop column display_name;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'eirik.vavik@hotmail.no' then
    insert into profiles (user_id, email, first_name, last_name, role)
    values (new.id, new.email, 'Eirik', 'Vavik', 'admin')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
