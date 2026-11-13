-- =====================================================================
-- RESET: removes everything created by schema.sql so it can be run again
-- on a clean slate. DESTRUCTIVE: deletes all judging data (projects,
-- judges, evaluations, settings, finalized awards, admin list).
--
-- Only run this on a project that is dedicated to this platform, or after
-- checking that the tables below hold nothing you need:
--   select table_name from information_schema.tables where table_schema = 'public';
-- Your Supabase Auth users are NOT touched.
-- =====================================================================
drop table if exists public.finalized_awards, public.tie_resolutions,
  public.competition_settings, public.evaluations, public.judge_sessions,
  public.judges, public.projects, public.admin_users cascade;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('is_admin','list_login_judges','judge_login','judge_logout','judge_state','judge_save',
                         'admin_overview','admin_create_judge','admin_update_judge','admin_reset_judge_code',
                         'admin_set_judging','admin_set_reveal','admin_resolve_tie','admin_clear_tie',
                         'admin_finalize','admin_reopen','admin_export','admin_save_project',
                         'admin_delete_project','admin_project_evaluations')
  loop
    execute 'drop function ' || f.sig || ' cascade';
  end loop;
end $$;

drop schema if exists private cascade;
