create extension if not exists pg_trgm;

create index people_given_name_trgm on people using gin (given_name gin_trgm_ops);
create index people_family_name_trgm on people using gin (family_name gin_trgm_ops);
create index people_birth_place_trgm on people using gin (birth_place gin_trgm_ops);
create index people_death_place_trgm on people using gin (death_place gin_trgm_ops);
create index person_names_value_trgm on person_names using gin (value gin_trgm_ops);
