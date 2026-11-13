-- =====================================================================
-- Exhibition projects (editable) and sample judges. Run after schema.sql (SQL Editor).
-- Edit names freely, or change them later from the Admin dashboard.
-- The 3 sample judges are placeholders: rename them in Admin -> Judges.
-- Doctors sign in with the private link shown in Admin -> Judges.
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

insert into public.judges (name)
select v.name from (values ('Dr. Judge One'), ('Dr. Judge Two'), ('Dr. Judge Three')) as v(name)
 where not exists (select 1 from public.judges);

-- Open judging for the demo (the admin can close it any time).
update public.competition_settings set judging_open = true where not finalized;
