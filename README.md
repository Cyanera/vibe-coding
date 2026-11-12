# Vibe Coding Exhibition – Judging Platform

University of Jeddah · React + Tailwind + Supabase · deploys to Vercel.

Judges score 10 projects on 4 criteria (0–5 each, 20 total) from their phones. The admin watches progress, ranks projects, resolves ties, finalizes three awards and reveals them on a projector.

## How awards are chosen (in this exact order, one award per project)
1. **Best Overall Project**: highest average total (/20).
2. **Best Innovative Idea**: highest average *Idea & Innovation* (/5), Award 1 winner excluded.
3. **Best UI/UX Design**: highest average *UI/UX* (/5), Award 1 and 2 winners excluded.

Averages are across **active** judges. A tie is never broken automatically: the award shows **Tie – Admin Review Required**, later awards wait, and the admin records the winner and a reason. A decision applies only to that exact tied set; if scores change it is ignored. Finalizing requires every active judge to have scored every project and no open ties. The logic lives once, in SQL (`private.compute_awards`).

## Deploy (about 15 minutes)

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor** → run `supabase/schema.sql`, then `supabase/seed.sql` (your 10 projects + 3 sample judges).
3. **Authentication → Providers → Email**: turn **off** “Allow new users to sign up”.
4. **Authentication → Users → Add user**: create the admin (email + strong password, auto-confirm).
5. Make that user an admin (SQL Editor):
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
6. **Project Settings → API**: copy the Project URL and the `anon` / publishable key.

### 2. Vercel
1. Import this repo in Vercel (framework: Vite; `vercel.json` handles routing).
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (see `.env.example`). **Never** use the `service_role` key.
3. Deploy.

### 3. Before the event
- Admin → **Judges**: rename the sample judges, add real ones, tap **New code** for each and send the code privately (shown once). The sample codes `DEMO-0001…3` must not be used.
- Admin → **Projects**: edit names/numbers if needed.
- Admin → **Open Judging** (the seed leaves it open).

### Run day
Judge: open the site → tap name → enter code → score → **Save & Next**.
Admin: `/admin` → Results → Winners (resolve ties) → **Finalize Results** → **Presentation Mode** (Space/→ reveals the next award; ← hides; the reveal state is stored, so a second device can drive it).

## Security model
- `anon` has **no table access**. Judges are not Supabase users: `judge_login` checks a bcrypt-hashed code (5 failures lock that judge for 5 min) and returns a 48 h opaque session token; every judge RPC derives the judge from the token, so a judge can only read or write their own evaluations and never sees other scores.
- Admin = Supabase Auth user listed in `admin_users`. All admin functions check `is_admin()`; tables are read-only via RLS for admins, writes go through RPCs. Access codes are never readable.
- Scores are `smallint` with `check (0..5)`, one row per judge/project (`unique`), total is a generated column.
- After finalization, projects, judges and scores are frozen until **Reopen Competition**.
- Only the public anon key ships in the frontend. Evaluations live in Postgres; the browser stores only the judge session token.
- Admin dashboard refreshes every 4 s (presentation every 2 s).

## Local development
```bash
cp .env.example .env   # fill in values
npm install
npm run dev
```

## Tests
```bash
npm run test:db    # SQL: isolation, RLS, validation, award order, ties, finalize/reopen (needs local PostgreSQL)
npm run test:e2e   # browser: 3 judges on a 390×664 phone + admin + presentation (needs PostgreSQL + Playwright)
```
`e2e/api-shim.mjs` is a test-only stand-in for the Supabase API that runs the real schema in local Postgres. Do not deploy it.
