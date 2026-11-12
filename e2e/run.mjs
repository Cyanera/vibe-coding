// Browser end-to-end test: 3 judges + admin on an iPhone-sized viewport, against a real
// Postgres schema (via api-shim.mjs). Requires: local PostgreSQL, Playwright + Chromium.
//   npm run test:e2e
import { execSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { startShim, ADMIN } from './api-shim.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = process.env.SHOTS_DIR
const APP = 'http://localhost:4173'
const DB = 'vibe_e2e'
const sh = (c) => execSync(c, { stdio: 'pipe', cwd: root }).toString()
const pg = (cmd) => (process.getuid?.() === 0 ? `su postgres -c "${cmd}"` : cmd)

let passed = 0
const check = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); passed++; console.log(`ok   - ${msg}`) }

// ---- database ----------------------------------------------------------
sh(pg(`psql -q -d postgres -f e2e/setup-role.sql`))
sh(pg(`dropdb --if-exists ${DB} && createdb ${DB}`))
sh(pg(`psql -q -v ON_ERROR_STOP=1 -d ${DB} -f supabase/tests/bootstrap.sql -f supabase/schema.sql -f supabase/seed.sql`))
sh(pg(`psql -q -v ON_ERROR_STOP=1 -d ${DB} -f e2e/admin-user.sql`))

// ---- servers -----------------------------------------------------------
const shim = await startShim({ database: DB })
sh('npx vite build')
const preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'ignore' })
// Build was made with the env below so the bundle points at the shim.
await new Promise((r) => setTimeout(r, 2000))

const browser = await chromium.launch()
const phone = { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }   // iPhone SE-ish: worst case
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }) }

// Scores identical across judges: P1 and P2 tie for best overall (20/20).
const PLAN = { 1: [5, 5, 5, 5], 2: [5, 5, 5, 5], 3: [3, 3, 5, 3], 4: [4, 4, 4, 4], 5: [3, 4, 4, 3], 6: [2, 3, 3, 2], 7: [4, 3, 4, 3], 8: [1, 2, 2, 1], 9: [3, 3, 3, 3], 10: [4, 4, 3, 4] }
const LABELS = ['Idea & Innovation', 'Functionality & Implementation', 'UI/UX Design', 'Presentation & Understanding']

async function judgeLogin(ctx, name, code) {
  const page = await ctx.newPage()
  await page.goto(APP + '/')
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByLabel('Access code').fill(code)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText(/of 10 Projects Evaluated/).waitFor()
  return page
}
const score = async (page, i, v) => page.getByRole('radiogroup', { name: LABELS[i] }).getByRole('radio', { name: String(v), exact: true }).click()
async function scoreProject(page, n) {
  for (let i = 0; i < 4; i++) await score(page, i, PLAN[n][i])
  await page.getByRole('button', { name: 'Save & Next' }).click()
}

try {
  // ===== Judge 1: UX checks ===============================================
  const c1 = await browser.newContext(phone)
  const p1 = await judgeLogin(c1, 'Judge One', 'demo-0001')
  check(await p1.getByText('0 of 10 Projects Evaluated').isVisible(), 'dashboard shows "0 of 10 Projects Evaluated"')
  check((await p1.getByText('Pending').count()) === 10, 'all 10 project cards are Pending')
  await shot(p1, '01-judge-dashboard')
  await p1.getByRole('button', { name: 'Continue Evaluating' }).click()
  await p1.getByText('Project 01').first().waitFor()
  check(await p1.getByRole('button', { name: 'Save & Next' }).isDisabled(), 'Save & Next disabled with no scores (none selected by default)')
  const sel = await p1.locator('[role=radio][aria-checked=true]').count()
  check(sel === 0, 'no score is preselected')

  // all four criteria + the Save bar fit in one iPhone SE-sized screen
  const vh = 664
  const lastRow = await p1.getByRole('radiogroup', { name: LABELS[3] }).boundingBox()
  const saveBtn = await p1.getByRole('button', { name: 'Save & Next' }).boundingBox()
  check(lastRow.y + lastRow.height <= saveBtn.y && saveBtn.y + saveBtn.height <= vh, 'all 4 criteria and the sticky Save button are visible together on a 390x664 screen')
  const btn = await p1.getByRole('radiogroup', { name: LABELS[0] }).getByRole('radio').first().boundingBox()
  check(btn.height >= 48 && btn.width >= 44, `score buttons are large tap targets (${Math.round(btn.width)}x${Math.round(btn.height)}px)`)

  await score(p1, 0, 5); await score(p1, 1, 4)
  check((await p1.getByTestId('total').innerText()).replace(/\s/g, '') === '9/20', 'total updates dynamically (9 / 20 after two scores)')
  check(await p1.getByRole('button', { name: 'Save & Next' }).isDisabled(), 'still disabled until all four are scored')
  await score(p1, 2, 3); await score(p1, 3, 2)
  check((await p1.getByTestId('total').innerText()).replace(/\s/g, '') === '14/20', 'total shows 14 / 20')
  await shot(p1, '02-judge-evaluate')

  // network failure keeps the selections and recovers
  let blocked = true
  await p1.route('**/rpc/judge_save', (r) => (blocked ? r.abort('failed') : r.continue()))
  await p1.getByRole('button', { name: 'Save & Next' }).click()
  await p1.getByRole('alert').filter({ hasText: /No connection/ }).waitFor()
  check((await p1.locator('[role=radio][aria-checked=true]').count()) === 4, 'selections preserved after a failed save')
  await shot(p1, '03-judge-save-error')
  blocked = false
  // change one score while offline-retry, then save for real (also tests edit-before-save)
  await score(p1, 3, PLAN[1][3]); await score(p1, 0, PLAN[1][0]); await score(p1, 1, PLAN[1][1]); await score(p1, 2, PLAN[1][2])
  await p1.getByRole('button', { name: 'Save & Next' }).click()
  await p1.getByText('Project 02').first().waitFor()
  check(p1.url().endsWith('/judge/project/2'), 'Save & Next opens the next pending project (Project 02)')
  await p1.unroute('**/rpc/judge_save')

  for (let n = 2; n <= 10; n++) {
    await scoreProject(p1, n)
    if (n < 10) await p1.waitForURL(`**/judge/project/${n + 1}`)
  }
  await p1.getByText('10 of 10 Projects Evaluated').waitFor()
  check(true, 'after the last project the judge returns to the dashboard: 10 of 10 Projects Evaluated')
  check(!(await p1.getByRole('button', { name: 'Continue Evaluating' }).count()), 'Continue Evaluating hidden when nothing is pending')
  await shot(p1, '04-judge-complete')

  // edit a previous evaluation
  await p1.getByRole('button', { name: /Project 09/ }).click()
  check((await p1.getByTestId('total').innerText()).replace(/\s/g, '') === '12/20', 'previous evaluation reloads for editing (12 / 20)')
  await score(p1, 0, 4)
  await p1.getByRole('button', { name: 'Save & Next' }).click()
  await p1.getByText('10 of 10 Projects Evaluated').waitFor()
  await p1.getByRole('button', { name: /Project 09/ }).click()
  check((await p1.getByTestId('total').innerText()).replace(/\s/g, '') === '13/20', 'edit persisted (13 / 20)')
  await score(p1, 0, 3)                        // revert to the plan
  await p1.getByRole('button', { name: 'Save & Next' }).click()
  await p1.getByText('10 of 10 Projects Evaluated').waitFor()

  // ===== Judge 2 and 3 ====================================================
  const c2 = await browser.newContext(phone)
  const p2 = await judgeLogin(c2, 'Judge Two', 'DEMO0002')
  check(await p2.getByText('0 of 10 Projects Evaluated').isVisible(), "judge 2 sees none of judge 1's evaluations (0 of 10)")
  for (let n = 1; n <= 10; n++) { if (n === 1) await p2.getByRole('button', { name: 'Continue Evaluating' }).click(); await scoreProject(p2, n); if (n < 10) await p2.waitForURL(`**/judge/project/${n + 1}`) }
  await p2.getByText('10 of 10 Projects Evaluated').waitFor()
  const c3 = await browser.newContext(phone)
  const p3 = await judgeLogin(c3, 'Judge Three', 'DEMO0003')
  for (let n = 1; n <= 10; n++) { if (n === 1) await p3.getByRole('button', { name: 'Continue Evaluating' }).click(); await scoreProject(p3, n); if (n < 10) await p3.waitForURL(`**/judge/project/${n + 1}`) }
  await p3.getByText('10 of 10 Projects Evaluated').waitFor()
  check(true, 'three judges each completed 10 evaluations')

  // wrong code
  const cw = await browser.newContext(phone)
  const pw = await cw.newPage()
  await pw.goto(APP + '/')
  await pw.getByRole('button', { name: /Judge One/ }).click()
  await pw.getByLabel('Access code').fill('WRONG')
  await pw.getByRole('button', { name: 'Sign in' }).click()
  await pw.getByRole('alert').filter({ hasText: 'Invalid access code' }).waitFor()
  check(true, 'wrong access code is rejected')
  await pw.goto(APP + '/judge'); await pw.waitForURL(APP + '/')
  check(true, '/judge without a session redirects to the login screen')
  await pw.goto(APP + '/admin')
  await pw.getByRole('heading', { name: 'Administrator sign in' }).waitFor()
  check(true, '/admin requires sign-in')
  await pw.goto(APP + '/present')
  await pw.getByRole('heading', { name: 'Administrator sign in' }).waitFor()
  check(true, '/present is hidden from judges and the public (admin sign-in required)')
  check(!(await pw.getByText('Competition Winners').count()), 'presentation content not shown to the public')

  // ===== Admin ============================================================
  const ca = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const a = await ca.newPage()
  await a.goto(APP + '/admin')
  await a.getByLabel('Email').fill(ADMIN.email)
  await a.getByLabel('Password').fill('nope')
  await a.getByRole('button', { name: 'Sign in' }).click()
  await a.getByRole('alert').waitFor()
  await a.getByLabel('Password').fill(ADMIN.password)
  await a.getByRole('button', { name: 'Sign in' }).click()
  await a.getByText('Completed Evaluations').waitFor()
  check(await a.getByText('30 / 30').isVisible(), 'admin overview: 30 / 30 completed evaluations')
  check(await a.getByText('100%').isVisible(), 'admin overview: 100% overall progress')
  const rowText = await a.locator('tbody tr').first().innerText()
  check(/Project 0[12]/.test(rowText) && rowText.includes('20.00 / 20') && rowText.includes('3/3'), `ranking row 1 = ${rowText.replace(/\s+/g, ' ')}`)
  await a.getByRole('button', { name: /Project 03/ }).click()
  check(await a.getByText('Criterion averages').isVisible() && (await a.getByText("Judges' evaluations").isVisible()), 'project detail shows criterion averages and judges\' evaluations')
  await a.locator('tr.border-t').first().waitFor()
  check((await a.locator('tr.border-t').count()) === 3, 'project detail lists all 3 judges')
  await shot(a, '05-admin-results')

  await a.getByRole('button', { name: 'Winners' }).click()
  await a.getByRole('heading', { name: 'Competition Winners' }).waitFor()
  check(await a.getByText('Preliminary Results').isVisible(), 'winners labelled "Preliminary Results" before finalizing')
  check((await a.getByText('Tie – Admin Review Required').count()) === 1, 'Best Overall tie shows "Tie – Admin Review Required"')
  check(await a.getByRole('button', { name: 'Finalize Results' }).isDisabled(), 'Finalize Results disabled while a tie is unresolved')
  check((await a.getByText(/Waiting for Award/).count()) === 2, 'awards 2 and 3 wait for award 1')
  await shot(a, '06-admin-tie')
  await a.getByRole('radio', { name: /Project 02/ }).check()
  await a.getByLabel('Reason for decision').fill('Stronger live demo')
  await a.getByRole('button', { name: 'Record Decision' }).click()
  await a.getByRole('dialog').getByRole('button', { name: 'Record decision' }).click()
  await a.getByTestId('winner-overall').waitFor()
  const w1 = await a.getByTestId('winner-overall').innerText()
  const w2 = await a.getByTestId('winner-innovation').innerText()
  const w3 = await a.getByTestId('winner-uiux').innerText()
  check(w1 === 'Masar' && w2 === 'UJ Assistant' && w3 === 'SchoolRide', `winners: overall=${w1}, idea=${w2}, UI/UX=${w3} (all different projects)`)
  check(await a.getByText(/Tie decided by admin: “Stronger live demo”/).isVisible(), 'tie decision and reason are recorded and shown')
  check(await a.getByRole('button', { name: 'Finalize Results' }).isEnabled(), 'Finalize Results enabled once all ties are resolved')
  await shot(a, '07-admin-winners')

  // Presentation is not available before finalizing
  await a.goto(APP + '/present')
  await a.getByText('Presentation Mode is available after results are finalized.').waitFor()
  check(true, 'Presentation Mode is locked until results are finalized')

  await a.goto(APP + '/admin?tab=winners')
  await a.getByRole('button', { name: 'Finalize Results' }).click()
  await a.getByRole('dialog').getByRole('button', { name: 'Finalize Results' }).click()
  await a.getByText('Final Results').waitFor()
  check(true, 'results finalized: label switches to "Final Results"')
  // judges are locked out
  await p1.goto(APP + '/judge/project/1')
  await p1.getByText('Judging is closed. Scores can no longer be changed.').first().waitFor()
  check(await p1.getByRole('button', { name: 'Save & Next' }).isDisabled(), 'judge cannot save after finalization')

  // Presentation mode
  await a.getByRole('link', { name: 'Open Presentation Mode' }).click()
  await a.getByRole('heading', { name: 'Vibe Coding Exhibition' }).waitFor()
  await a.getByText('University of Jeddah').waitFor({ timeout: 5000 })
  check(true, 'presentation shows exhibition title and University of Jeddah')
  check((await a.getByTestId(/reveal-/).count()) === 0, 'no winners visible before reveal')
  await a.keyboard.press('ArrowRight')
  await a.getByTestId('reveal-1').waitFor()
  check((await a.getByTestId('reveal-1').innerText()) === 'Masar' && (await a.getByTestId(/reveal-/).count()) === 1, 'first reveal: Best Overall only')
  await shot(a, '08-present-1')
  await a.getByRole('button', { name: /Reveal Best Innovative Idea/ }).click()
  await a.getByTestId('reveal-2').waitFor()
  await a.reload()
  await a.getByTestId('reveal-2').waitFor()
  check((await a.getByTestId(/reveal-/).count()) === 2, 'reveal state persists across reload (stored in the database)')
  await a.keyboard.press('ArrowRight')
  await a.getByTestId('reveal-3').waitFor()
  await a.mouse.move(100, 100)
  await shot(a, '09-present-3')
  const body = await a.locator('main').innerText()
  check(!/\d+\.\d\d|\/ ?20|\/ ?5/.test(body), 'presentation shows no scores')
  check(['SchoolRide', 'UJ Assistant', 'Masar'].every((n) => body.includes(n)), 'all three winners revealed in order')

  // Reopen
  await a.goto(APP + '/admin?tab=winners')
  await a.getByRole('button', { name: 'Reopen Competition' }).click()
  await a.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click()
  await a.getByText('Preliminary Results').waitFor()
  check(true, 'reopened: back to Preliminary Results')
  const fa = sh(pg(`psql -At -d ${DB} -c 'select count(*) from finalized_awards'`)).trim()
  check(fa === '0', 'reopen deletes finalized awards')

  // ===== Admin management =================================================
  await a.getByRole('button', { name: 'Judges' }).click()
  await a.getByLabel('Judge name').fill('Dr. Added Judge')
  await a.getByRole('button', { name: 'Add judge' }).click()
  const newCode = await a.getByTestId('new-code').innerText()
  check(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(newCode), `new judge access code generated (${newCode})`)
  await a.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await a.getByRole('button', { name: 'Projects' }).click()
  await a.getByLabel('Project name').fill('Brand New Project')
  await a.getByRole('button', { name: 'Add project' }).click()
  await a.getByText('Brand New Project').waitFor()
  await a.getByRole('listitem').filter({ hasText: 'Brand New Project' }).getByRole('button', { name: 'Remove' }).click()
  check(await a.getByRole('dialog').getByText(/permanently deleted/).isVisible(), 'destructive action asks for confirmation')
  await a.getByRole('dialog').getByRole('button', { name: 'Remove project' }).click()
  await a.getByText('Brand New Project').waitFor({ state: 'detached' })
  check(true, 'project removed after confirmation')
  console.log(`\nALL ${passed} E2E CHECKS PASSED`)
} finally {
  await browser.close()
  preview.kill()
  await shim.close()
}
