-- =====================================================================
--  Vibe Coding Project Tracker — Supabase schema
--  جامعة جدة · كلية الحوسبة وتقنية المعلومات
--
--  شغّلي هذا الملف مرة واحدة في: Supabase → SQL Editor → New query → Run
--  آمن لإعادة التشغيل (يحذف ويعيد بناء الجداول).
-- =====================================================================

create extension if not exists pgcrypto;

drop table if exists public.activity_log  cascade;
drop table if exists public.evaluations   cascade;
drop table if exists public.progress      cascade;
drop table if exists public.groups        cascade;
drop table if exists public.milestones    cascade;
drop table if exists public.settings      cascade;

-- ---------------------------------------------------------------- إعدادات
create table public.settings (
  key   text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------------- المراحل
create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  ord         int  not null,
  name        text not null,
  description text not null default '',
  items       jsonb not null default '[]'::jsonb,   -- المطلوب تسليمه
  due_date    date not null,
  weight      numeric(4,2) not null default 1,
  created_at  timestamptz not null default now()
);
create index milestones_ord_idx on public.milestones (ord);

-- --------------------------------------------------------------- المجموعات
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                  -- رمز الدخول للمجموعة
  name       text not null,
  ord        int  not null default 0,
  members    jsonb not null default '[]'::jsonb,    -- ["اسم", ...]
  idea       jsonb not null default '{}'::jsonb,    -- title/problem/audience/solution/value
  links      jsonb not null default '{}'::jsonb,    -- prototype/repo/poster
  ai_tools   text not null default '',              -- أدوات الذكاء الاصطناعي المستخدمة
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------- تقدم كل مجموعة
-- الطالبات يكتبن: status / note / evidence_url / submitted_at
-- المشرفة وحدها تكتب: approved / approved_at
create table public.progress (
  group_id     uuid not null references public.groups(id)     on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  status       text not null default 'none'
               check (status in ('none','wip','submitted','blocked')),
  note         text not null default '',
  evidence_url text not null default '',
  submitted_at timestamptz,
  approved     boolean not null default false,
  approved_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (group_id, milestone_id)
);

-- ------------------------------------------------ الدرجات (للمشرفة فقط)
create table public.evaluations (
  group_id     uuid not null references public.groups(id)     on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  score        numeric(4,2),
  teacher_note text not null default '',
  updated_at   timestamptz not null default now(),
  primary key (group_id, milestone_id)
);

-- ------------------------------------------------------------ سجل الخطوات
create table public.activity_log (
  id         bigserial primary key,
  group_id   uuid references public.groups(id) on delete cascade,
  actor      text not null default '',   -- اسم الطالبة أو "المشرفة"
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index activity_log_created_idx on public.activity_log (created_at desc);

-- =====================================================================
--  Row Level Security
--  anon        = الطالبات والزوار (قراءة عامة، كتابة عبر الدوال فقط)
--  authenticated = المشرفة (صلاحية كاملة)
-- =====================================================================
alter table public.settings     enable row level security;
alter table public.milestones   enable row level security;
alter table public.groups       enable row level security;
alter table public.progress     enable row level security;
alter table public.evaluations  enable row level security;
alter table public.activity_log enable row level security;

create policy read_settings  on public.settings     for select to anon, authenticated using (true);
create policy read_ms        on public.milestones   for select to anon, authenticated using (true);
create policy read_groups    on public.groups       for select to anon, authenticated using (true);
create policy read_progress  on public.progress     for select to anon, authenticated using (true);
create policy read_log       on public.activity_log for select to anon, authenticated using (true);
-- evaluations: لا توجد سياسة لـ anon ⇒ الدرجات غير مرئية للطالبات إطلاقاً

create policy write_settings on public.settings     for all to authenticated using (true) with check (true);
create policy write_ms       on public.milestones   for all to authenticated using (true) with check (true);
create policy write_groups   on public.groups       for all to authenticated using (true) with check (true);
create policy write_progress on public.progress     for all to authenticated using (true) with check (true);
create policy write_eval     on public.evaluations  for all to authenticated using (true) with check (true);
create policy write_log      on public.activity_log for all to authenticated using (true) with check (true);

-- الرمز نفسه لا يُقرأ من جدول المجموعات علناً
revoke select on public.groups from anon;
grant  select (id, name, ord, members, idea, links, ai_tools, created_at, updated_at)
       on public.groups to anon;

-- =====================================================================
--  دوال الطالبات — الكتابة تتم عبرها فقط، والرمز هو المفتاح
-- =====================================================================

-- التحقق من رمز المجموعة وإرجاع بياناتها
create or replace function public.group_sign_in(p_code text)
returns table (id uuid, name text, members jsonb, idea jsonb, links jsonb, ai_tools text)
language sql security definer set search_path = public as $$
  select g.id, g.name, g.members, g.idea, g.links, g.ai_tools
  from public.groups g
  where upper(g.code) = upper(btrim(p_code))
  limit 1;
$$;

-- تحديث حالة مرحلة
create or replace function public.student_set_progress(
  p_code text, p_milestone uuid, p_status text,
  p_note text default '', p_evidence text default '', p_actor text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_ms text;
begin
  select id into v_group from public.groups where upper(code) = upper(btrim(p_code));
  if v_group is null then raise exception 'رمز المجموعة غير صحيح'; end if;
  if p_status not in ('none','wip','submitted','blocked') then
    raise exception 'حالة غير معروفة';
  end if;

  insert into public.progress (group_id, milestone_id, status, note, evidence_url, submitted_at, updated_at)
  values (v_group, p_milestone, p_status, coalesce(p_note,''), coalesce(p_evidence,''),
          case when p_status = 'submitted' then now() end, now())
  on conflict (group_id, milestone_id) do update
    set status       = excluded.status,
        note         = excluded.note,
        evidence_url = excluded.evidence_url,
        submitted_at = case when excluded.status = 'submitted'
                            then coalesce(public.progress.submitted_at, now()) end,
        updated_at   = now();

  select name into v_ms from public.milestones where id = p_milestone;
  insert into public.activity_log (group_id, actor, action, detail)
  values (v_group, coalesce(nullif(btrim(p_actor),''),'المجموعة'),
          'تحديث مرحلة: ' || coalesce(v_ms,'—'),
          'الحالة: ' || p_status || case when coalesce(p_note,'') <> '' then ' — ' || p_note else '' end);
end;
$$;

-- تحديث بطاقة الفكرة والروابط والأعضاء
create or replace function public.student_set_profile(
  p_code text, p_members jsonb, p_idea jsonb, p_links jsonb,
  p_ai_tools text default '', p_actor text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select id into v_group from public.groups where upper(code) = upper(btrim(p_code));
  if v_group is null then raise exception 'رمز المجموعة غير صحيح'; end if;

  update public.groups
     set members  = coalesce(p_members, members),
         idea     = coalesce(p_idea, idea),
         links    = coalesce(p_links, links),
         ai_tools = coalesce(p_ai_tools, ai_tools),
         updated_at = now()
   where id = v_group;

  insert into public.activity_log (group_id, actor, action, detail)
  values (v_group, coalesce(nullif(btrim(p_actor),''),'المجموعة'),
          'تحديث بيانات المشروع', coalesce(p_idea->>'title',''));
end;
$$;

revoke all on function public.group_sign_in(text)                                   from public;
revoke all on function public.student_set_progress(text,uuid,text,text,text,text)   from public;
revoke all on function public.student_set_profile(text,jsonb,jsonb,jsonb,text,text) from public;
grant execute on function public.group_sign_in(text)                                   to anon, authenticated;
grant execute on function public.student_set_progress(text,uuid,text,text,text,text)   to anon, authenticated;
grant execute on function public.student_set_profile(text,jsonb,jsonb,jsonb,text,text) to anon, authenticated;

-- =====================================================================
--  البيانات الأولية — عدّلي التواريخ من لوحة المشرفة متى شئتِ
-- =====================================================================
insert into public.settings (key, value) values
  ('activity', jsonb_build_object(
     'title','مسار مشاريع Vibe Coding',
     'course','فعالية الذكاء الاصطناعي و Vibe Coding',
     'org','جامعة جدة · كلية الحوسبة وتقنية المعلومات — فرع خليص',
     'totalMarks', 7))
on conflict (key) do nothing;

insert into public.milestones (ord, name, description, items, due_date, weight) values
(1,'الفكرة والفريق',
   'تكوين مجموعة من ٥ طالبات واختيار فكرة تنطلق من مشكلة حقيقية.',
   '["أسماء الأعضاء وقائدة الفريق","ما المشكلة التي نحلها؟","من الفئة المستهدفة؟","ما الحل المقترح؟","ما القيمة التي يقدمها المشروع؟"]',
   '2026-09-27', 1.0),
(2,'تحليل المشكلة وتحديد النطاق',
   'إثبات أن المشكلة موجودة فعلاً، وتحديد أصغر نسخة قابلة للتنفيذ.',
   '["دليل على المشكلة: استبيان أو مقابلة أو مصدر موثوق","٣ حلول مشابهة وما الذي يميزنا","قائمة مزايا النسخة الأولى MVP","تحديد ما لن يُنفَّذ في هذه المرحلة"]',
   '2026-10-11', 1.0),
(3,'التصميم وخطة البناء',
   'تحويل الفكرة إلى واجهات وخطة عمل موزعة على الأعضاء.',
   '["رحلة المستخدم من البداية للنهاية","واجهات مبدئية Wireframes","الأدوات والتقنيات المختارة","توزيع المهام على الأعضاء الخمسة"]',
   '2026-10-25', 1.0),
(4,'بناء النموذج الأولي',
   'أول نسخة تعمل فعلياً ويمكن تجربتها.',
   '["رابط يعمل للنموذج أو تطبيق الويب","الوظيفة الأساسية تعمل كاملة","سجل الأوامر Prompts المستخدمة في البناء"]',
   '2026-11-15', 1.5),
(5,'الاختبار والتحسين',
   'تجربة النموذج مع مستخدمين حقيقيين وتحسينه بناءً على ملاحظاتهم.',
   '["اختبار مع ٥ مستخدمين على الأقل","قائمة الملاحظات وما تم إصلاحه","توثيق أدوات الذكاء الاصطناعي وأثرها على العمل"]',
   '2026-11-29', 1.0),
(6,'البوستر والعرض النهائي',
   'تقديم المشروع أمام لجنة التحكيم من أعضاء هيئة التدريس.',
   '["البوستر بصيغة PDF","عرض تقديمي ٥ دقائق","تجربة حية للنموذج أمام اللجنة"]',
   '2026-12-13', 1.5);

-- مجموعات البداية — غيّري الأسماء والرموز من لوحة المشرفة
insert into public.groups (code, name, ord) values
  ('VC-101','المجموعة ١',1),
  ('VC-102','المجموعة ٢',2),
  ('VC-103','المجموعة ٣',3),
  ('VC-104','المجموعة ٤',4),
  ('VC-105','المجموعة ٥',5),
  ('VC-106','المجموعة ٦',6)
on conflict (code) do nothing;

-- =====================================================================
--  التحديث اللحظي (Realtime) — تظهر تعديلات الطالبات فوراً على اللوحة
-- =====================================================================
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.progress';     exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.groups';       exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.activity_log'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.milestones';   exception when others then null; end;
end $$;
