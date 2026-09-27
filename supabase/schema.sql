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
  details     text  not null default '',             -- شرح تفصيلي للمرحلة
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

insert into public.milestones (ord, name, description, items, details, due_date, weight) values
(1,'الفكرة والفريق',
   'تكوين مجموعة من ٥ طالبات واختيار فكرة تنطلق من مشكلة حقيقية.',
   '["أسماء الأعضاء الخمس وقائدة الفريق","ما المشكلة التي نحلها؟","من الفئة المستهدفة؟","ما الحل المقترح؟","ما القيمة التي يقدمها المشروع؟"]',
   'المطلوب اختيار فكرة واحدة واضحة وتسجيل الفريق.

• الفريق: ٥ طالبات، واحدة منهن قائدة الفريق ومسؤولة عن التواصل مع المشرفة.

• الفكرة: أجبن عن كل سؤال في سطرين لا أكثر.
  – ما المشكلة؟ صِفن موقفاً حقيقياً يحدث اليوم، لا فكرة عامة.
    مثال ضعيف: «صعوبة النقل».
    مثال جيد: «سائق التوصيل يقطع الحي مرتين لأن الطلبات غير مرتبة حسب الموقع».
  – من الفئة المستهدفة؟ فئة واحدة بعينها، لا «الجميع».
  – ما الحل المقترح؟ جملة واحدة: ماذا سيفعل النظام؟
  – ما القيمة؟ ما الذي سيتحسّن، ويفضّل أن يكون قابلاً للقياس: وقت، تكلفة، عدد أخطاء.

• يفضَّل أن تخدم الفكرة قطاع اللوجستيات والنقل والخدمات الذكية.

معيار القبول: تقرأ أي زميلة بطاقة المشروع وتفهم الفكرة دون شرح شفهي منكن.',
   '2026-09-27', 1.0),

(2,'تحليل المشكلة وتحديد النطاق',
   'إثبات أن المشكلة موجودة فعلاً، وتحديد أصغر نسخة قابلة للتنفيذ.',
   '["دليل على المشكلة: استبيان أو مقابلات أو مصدر موثوق","٣ حلول مشابهة وما الذي يميزنا","من ٣ إلى ٥ مزايا للنسخة الأولى MVP","ما الذي لن يُنفَّذ هذا الفصل"]',
   'الهدف: إثبات أن المشكلة حقيقية، وتحديد ما ستبنونه فعلاً.

• الدليل: استبيان بـ ١٥ رداً على الأقل، أو ٣ مقابلات، أو تقرير/مصدر موثوق. أرفقن الرابط في خانة «رابط الإثبات».

• المنافسون: ٣ حلول موجودة، وسطر واحد لكل حل: ماذا يفعل؟ وما الذي ينقصه؟ وما الذي ستفعلنه أفضل منه؟

• مزايا النسخة الأولى MVP: من ٣ إلى ٥ مزايا فقط — الحد الأدنى الذي يثبت أن الفكرة تعمل.

• خارج النطاق: اكتبن صراحة ما لن تنفذنه. هذه أهم نقطة وأكثر ما يُهمَل، وهي سبب تعثّر أغلب المشاريع.

معيار القبول: قائمة مزايا مرقّمة يمكن بناؤها فعلياً في أسبوعين.',
   '2026-10-08', 1.0),

(3,'التصميم وخطة البناء',
   'تحويل الفكرة إلى شاشات وخطة تنفيذ موزعة على الأعضاء.',
   '["رحلة المستخدم من البداية للنهاية","واجهات مبدئية Wireframes لكل شاشة رئيسية","الأدوات والتقنيات المختارة","توزيع المهام على الأعضاء الخمس"]',
   'تحويل الفكرة إلى شاشات وخطة تنفيذ.

• رحلة المستخدم: من فتح التطبيق إلى إنجاز المهمة، خطوة خطوة.

• الواجهات Wireframes: رسم مبدئي لكل شاشة رئيسية، من ٣ إلى ٥ شاشات. Figma أو رسم على ورق مصوّر — كلاهما مقبول في هذه المرحلة.

• التقنيات: ما الذي ستستخدمنه ولماذا اخترتنه.

• توزيع المهام: اسم كل عضوة وما تنفذه بالتحديد.

• ابدأن من الآن بحفظ الأوامر Prompts التي تستخدمنها مع أدوات الذكاء الاصطناعي — ستحتجنها في التوثيق النهائي، ولن تتذكرنها لاحقاً.

معيار القبول: تعرف كل عضوة ما عليها بناؤه بالضبط.',
   '2026-10-18', 1.0),

(4,'بناء النموذج الأولي',
   'أول نسخة تعمل فعلياً ويمكن فتحها وتجربتها.',
   '["رابط شغّال للنموذج أو تطبيق الويب","المسار الأساسي يعمل من البداية للنهاية","سجل الأوامر Prompts المستخدمة"]',
   'أول نسخة تعمل ويمكن الضغط عليها.

• رابط شغّال: الموقع أو النموذج التفاعلي. الصور وحدها لا تُقبل في هذه المرحلة.

• المسار الأساسي كاملاً: من الدخول إلى إنجاز المهمة الرئيسية دون توقف أو خطأ.

• مقبول: بيانات تجريبية ثابتة، تصميم غير مكتمل، نقص المزايا الثانوية.
  غير مقبول: أزرار لا تعمل في المسار الأساسي.

• سجل الأوامر: ملف يجمع أهم الأوامر التي استخدمتنها مع أداة الذكاء الاصطناعي.

معيار القبول: تفتح المشرفة الرابط وتنجز المهمة الأساسية بنفسها دون أن تشرحن لها.',
   '2026-11-01', 1.5),

(5,'التسليم النهائي',
   'آخر موعد لتسليم النموذج والبوستر والتوثيق — قبل العرض بأسبوع.',
   '["اختبار مع ٥ مستخدمين من خارج الفريق","قائمة الملاحظات وما تم إصلاحه","البوستر بصيغة PDF","توثيق أدوات الذكاء الاصطناعي","جميع الروابط مسجلة في الأداة"]',
   'آخر موعد لتسليم كل شيء. بعده لا تعديل — الأسبوع الأخير مخصص للتدريب على العرض فقط.

• الاختبار: جرّبن النموذج مع ٥ مستخدمين على الأقل من خارج الفريق. سجّلن ما واجههم من صعوبة وما أصلحتنه بناءً عليه.

• البوستر PDF: يحوي اسم المشروع، المشكلة، الحل، صورة من النموذج، القيمة المضافة، أسماء الفريق.

• توثيق أدوات الذكاء الاصطناعي: أي أدوات استخدمتن، في أي مرحلة، ومثال على أمر Prompt أعطى نتيجة ممتازة، وآخر فشل وكيف عالجتنه. هذا بند مُقيَّم، لا تذكرة شكر.

• تأكدن أن روابط النموذج والبوستر مسجلة داخل الأداة.

معيار القبول: كل ما سبق مرفوع ومسجل قبل نهاية هذا اليوم.',
   '2026-11-08', 1.0),

(6,'العرض النهائي أمام لجنة التحكيم',
   'عرض المشروع أمام لجنة من أعضاء هيئة التدريس ضمن المسابقة.',
   '["عرض تقديمي مدته ٥ دقائق","تجربة حية للنموذج أمام اللجنة","إجابة أسئلة اللجنة","مشاركة جميع أعضاء الفريق"]',
   'العرض أمام لجنة التحكيم من أعضاء هيئة التدريس.

• المدة: ٥ دقائق عرض + ٣ دقائق أسئلة. الالتزام بالوقت جزء من التقييم.

• الترتيب المقترح:
  – المشكلة ولماذا تستحق الحل: دقيقة
  – الحل: دقيقة
  – تجربة حية للنموذج: دقيقتان
  – كيف ساعدنا الذكاء الاصطناعي في البناء: دقيقة

• التجربة الحية إلزامية — الشرائح وحدها لا تكفي.

• جهّزن خطة بديلة: فيديو قصير مسجّل للنموذج، تحسباً لانقطاع الإنترنت.

• تتحدث كل عضوة في الفريق، ولو بجملة واحدة.

معيار القبول: عرض منضبط بالوقت، ونموذج يعمل أمام اللجنة.',
   '2026-11-15', 1.5);

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
