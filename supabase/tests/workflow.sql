-- End-to-end database tests. Run with supabase/tests/run.sh (needs local Postgres).
\set ON_ERROR_STOP on
\set QUIET on
create schema if not exists t;
grant usage on schema t to anon, authenticated;

create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'ok   - %', msg; end $$;

-- Asserts that running `q` raises an error whose message contains `pat`.
create or replace function t.fails(q text, pat text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ilike '%' || pat || '%' then raise notice 'ok   - rejected: % (%)', pat, left(q, 50); return; end if;
    raise exception 'FAIL: expected "%" but got "%" for %', pat, sqlerrm, q;
  end;
  raise exception 'FAIL: expected error "%" but statement succeeded: %', pat, q;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- ids -------------------------------------------------------------
select id as j1 from judges where name = 'Dr. Judge One'   \gset
select id as j2 from judges where name = 'Dr. Judge Two'   \gset
select id as j3 from judges where name = 'Dr. Judge Three' \gset
select gen_random_uuid() as admin_id \gset
select gen_random_uuid() as other_id \gset
insert into auth.users (id, email) values (:'admin_id', 'admin@test'), (:'other_id', 'nobody@test');
insert into admin_users values (:'admin_id');
create or replace function t.pid(n int) returns uuid language sql stable security definer as $$ select id from public.projects where number = n $$;
grant execute on function t.pid(int) to anon, authenticated;

\echo == 1. Anonymous access is locked down
set role anon;
select t.fails('select * from public.evaluations', 'permission denied');
select t.fails('select code_hash from public.judges', 'permission denied');
select t.fails('select * from public.judge_sessions', 'permission denied');
select t.fails('select * from public.finalized_awards', 'permission denied');
select t.fails('insert into public.projects(number,name) values (99,''x'')', 'permission denied');
select t.fails('select public.admin_overview()', 'permission denied');
select t.fails('select public.admin_finalize()', 'permission denied');
select t.fails('select private.compute_awards()', 'permission denied');
select t.ok(jsonb_array_length(public.list_login_judges()) = 3, 'login screen lists 3 active judges');
select t.ok(public.list_login_judges()::text not like '%code%', 'login list exposes no code data');

\echo == 2. Judge login, lockout and sessions
select (public.judge_login(:'j1', 'wrong')->>'ok')::boolean = false as r \gset
select t.ok(:'r' = 't', 'wrong code is rejected');
select public.judge_login(:'j1', 'demo-0001')->>'token' as tok1 \gset
select t.ok(length(:'tok1') = 64, 'correct code (any case/dash) gives a token');
select public.judge_login(:'j2', ' DEMO0002 ')->>'token' as tok2 \gset
select t.ok(length(:'tok2') = 64, 'second judge logs in');
select public.judge_login(:'j3','x1'), public.judge_login(:'j3','x2'), public.judge_login(:'j3','x3'),
       public.judge_login(:'j3','x4'), public.judge_login(:'j3','x5') \gset
select public.judge_login(:'j3','DEMO0003')->>'error' as lockmsg \gset
select t.ok(:'lockmsg' like 'Too many attempts%', 'judge is locked after 5 failed attempts, even with the right code');
select t.fails($$select public.judge_state('not-a-token')$$, 'Session expired');

\echo == 3. Evaluation validation
select t.fails(format($$select public.judge_save(%L, %L, 6, 3, 3, 3)$$, :'tok1', t.pid(1)), 'whole numbers from 0 to 5');
select t.fails(format($$select public.judge_save(%L, %L, -1, 3, 3, 3)$$, :'tok1', t.pid(1)), 'whole numbers from 0 to 5');
select t.fails(format($$select public.judge_save(%L, %L, null, 3, 3, 3)$$, :'tok1', t.pid(1)), 'whole numbers from 0 to 5');
select t.fails(format($$select public.judge_save(%L, %L, 3, 3, 3, 3)$$, :'tok1', gen_random_uuid()), 'Project not found');
select t.fails(format($$select public.judge_save('bad', %L, 3, 3, 3, 3)$$, t.pid(1)), 'Session expired');

\echo == 4. Judges only see and change their own evaluations
select public.judge_save(:'tok1', t.pid(1), 5, 4, 3, 2) \gset
select public.judge_save(:'tok2', t.pid(1), 1, 1, 1, 1) \gset
select (public.judge_state(:'tok1')->'projects'->0->'evaluation'->>'total')::int as s1 \gset
select (public.judge_state(:'tok2')->'projects'->0->'evaluation'->>'total')::int as s2 \gset
select t.ok(:s1 = 14 and :s2 = 4, 'each judge sees only their own total (14 vs 4)');
select t.ok(public.judge_state(:'tok1')->'projects'->1->'evaluation' = 'null'::jsonb, 'unscored project shows no evaluation');
select public.judge_save(:'tok1', t.pid(1), 5, 5, 5, 5) \gset
select (public.judge_state(:'tok1')->'projects'->0->'evaluation'->>'total')::int as s1b \gset
select t.ok(:s1b = 20, 'editing updates the existing evaluation');
reset role;
select t.ok((select count(*) from evaluations where project_id = t.pid(1)) = 2, 'still exactly one row per judge per project');
select t.ok((select count(*) from evaluations where judge_id = :'j2' and total = 4) = 1, 'judge 2 evaluation untouched by judge 1 edit');
select t.fails($$insert into evaluations(judge_id,project_id,idea,functionality,uiux,presentation) select judge_id,project_id,1,1,1,1 from evaluations limit 1$$, 'duplicate key');
select t.fails($$update evaluations set uiux = 9$$, 'check constraint');
select t.ok((select updated_at > created_at from evaluations where judge_id = :'j1' and project_id = t.pid(1)), 'updated_at advances on edit');

\echo == 5. Closed judging blocks edits
update competition_settings set judging_open = false;
set role anon;
select t.fails(format($$select public.judge_save(%L, %L, 1,1,1,1)$$, :'tok1', t.pid(1)), 'Judging is closed');
select t.ok((public.judge_state(:'tok1')->>'judging_open')::boolean = false, 'judge state reports judging closed');
reset role;
update competition_settings set judging_open = true;

\echo == 6. Podium: 1st/2nd/3rd by average total, one place per project
-- Same scores from all three judges. Totals: P1=20, P2=18, P3=16, others lower.
create temp table plan(n int, i int, f int, u int, p int);
insert into plan values (1,5,5,5,5),(2,5,5,4,4),(3,4,4,4,4),(4,4,4,3,3),(5,3,4,4,3),
                        (6,2,3,3,2),(7,4,3,4,3),(8,1,2,2,1),(9,3,3,3,3),(10,4,4,3,2);
delete from evaluations;
insert into evaluations(judge_id,project_id,idea,functionality,uiux,presentation)
select j.id, t.pid(pl.n), pl.i, pl.f, pl.u, pl.p from judges j, plan pl;
set role authenticated; set request.jwt.claim.sub = :'admin_id';
select t.ok((public.admin_overview()->>'complete')::boolean, 'overview: judging complete');
select (public.admin_overview()->'awards') as aw \gset
select t.ok(:'aw'::jsonb->0->>'label' = '1st Place' and :'aw'::jsonb->2->>'label' = '3rd Place', 'three places: 1st, 2nd, 3rd');
select t.ok(:'aw'::jsonb->0->'winner'->>'number' = '1' and :'aw'::jsonb->1->'winner'->>'number' = '2' and :'aw'::jsonb->2->'winner'->>'number' = '3',
            'podium is P1, P2, P3 by average total');
select t.ok((:'aw'::jsonb->0->'winner'->>'score')::numeric = 20 and (:'aw'::jsonb->1->'winner'->>'score')::numeric = 18 and (:'aw'::jsonb->2->'winner'->>'score')::numeric = 16, 'scores 20 / 18 / 16 out of 20');
select t.ok((public.admin_overview()->'projects'->0->>'rank') = '1', 'P1 ranked first');
select t.ok((public.admin_overview()->>'ready_to_finalize')::boolean, 'ready to finalize when complete and no ties');

\echo == 7. Non-admins cannot read results or run admin actions
set request.jwt.claim.sub = :'other_id';
select t.fails('select public.admin_overview()', 'Not authorized');
select t.fails('select public.admin_finalize()', 'Not authorized');
select t.fails('select public.admin_create_judge(''x'')', 'Not authorized');
select t.fails('select public.admin_set_judging(false)', 'Not authorized');
select t.fails($$select public.admin_resolve_tie('first', gen_random_uuid(), '')$$, 'Not authorized');
select t.ok((select count(*) from public.evaluations) = 0, 'non-admin sees zero evaluation rows (RLS)');
select t.ok((select count(*) from public.projects) = 0, 'non-admin sees zero project rows (RLS)');
select t.fails('insert into public.projects(number,name) values (50,''x'')', 'permission denied');
select t.fails('select public.admin_save_project(null, 50, ''x'')', 'Not authorized');
select t.fails('select public.admin_delete_project(gen_random_uuid())', 'Not authorized');
select t.fails('select code_hash from public.judges', 'permission denied');
set request.jwt.claim.sub = :'admin_id';
select t.ok((select count(*) from public.evaluations) = 30, 'admin reads all 30 evaluations');
select t.fails('select code_hash from public.judges', 'permission denied');

\echo == 8. Tie for 1st blocks 2nd and 3rd until an admin decides
reset role;
update evaluations set idea=5, functionality=5, uiux=5, presentation=5 where project_id = t.pid(2);   -- P2 now 20 like P1
set role authenticated; set request.jwt.claim.sub = :'admin_id';
select (public.admin_overview()->'awards') as aw \gset
select t.ok(:'aw'::jsonb->0->>'status' = 'tie' and jsonb_array_length(:'aw'::jsonb->0->'candidates') = 2, '1st place is a tie between 2 projects');
select t.ok(:'aw'::jsonb->1->>'status' = 'blocked' and :'aw'::jsonb->2->>'status' = 'blocked', '2nd and 3rd wait for 1st');
select t.ok(not (public.admin_overview()->>'ready_to_finalize')::boolean, 'not ready to finalize while tied');
select t.fails('select public.admin_finalize()', 'Resolve all ties');
select t.fails(format($$select public.admin_resolve_tie('first', %L, 'x')$$, t.pid(5)), 'one of the tied');
select t.fails(format($$select public.admin_resolve_tie('second', %L, 'x')$$, t.pid(1)), 'not currently tied');
select public.admin_resolve_tie('first', t.pid(2), 'Stronger live demo') \gset
select (public.admin_overview()->'awards') as aw \gset
select t.ok(:'aw'::jsonb->0->'winner'->>'number' = '2' and (:'aw'::jsonb->0->>'tie_resolved')::boolean and :'aw'::jsonb->0->>'note' = 'Stronger live demo', 'admin decision recorded: P2 takes 1st');
select t.ok(:'aw'::jsonb->1->'winner'->>'number' = '1', 'the tied project that lost (P1) takes 2nd place');
select t.ok(:'aw'::jsonb->2->'winner'->>'number' = '3', 'P3 takes 3rd place');

\echo == 9. A stale decision is ignored if the tied set changes
reset role;
update evaluations set presentation = 4 where project_id = t.pid(1) and judge_id = :'j1';
set role authenticated; set request.jwt.claim.sub = :'admin_id';
select t.ok((public.admin_overview()->'awards'->0->'winner'->>'number') = '2' and not (public.admin_overview()->'awards'->0->>'tie_resolved')::boolean, 'P2 now wins outright; old decision not applied');
reset role;
update evaluations set presentation = 5 where project_id = t.pid(1) and judge_id = :'j1';
set role authenticated; set request.jwt.claim.sub = :'admin_id';
select t.ok((public.admin_overview()->'awards'->0->>'tie_resolved')::boolean, 'tie again with same set -> original decision applies again');
select public.admin_clear_tie('first') \gset
select t.ok((public.admin_overview()->'awards'->0->>'status') = 'tie', 'clearing the decision reopens the tie');
select public.admin_resolve_tie('first', t.pid(1), null) \gset

\echo == 10. Tie for 2nd place
reset role;
update evaluations set idea=5, functionality=5, uiux=4, presentation=4 where project_id in (t.pid(2), t.pid(3));   -- P2 = P3 = 18
set role authenticated; set request.jwt.claim.sub = :'admin_id';
select (public.admin_overview()->'awards') as aw \gset
select t.ok(:'aw'::jsonb->0->'winner'->>'number' = '1' and not (:'aw'::jsonb->0->>'tie_resolved')::boolean, 'P1 (20) takes 1st outright; old 1st-place decision is stale');
select t.ok(:'aw'::jsonb->1->>'status' = 'tie' and jsonb_array_length(:'aw'::jsonb->1->'candidates') = 2, '2nd place is a tie (P2 vs P3 at 18)');
select t.ok(:'aw'::jsonb->2->>'status' = 'blocked', '3rd place blocked until 2nd decided');
select t.fails('select public.admin_finalize()', 'Resolve all ties');
select public.admin_resolve_tie('second', t.pid(3), 'Cleaner demo') \gset
select (public.admin_overview()->'awards') as aw \gset
select t.ok(:'aw'::jsonb->1->'winner'->>'number' = '3' and :'aw'::jsonb->2->'winner'->>'number' = '2', 'P3 takes 2nd by decision; the other tied project (P2) takes 3rd');
select t.ok((public.admin_overview()->>'ready_to_finalize')::boolean, 'ready to finalize after the tie is resolved');

\echo == 11. Finalize freezes everything; reopen restores
select public.admin_finalize() \gset
select t.ok((select count(*) from public.finalized_awards) = 3, 'three finalized places stored');
select t.ok((select string_agg(project_number::text, ',' order by award_key) from public.finalized_awards) = '1,3,2', 'finalized podium: 1st=P1, 2nd=P3, 3rd=P2');
select t.ok((select tie_resolved and decision_note = 'Cleaner demo' from public.finalized_awards where award_key='second'), 'tie decision stored with the place');
select t.fails('select public.admin_finalize()', 'already finalized');
select t.fails('select public.admin_set_judging(true)', 'finalized');
select t.fails('select public.admin_save_project(null, 11, ''Late'')', 'finalized');
select t.fails(format('select public.admin_save_project(%L, 1, ''Renamed'')', t.pid(1)), 'finalized');
select t.fails(format('select public.admin_delete_project(%L)', t.pid(1)), 'finalized');
select t.fails('select public.admin_create_judge(''Late'')', 'finalized');
select public.admin_set_reveal(2) \gset
select t.ok((public.admin_overview()->'settings'->>'reveal_count') = '2', 'presentation reveal state stored');
set role anon;
select t.fails(format($$select public.judge_save(%L, %L, 1,1,1,1)$$, :'tok1', t.pid(1)), 'Judging is closed');
reset role;
set role authenticated; set request.jwt.claim.sub = :'admin_id';
select public.admin_reopen() \gset
select t.ok((select count(*) from public.finalized_awards) = 0, 'reopen clears finalized awards');
select t.ok((public.admin_overview()->'settings'->>'finalized') = 'false' and (public.admin_overview()->'settings'->>'judging_open') = 'true' and (public.admin_overview()->'settings'->>'reveal_count') = '0', 'reopened: judging open, reveal reset');
select t.fails('select public.admin_set_reveal(1)', 'Finalize the results');

\echo == 11b. Project management
select t.ok(jsonb_array_length(public.admin_project_evaluations(t.pid(1))) = 3, 'admin sees all 3 judge evaluations for a project');
select t.fails('select public.admin_save_project(null, 1, ''Dup'')', 'already used');
select public.admin_save_project(null, 11, 'Extra Project') \gset
select public.admin_save_project(t.pid(11), 12, '  Renamed Extra ') \gset
select t.ok((select name from public.projects where number = 12) = 'Renamed Extra', 'project can be edited (name trimmed)');
select public.admin_delete_project(t.pid(12)) \gset
select t.ok((select count(*) from public.projects) = 10, 'project can be removed');

\echo == 12. Judge management
select public.admin_create_judge('Dr. New Judge')->>'code' as newcode \gset
select t.ok(:'newcode' ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$', 'new judge gets a readable 8-char code');
select id as jn from public.judges where name = 'Dr. New Judge' \gset
reset role; set role anon;
select public.judge_login(:'jn', :'newcode')->>'token' as tokn \gset
select t.ok(length(:'tokn') = 64, 'new judge can log in with the generated code');
reset role; set role authenticated; set request.jwt.claim.sub = :'admin_id';
select public.admin_reset_judge_code(:'jn')->>'code' as newcode2 \gset
set role anon;
select t.fails(format($$select public.judge_state(%L)$$, :'tokn'), 'Session expired');
select (public.judge_login(:'jn', :'newcode')->>'ok')::boolean as stillworks \gset
select t.ok(:'stillworks' = 'f', 'old code stops working after reset');
select t.ok((public.judge_login(:'jn', :'newcode2')->>'ok')::boolean, 'new code works');
reset role; set role authenticated; set request.jwt.claim.sub = :'admin_id';
select public.admin_update_judge(:'jn', 'Dr. New Judge', false) \gset
select t.ok((public.admin_overview()->'totals'->>'judges') = '3', 'deactivated judge not counted');
select t.ok((public.admin_overview()->>'complete')::boolean, 'completion only requires ACTIVE judges');
set role anon;
select t.ok(jsonb_array_length(public.list_login_judges()) = 3, 'deactivated judge hidden from login cards');
select t.ok((public.judge_login(:'jn', :'newcode2')->>'ok')::boolean = false, 'deactivated judge cannot log in');
reset role;
\echo ALL TESTS PASSED
