-- Throwaway superuser for the local e2e API shim (test machines only).
do $$ begin
  if not exists (select from pg_roles where rolname = 'vibe_e2e') then
    create role vibe_e2e login superuser password 'vibe_e2e';
  end if;
end $$;
