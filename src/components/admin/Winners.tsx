import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdmin } from '../../lib/adminSession'
import * as api from '../../lib/api'
import { fmt, projectLabel } from '../../lib/format'
import { prizeLabel } from '../../lib/prizes'
import type { Award, FinalAward } from '../../lib/types'
import { Button, Chip, useUi } from '../ui'

export default function Winners() {
  const { ov, refresh } = useAdmin()
  const { confirm, toast } = useUi()
  const [busy, setBusy] = useState(false)
  const { finalized } = ov.settings
  const missing = ov.totals.expected - ov.totals.completed
  const tied = ov.awards.some((a) => a.status === 'tie')

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    try { await fn(); await refresh(); toast('success', ok) }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }
  async function finalize() {
    const go = await confirm({
      title: 'Finalize results?',
      message: 'This closes judging and locks the three winners. You can only change them by reopening the competition.',
      confirmLabel: 'Finalize Results',
    })
    if (go) await run(api.adminFinalize, 'Results finalized')
  }
  async function reopen() {
    const go = await confirm({
      title: 'Reopen the competition?',
      message: 'Finalized awards will be deleted, presentation will be reset and judging will reopen.',
      confirmLabel: 'Reopen', danger: true,
    })
    if (go) await run(api.adminReopen, 'Competition reopened')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-navy">Competition Winners</h2>
        {finalized ? <Chip tone="ok">Final Results</Chip> : <Chip tone="warn">Preliminary Results</Chip>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {ov.awards.map((a, i) => (
          <AwardCard key={a.key} award={a} index={i} final={finalized ? ov.final.find((f) => f.key === a.key) : undefined} />
        ))}
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        {finalized ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-slate-600">Results are final and locked. Scores and projects cannot change unless you reopen.</p>
            <Link to="/present" className="inline-flex h-11 items-center rounded-xl bg-navy px-4 font-semibold text-white">Open Presentation Mode</Link>
            <Button variant="danger" disabled={busy} onClick={() => void reopen()}>Reopen Competition</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto text-sm text-slate-600">
              {ov.ready_to_finalize ? 'All evaluations are in and every award is decided.' : (
                <ul className="list-disc pl-5">
                  {missing > 0 && <li>{missing} evaluation{missing === 1 ? '' : 's'} still missing from active judges.</li>}
                  {ov.totals.judges === 0 && <li>No active judges.</li>}
                  {tied && <li>Resolve the tie(s) above.</li>}
                  {!tied && missing <= 0 && ov.awards.some((a) => a.status !== 'winner') && <li>Fewer than three projects have scores.</li>}
                </ul>
              )}
            </div>
            <Button size="lg" disabled={!ov.ready_to_finalize || busy} onClick={() => void finalize()}>Finalize Results</Button>
          </div>
        )}
      </section>
    </div>
  )
}

function AwardCard({ award: a, index, final }: { award: Award; index: number; final?: FinalAward }) {
  const { refresh } = useAdmin()
  const { toast, confirm } = useUi()
  const [pick, setPick] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const shown = final ? { number: final.number, name: final.name, score: final.score } : a.winner
  const resolved = final ? final.tie_resolved : a.tie_resolved
  const decision = final ? final.note : a.note

  async function decide() {
    if (!pick) return
    const c = a.candidates.find((x) => x.project_id === pick)!
    const ok = await confirm({
      title: 'Record tie decision?',
      message: <>{projectLabel(c.number)} · {c.name} will take <b>{a.label}</b>. This decision is recorded with your note.</>,
      confirmLabel: 'Record decision',
    })
    if (!ok) return
    setBusy(true)
    try { await api.adminResolveTie(a.key, pick, note); setPick(''); setNote(''); await refresh(); toast('success', 'Decision recorded') }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }
  async function undo() {
    setBusy(true)
    try { await api.adminClearTie(a.key); await refresh() }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={a.label}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Place {index + 1} of 3</p>
      <h3 className="mt-1 text-lg font-bold text-navy">{a.label} <span className="font-semibold text-ok">· {prizeLabel(a.key)}</span></h3>

      {shown && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{projectLabel(shown.number)}</p>
          <p className="text-2xl font-bold leading-tight" data-testid={`winner-${a.key}`}>{shown.name}</p>
          <p className="mt-2 text-lg font-semibold text-ok tnum">{fmt(shown.score)} / {a.max}
            <span className="ml-2 text-sm font-normal text-slate-500">average total</span>
          </p>
          {resolved && (
            <p className="mt-3 rounded-xl bg-navy-50 px-3 py-2 text-xs text-navy">
              Tie decided by admin{decision ? <>: “{decision}”</> : '.'}
              {!final && <button onClick={() => void undo()} disabled={busy} className="ml-2 font-semibold underline">Undo</button>}
            </p>
          )}
        </div>
      )}

      {a.status === 'tie' && !final && (
        <div className="mt-4 space-y-3">
          <p className="rounded-xl bg-warn-50 px-3 py-2 text-sm font-bold text-warn">Tie – Admin Review Required</p>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-slate-500">Tied at {fmt(a.candidates[0]?.score)} / {a.max}. Choose the winner:</legend>
            {a.candidates.map((c) => (
              <label key={c.project_id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${pick === c.project_id ? 'border-navy bg-navy-50' : 'border-slate-200'}`}>
                <input type="radio" name={`tie-${a.key}`} checked={pick === c.project_id} onChange={() => setPick(c.project_id)} className="h-5 w-5 accent-[#16324f]" />
                <span className="text-sm font-semibold">{projectLabel(c.number)} <span className="font-normal text-slate-600">· {c.name}</span></span>
              </label>
            ))}
          </fieldset>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for decision (optional)" maxLength={300}
                 aria-label="Reason for decision" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-navy" />
          <Button className="w-full" disabled={!pick || busy} onClick={() => void decide()}>Record Decision</Button>
        </div>
      )}
      {a.status === 'blocked' && !final && <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">Waiting for {index === 1 ? '1st' : '2nd'} place to be decided.</p>}
      {a.status === 'none' && !final && <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">No eligible project has scores yet.</p>}
    </article>
  )
}
