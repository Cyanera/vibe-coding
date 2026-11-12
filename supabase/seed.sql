-- =====================================================================
-- Exhibition projects (editable) and sample judges. Run after schema.sql (SQL Editor).
-- Edit names freely, or change them later from the Admin dashboard.
-- Sample judge codes are DEMO-0001 .. DEMO-0003: reset them in
-- Admin -> Judges -> "New code" BEFORE the real event.
-- =====================================================================
insert into public.projects (number, name) values
  (1,  'UJ Assistant'),
  (2,  'Masar'),
  (3,  'SchoolRide'),
  (4,  'MOVA'),
  (5,  'SMART RESTO'),
  (6,  'MindPal'),
  (7,  'The Mystery Room'),
  (8,  'SmartMove'),
  (9,  'AI smart Warehouse Management'),
  (10, 'Saa''i')
on conflict (number) do nothing;

insert into public.judges (name, code_hash)
select v.name, extensions.crypt(v.code, extensions.gen_salt('bf'))
  from (values ('Dr. Judge One', 'DEMO0001'),
               ('Dr. Judge Two', 'DEMO0002'),
               ('Dr. Judge Three', 'DEMO0003')) as v(name, code)
 where not exists (select 1 from public.judges);

-- Open judging for the demo (the admin can close it any time).
update public.competition_settings set judging_open = true where not finalized;
