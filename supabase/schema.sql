-- =====================================================================
-- Vibe Coding Exhibition – Judging Platform
-- Database schema, access policies and RPC functions (Supabase / Postgres)
--
-- Run this whole file once in: Supabase Dashboard -> SQL Editor.
-- It is safe to re-run (idempotent) except for the DROP at the top of the
-- function section, which only replaces functions.
--
-- Security model
--   * Tables are locked down: `anon` has NO table access at all.
--   * Judges are NOT Supabase Auth users. They sign in through the
--     `judge_login` RPC with an individual access code and receive an opaque
--     session token. Every judge RPC resolves the judge from that token, so a
--     judge can only ever read/write their OWN evaluations.
--   * Admins are Supabase Auth users listed in `admin_users`. All admin reads
--     go through RLS policies / RPCs that check `is_admin()`.
--   * Access codes are stored as bcrypt hashes, never in plain text.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
-- Never auto-grant new tables/functions to the API roles.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  number     int  not null unique check (number > 0),
  name       text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.judges (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  active          boolean not null default true,
  code_hash       text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.judge_sessions (
  token_hash text primary key,
  judge_id   uuid not null references public.judges(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  judge_id      uuid not null references public.judges(id)   on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  idea          smallint not null check (idea         between 0 and 5),
  functionality smallint not null check (functionality between 0 and 5),
  uiux          smallint not null check (uiux         between 0 and 5),
  presentation  smallint not null check (presentation between 0 and 5),
  total         smallint generated always as (idea + functionality + uiux + presentation) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (judge_id, project_id)            -- one evaluation per judge per project
);

create table if not exists public.competition_settings (
  id           boolean primary key default true check (id),   -- single row
  judging_open boolean not null default false,
  finalized    boolean not null default false,
  reveal_count int     not null default 0 check (reveal_count between 0 and 3),
  updated_at   timestamptz not null default now()
);
insert into public.competition_settings (id) values (true) on conflict do nothing;

create table if not exists public.tie_resolutions (
  award_key         text primary key check (award_key in ('overall','innovation','uiux')),
  winner_project_id uuid  not null,
  candidate_ids     uuid[] not null,          -- the exact tied set this decision applies to
  note              text,
  decided_by        uuid,
  decided_at        timestamptz not null default now()
);

create table if not exists public.finalized_awards (
  award_key      text primary key check (award_key in ('overall','innovation','uiux')),
  project_id     uuid not null,
  project_number int  not null,
  project_name   text not null,
  score          numeric not null,
  tie_resolved   boolean not null default false,
  decision_note  text,
  finalized_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Lock everything down, then open only what admins need (via RLS)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.admin_users          enable row level security;
alter table public.projects             enable row level security;
alter table public.judges               enable row level security;
alter table public.judge_sessions       enable row level security;
alter table public.evaluations          enable row level security;
alter table public.competition_settings enable row level security;
alter table public.tie_resolutions      enable row level security;
alter table public.finalized_awards     enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- Admin read-only table access (a backstop: the app itself uses the admin_* RPCs).
-- Note: no grant on judges.code_hash. Nobody has direct INSERT/UPDATE/DELETE.
grant select on public.projects to authenticated;
grant select (id, name, active, created_at) on public.judges to authenticated;
grant select on public.evaluations, public.competition_settings,
                public.tie_resolutions, public.finalized_awards to authenticated;

drop policy if exists admin_all    on public.projects;
drop policy if exists admin_read   on public.projects;
drop policy if exists admin_read   on public.judges;
drop policy if exists admin_read   on public.evaluations;
drop policy if exists admin_read   on public.competition_settings;
drop policy if exists admin_read   on public.tie_resolutions;
drop policy if exists admin_read   on public.finalized_awards;
create policy admin_read on public.projects             for select to authenticated using (public.is_admin());
create policy admin_read on public.judges               for select to authenticated using (public.is_admin());
create policy admin_read on public.evaluations          for select to authenticated using (public.is_admin());
create policy admin_read on public.competition_settings for select to authenticated using (public.is_admin());
create policy admin_read on public.tie_resolutions      for select to authenticated using (public.is_admin());
create policy admin_read on public.finalized_awards     for select to authenticated using (public.is_admin());
-- admin_users and judge_sessions: RLS on, no policies, no grants => unreachable from the API.

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists evaluations_touch on public.evaluations;
create trigger evaluations_touch before update on public.evaluations
  for each row execute function private.touch_updated_at();

-- Once results are finalized, projects and judges are frozen until the admin reopens.
create or replace function private.block_if_finalized() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'judges' and tg_op = 'UPDATE' then
    if new.name = old.name and new.active = old.active then
      return new;                            -- login counters / code resets are allowed
    end if;
  end if;
  if exists (select 1 from public.competition_settings where finalized) then
    raise exception 'Results are finalized. Reopen the competition to make changes.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists projects_frozen on public.projects;
drop trigger if exists judges_frozen   on public.judges;
create trigger projects_frozen before insert or update or delete on public.projects
  for each row execute function private.block_if_finalized();
create trigger judges_frozen   before insert or update or delete on public.judges
  for each row execute function private.block_if_finalized();

-- ---------------------------------------------------------------------
-- Private helpers (schema `private` is not exposed through the API)
-- ---------------------------------------------------------------------
create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end $$;

create or replace function private.gen_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- no I, L, O, 0, 1
  bytes bytea := gen_random_bytes(8);
  out text := '';
  i int;
begin
  for i in 0..7 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function private.norm_code(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function private.fmt_code(p text) returns text
language sql immutable as $$ select left(p, 4) || '-' || substr(p, 5) $$;

create or replace function private.judge_from_token(p_token text) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare jid uuid;
begin
  select s.judge_id into jid
    from public.judge_sessions s join public.judges j on j.id = s.judge_id
   where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expires_at > now() and j.active;
  if jid is null then
    raise exception 'Session expired. Please sign in again.' using errcode = '28000';
  end if;
  return jid;
end $$;

-- Per-project averages over ACTIVE judges only.
create or replace function private.project_stats()
returns table (id uuid, number int, name text, n int,
               avg_total numeric, avg_idea numeric, avg_func numeric,
               avg_uiux numeric, avg_pres numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.number, p.name, count(e.id)::int,
         round(avg(e.total), 6),         round(avg(e.idea), 6),
         round(avg(e.functionality), 6), round(avg(e.uiux), 6),
         round(avg(e.presentation), 6)
    from public.projects p
    left join public.evaluations e on e.project_id = p.id
         and exists (select 1 from public.judges j where j.id = e.judge_id and j.active)
   group by p.id, p.number, p.name
$$;

-- Sequential award selection. Order matters and a project can win only one award:
--   1. overall    : highest avg total (/20)
--   2. innovation : highest avg Idea & Innovation (/5), excluding award 1 winner
--   3. uiux       : highest avg UI/UX (/5), excluding awards 1 and 2 winners
-- A tie is never broken automatically: status = 'tie' until an admin decides.
-- If an award is unresolved, the following awards are 'blocked' (they depend on it).
create or replace function private.compute_awards() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  keys     text[] := array['overall', 'innovation', 'uiux'];
  labels   text[] := array['Best Overall Project', 'Best Innovative Idea', 'Best UI/UX Design'];
  metrics  text[] := array['avg_total', 'avg_idea', 'avg_uiux'];
  maxes    int[]  := array[20, 5, 5];
  excluded uuid[] := '{}';
  blocked  boolean := false;
  result   jsonb := '[]'::jsonb;
  i int; top numeric; cands jsonb; cand_ids uuid[]; r public.tie_resolutions;
  win_id uuid; win jsonb; st text; resolved boolean; note text;
begin
  for i in 1..3 loop
    win := null; st := null; resolved := false; note := null; cands := '[]'::jsonb; cand_ids := '{}'; top := null;
    if blocked then
      st := 'blocked';
    else
      select max((to_jsonb(s) ->> metrics[i])::numeric) into top
        from private.project_stats() s where s.n > 0 and not (s.id = any (excluded));
      if top is null then
        st := 'none'; blocked := true;
      else
        select jsonb_agg(jsonb_build_object('project_id', s.id, 'number', s.number, 'name', s.name, 'score', top)
                         order by s.number),
               array_agg(s.id order by s.id)
          into cands, cand_ids
          from private.project_stats() s
         where s.n > 0 and not (s.id = any (excluded))
           and (to_jsonb(s) ->> metrics[i])::numeric = top;
        if array_length(cand_ids, 1) = 1 then
          st := 'winner'; win_id := cand_ids[1]; cands := '[]'::jsonb;
        else
          select * into r from public.tie_resolutions
           where award_key = keys[i] and candidate_ids = cand_ids and winner_project_id = any (cand_ids);
          if found then
            st := 'winner'; resolved := true; win_id := r.winner_project_id; note := r.note;
          else
            st := 'tie'; blocked := true;
          end if;
        end if;
        if st = 'winner' then
          select jsonb_build_object('project_id', s.id, 'number', s.number, 'name', s.name, 'score', top)
            into win from private.project_stats() s where s.id = win_id;
          excluded := excluded || win_id;
        end if;
      end if;
    end if;
    result := result || jsonb_build_object(
      'key', keys[i], 'label', labels[i], 'max', maxes[i], 'status', st,
      'winner', win, 'candidates', cands, 'tie_resolved', resolved, 'note', note);
  end loop;
  return result;
end $$;

-- True when every active judge has scored every project.
create or replace function private.judging_complete() returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.judges where active) > 0
     and (select count(*) from public.projects) > 0
     and (select count(*) from public.evaluations e
           join public.judges j on j.id = e.judge_id and j.active)
         = (select count(*) from public.judges where active) * (select count(*) from public.projects);
$$;

-- ---------------------------------------------------------------------
-- Public (anon) and judge RPCs
-- ---------------------------------------------------------------------

-- Names only, for the login cards.
create or replace function public.list_login_judges() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
    from public.judges where active;
$$;

-- Failure is returned (not raised) so that the attempt counter is persisted.
create or replace function public.judge_login(p_judge_id uuid, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare j public.judges; tok text; attempts int;
begin
  select * into j from public.judges where id = p_judge_id and active for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if j.locked_until is not null and j.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in a few minutes.');
  end if;
  if j.code_hash <> crypt(private.norm_code(p_code), j.code_hash) then
    attempts := j.failed_attempts + 1;
    update public.judges
       set failed_attempts = case when attempts >= 5 then 0 else attempts end,
           locked_until    = case when attempts >= 5 then now() + interval '5 minutes' else null end
     where id = j.id;
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  update public.judges set failed_attempts = 0, locked_until = null where id = j.id;
  delete from public.judge_sessions where expires_at < now();
  tok := encode(gen_random_bytes(32), 'hex');
  insert into public.judge_sessions (token_hash, judge_id, expires_at)
    values (encode(digest(tok, 'sha256'), 'hex'), j.id, now() + interval '48 hours');
  return jsonb_build_object('ok', true, 'token', tok, 'judge', jsonb_build_object('id', j.id, 'name', j.name));
end $$;

create or replace function public.judge_logout(p_token text) returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.judge_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Everything one judge needs: their name, the settings and their OWN evaluations.
create or replace function public.judge_state(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare jid uuid := private.judge_from_token(p_token); s public.competition_settings;
begin
  select * into s from public.competition_settings;
  return jsonb_build_object(
    'judge', (select jsonb_build_object('id', id, 'name', name) from public.judges where id = jid),
    'judging_open', s.judging_open and not s.finalized,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'number', p.number, 'name', p.name,
               'evaluation', case when e.id is null then null else jsonb_build_object(
                  'idea', e.idea, 'functionality', e.functionality, 'uiux', e.uiux,
                  'presentation', e.presentation, 'total', e.total, 'updated_at', e.updated_at) end)
             order by p.number)
        from public.projects p
        left join public.evaluations e on e.project_id = p.id and e.judge_id = jid), '[]'::jsonb));
end $$;

create or replace function public.judge_save(p_token text, p_project uuid,
  p_idea int, p_functionality int, p_uiux int, p_presentation int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare jid uuid := private.judge_from_token(p_token); s public.competition_settings; e public.evaluations;
begin
  select * into s from public.competition_settings;
  if not s.judging_open or s.finalized then
    raise exception 'Judging is closed. Scores can no longer be changed.' using errcode = '55000';
  end if;
  if p_idea is null or p_functionality is null or p_uiux is null or p_presentation is null
     or least(p_idea, p_functionality, p_uiux, p_presentation) < 0
     or greatest(p_idea, p_functionality, p_uiux, p_presentation) > 5 then
    raise exception 'All four scores must be whole numbers from 0 to 5.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'Project not found.' using errcode = '22023';
  end if;
  insert into public.evaluations (judge_id, project_id, idea, functionality, uiux, presentation)
    values (jid, p_project, p_idea, p_functionality, p_uiux, p_presentation)
  on conflict (judge_id, project_id) do update
    set idea = excluded.idea, functionality = excluded.functionality,
        uiux = excluded.uiux, presentation = excluded.presentation
  returning * into e;
  return jsonb_build_object('idea', e.idea, 'functionality', e.functionality, 'uiux', e.uiux,
                            'presentation', e.presentation, 'total', e.total, 'updated_at', e.updated_at);
end $$;

-- ---------------------------------------------------------------------
-- Admin RPCs (every one checks is_admin())
-- ---------------------------------------------------------------------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.competition_settings; awards jsonb; complete boolean; n_proj int; n_judge int; n_done int;
begin
  perform private.require_admin();
  select * into s from public.competition_settings;
  awards := private.compute_awards();
  complete := private.judging_complete();
  select count(*) into n_proj from public.projects;
  select count(*) into n_judge from public.judges where active;
  select count(*) into n_done from public.evaluations e join public.judges j on j.id = e.judge_id and j.active;
  return jsonb_build_object(
    'settings', jsonb_build_object('judging_open', s.judging_open, 'finalized', s.finalized, 'reveal_count', s.reveal_count),
    'totals', jsonb_build_object('projects', n_proj, 'judges', n_judge,
                                 'expected', n_proj * n_judge, 'completed', n_done),
    'complete', complete,
    'ready_to_finalize', complete and not s.finalized
        and not exists (select 1 from jsonb_array_elements(awards) a where a ->> 'status' <> 'winner'),
    'awards', awards,
    'final', coalesce((select jsonb_agg(jsonb_build_object(
          'key', f.award_key, 'project_id', f.project_id, 'number', f.project_number,
          'name', f.project_name, 'score', f.score, 'tie_resolved', f.tie_resolved, 'note', f.decision_note)
          order by case f.award_key when 'overall' then 1 when 'innovation' then 2 else 3 end)
          from public.finalized_awards f), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.number, 'name', r.name, 'n', r.n,
          'avg_total', r.avg_total, 'avg_idea', r.avg_idea, 'avg_func', r.avg_func,
          'avg_uiux', r.avg_uiux, 'avg_pres', r.avg_pres, 'rank', r.rk)
        order by r.number)
        from (select st.*, case when st.n = 0 then null
                                else rank() over (order by st.avg_total desc nulls last)::int end as rk
                from private.project_stats() st) r), '[]'::jsonb),
    'judges', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', j.id, 'name', j.name, 'active', j.active,
          'completed', (select count(*) from public.evaluations e where e.judge_id = j.id),
          'locked', j.locked_until is not null and j.locked_until > now())
        order by j.created_at, j.name)
        from public.judges j), '[]'::jsonb));
end $$;

create or replace function public.admin_create_judge(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare code text := private.gen_code(); jid uuid;
begin
  perform private.require_admin();
  insert into public.judges (name, code_hash) values (btrim(p_name), crypt(code, gen_salt('bf')))
    returning id into jid;
  return jsonb_build_object('id', jid, 'code', private.fmt_code(code));
end $$;

create or replace function public.admin_update_judge(p_id uuid, p_name text, p_active boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  update public.judges set name = btrim(p_name), active = p_active where id = p_id;
  if not found then raise exception 'Judge not found.' using errcode = '22023'; end if;
  if not p_active then delete from public.judge_sessions where judge_id = p_id; end if;
end $$;

-- Generates a NEW code (the old one stops working immediately). Shown once.
create or replace function public.admin_reset_judge_code(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare code text := private.gen_code();
begin
  perform private.require_admin();
  update public.judges set code_hash = crypt(code, gen_salt('bf')), failed_attempts = 0, locked_until = null
   where id = p_id;
  if not found then raise exception 'Judge not found.' using errcode = '22023'; end if;
  delete from public.judge_sessions where judge_id = p_id;
  return jsonb_build_object('id', p_id, 'code', private.fmt_code(code));
end $$;

create or replace function public.admin_set_judging(p_open boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  if p_open and (select finalized from public.competition_settings) then
    raise exception 'Results are finalized. Reopen the competition first.' using errcode = '55000';
  end if;
  update public.competition_settings set judging_open = p_open, updated_at = now();
end $$;

create or replace function public.admin_set_reveal(p_count int) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  if not (select finalized from public.competition_settings) then
    raise exception 'Finalize the results before presenting.' using errcode = '55000';
  end if;
  update public.competition_settings set reveal_count = least(greatest(p_count, 0), 3), updated_at = now();
end $$;

create or replace function public.admin_resolve_tie(p_award text, p_winner uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare aw jsonb; cand_ids uuid[];
begin
  perform private.require_admin();
  if (select finalized from public.competition_settings) then
    raise exception 'Results are finalized. Reopen the competition first.' using errcode = '55000';
  end if;
  select a into aw from jsonb_array_elements(private.compute_awards()) a where a ->> 'key' = p_award;
  if aw is null or aw ->> 'status' <> 'tie' then
    raise exception 'This award is not currently tied.' using errcode = '22023';
  end if;
  select array_agg((c ->> 'project_id')::uuid order by (c ->> 'project_id')::uuid) into cand_ids
    from jsonb_array_elements(aw -> 'candidates') c;
  if not (p_winner = any (cand_ids)) then
    raise exception 'The winner must be one of the tied projects.' using errcode = '22023';
  end if;
  insert into public.tie_resolutions (award_key, winner_project_id, candidate_ids, note, decided_by)
    values (p_award, p_winner, cand_ids, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (award_key) do update
    set winner_project_id = excluded.winner_project_id, candidate_ids = excluded.candidate_ids,
        note = excluded.note, decided_by = excluded.decided_by, decided_at = now();
end $$;

create or replace function public.admin_clear_tie(p_award text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  if (select finalized from public.competition_settings) then
    raise exception 'Results are finalized. Reopen the competition first.' using errcode = '55000';
  end if;
  delete from public.tie_resolutions where award_key = p_award;
end $$;

create or replace function public.admin_finalize() returns void
language plpgsql volatile security definer set search_path = public as $$
declare awards jsonb := private.compute_awards(); a jsonb;
begin
  perform private.require_admin();
  if (select finalized from public.competition_settings) then
    raise exception 'Results are already finalized.' using errcode = '55000';
  end if;
  if not private.judging_complete() then
    raise exception 'Every active judge must evaluate every project before finalizing.' using errcode = '55000';
  end if;
  if exists (select 1 from jsonb_array_elements(awards) x where x ->> 'status' <> 'winner') then
    raise exception 'Resolve all ties before finalizing.' using errcode = '55000';
  end if;
  delete from public.finalized_awards;
  for a in select * from jsonb_array_elements(awards) loop
    insert into public.finalized_awards (award_key, project_id, project_number, project_name, score, tie_resolved, decision_note)
    values (a ->> 'key', (a #>> '{winner,project_id}')::uuid, (a #>> '{winner,number}')::int,
            a #>> '{winner,name}', (a #>> '{winner,score}')::numeric,
            (a ->> 'tie_resolved')::boolean, a ->> 'note');
  end loop;
  update public.competition_settings set finalized = true, judging_open = false, reveal_count = 0, updated_at = now();
end $$;

create or replace function public.admin_reopen() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  delete from public.finalized_awards;
  update public.competition_settings set finalized = false, judging_open = true, reveal_count = 0, updated_at = now();
end $$;


create or replace function public.admin_save_project(p_id uuid, p_number int, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare pid uuid;
begin
  perform private.require_admin();
  begin
    if p_id is null then
      insert into public.projects (number, name) values (p_number, btrim(p_name)) returning id into pid;
    else
      update public.projects set number = p_number, name = btrim(p_name) where id = p_id returning id into pid;
      if pid is null then raise exception 'Project not found.' using errcode = '22023'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Project number % is already used.', p_number using errcode = '23505';
  end;
  return jsonb_build_object('id', pid);
end $$;

create or replace function public.admin_delete_project(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  delete from public.projects where id = p_id;
end $$;

create or replace function public.admin_project_evaluations(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'judge_id', j.id, 'judge', j.name, 'active', j.active,
        'idea', e.idea, 'functionality', e.functionality, 'uiux', e.uiux,
        'presentation', e.presentation, 'total', e.total, 'updated_at', e.updated_at)
      order by j.name)
      from public.evaluations e join public.judges j on j.id = e.judge_id
     where e.project_id = p_project), '[]'::jsonb);
end $$;

-- CSV/Excel export: one row per evaluation.
create or replace function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'project_number', p.number, 'project', p.name, 'judge', j.name, 'judge_active', j.active,
        'idea', e.idea, 'functionality', e.functionality, 'uiux', e.uiux,
        'presentation', e.presentation, 'total', e.total, 'updated_at', e.updated_at)
      order by p.number, j.name)
      from public.evaluations e
      join public.projects p on p.id = e.project_id
      join public.judges   j on j.id = e.judge_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Function privileges (explicit; nothing is callable by default)
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.is_admin()                                     to authenticated;
grant execute on function public.list_login_judges()                            to anon, authenticated;
grant execute on function public.judge_login(uuid, text)                        to anon, authenticated;
grant execute on function public.judge_logout(text)                             to anon, authenticated;
grant execute on function public.judge_state(text)                              to anon, authenticated;
grant execute on function public.judge_save(text, uuid, int, int, int, int)     to anon, authenticated;
grant execute on function public.admin_overview()                               to authenticated;
grant execute on function public.admin_create_judge(text)                       to authenticated;
grant execute on function public.admin_update_judge(uuid, text, boolean)        to authenticated;
grant execute on function public.admin_reset_judge_code(uuid)                   to authenticated;
grant execute on function public.admin_set_judging(boolean)                     to authenticated;
grant execute on function public.admin_set_reveal(int)                          to authenticated;
grant execute on function public.admin_resolve_tie(text, uuid, text)            to authenticated;
grant execute on function public.admin_clear_tie(text)                          to authenticated;
grant execute on function public.admin_finalize()                               to authenticated;
grant execute on function public.admin_reopen()                                 to authenticated;
grant execute on function public.admin_export()                                 to authenticated;
grant execute on function public.admin_save_project(uuid, int, text)            to authenticated;
grant execute on function public.admin_delete_project(uuid)                     to authenticated;
grant execute on function public.admin_project_evaluations(uuid)                to authenticated;
