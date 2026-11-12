import { useState, type FormEvent } from 'react'
import { useAdmin } from '../../lib/adminSession'
import * as api from '../../lib/api'
import { Button, Chip, Modal, useUi } from '../ui'

const input = 'h-11 rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-navy focus:ring-2 focus:ring-navy/20'

export default function JudgesTab() {
  const { ov, refresh } = useAdmin()
  const { confirm, toast } = useUi()
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)
  const [code, setCode] = useState<{ judge: string; code: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const frozen = ov.settings.finalized

  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(true)
    try { const r = await fn(); await refresh(); if (ok) toast('success', ok); return r }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }
  async function add(e: FormEvent) {
    e.preventDefault()
    const r = await run(() => api.adminCreateJudge(name))
    if (r) { setCode({ judge: name.trim(), code: r.code }); setName('') }
  }
  async function newCode(id: string, judge: string) {
    const ok = await confirm({
      title: `Generate a new code for ${judge}?`,
      message: 'The current code stops working immediately and the judge is signed out.',
      confirmLabel: 'Generate new code', danger: true,
    })
    if (!ok) return
    const r = await run(() => api.adminResetCode(id))
    if (r) setCode({ judge, code: r.code })
  }
  async function toggle(id: string, judge: string, active: boolean) {
    if (active) {
      const ok = await confirm({
        title: `Deactivate ${judge}?`,
        message: 'They will be signed out and hidden from the login screen. Their scores no longer count toward averages or completion. You can reactivate them later.',
        confirmLabel: 'Deactivate', danger: true,
      })
      if (!ok) return
    }
    await run(() => api.adminUpdateJudge(id, judge, !active), active ? 'Judge deactivated' : 'Judge activated')
  }
  async function rename() {
    const j = edit && ov.judges.find((x) => x.id === edit.id)
    if (edit && j) { await run(() => api.adminUpdateJudge(edit.id, edit.name, j.active), 'Judge updated'); setEdit(null) }
  }

  return (
    <div className="space-y-4">
      {frozen && <p className="rounded-xl bg-warn-50 px-4 py-3 text-sm text-warn">Results are finalized. Reopen the competition to add or edit judges. New access codes can still be issued.</p>}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm">
        <label className="min-w-48 flex-1 text-xs font-semibold text-slate-500">Judge name
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={`${input} mt-1 block w-full`} />
        </label>
        <Button disabled={busy || frozen || !name.trim()}>Add judge</Button>
      </form>

      <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm">
        {ov.judges.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {edit?.id === j.id ? (
              <>
                <input aria-label="Judge name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} className={`${input} min-w-40 flex-1`} />
                <Button size="sm" disabled={busy || !edit.name.trim()} onClick={() => void rename()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              </>
            ) : (
              <>
                <span className={`min-w-0 flex-1 truncate font-semibold ${j.active ? '' : 'text-slate-400'}`}>{j.name}</span>
                {j.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}
                {j.locked && <Chip tone="bad">Locked</Chip>}
                <span className="text-xs text-slate-500 tnum">{j.completed}/{ov.totals.projects} scored</span>
                <Button size="sm" variant="secondary" disabled={frozen} onClick={() => setEdit({ id: j.id, name: j.name })}>Edit</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void newCode(j.id, j.name)}>New code</Button>
                <Button size="sm" variant="ghost" disabled={busy || frozen} className={j.active ? '!text-bad' : ''} onClick={() => void toggle(j.id, j.name, j.active)}>
                  {j.active ? 'Deactivate' : 'Activate'}
                </Button>
              </>
            )}
          </li>
        ))}
        {ov.judges.length === 0 && <li className="px-4 py-8 text-center text-slate-500">No judges yet.</li>}
      </ul>

      {code && (
        <Modal title={`Access code for ${code.judge}`} onClose={() => setCode(null)}>
          <p className="text-sm text-slate-600">Share this code privately with the judge. It is shown only once and cannot be recovered; generate a new one if it is lost.</p>
          <p className="my-4 rounded-xl bg-navy-50 py-4 text-center text-3xl font-bold tracking-widest text-navy tnum" data-testid="new-code">{code.code}</p>
          <Button variant="secondary" className="w-full" onClick={() => { void navigator.clipboard?.writeText(code.code).then(() => toast('success', 'Copied')).catch(() => toast('error', 'Copy failed')) }}>Copy code</Button>
        </Modal>
      )}
    </div>
  )
}
