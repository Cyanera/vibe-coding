import { useState, type FormEvent } from 'react'
import { useAdmin } from '../../lib/adminSession'
import * as api from '../../lib/api'
import { Button, Chip, useUi } from '../ui'

const input = 'h-11 rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-navy focus:ring-2 focus:ring-navy/20'

export default function JudgesTab() {
  const { ov, refresh } = useAdmin()
  const { confirm, toast } = useUi()
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)
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
    if (await run(() => api.adminCreateJudge(name), 'Judge added')) setName('')
  }
  const link = `${window.location.origin}/?k=${ov.settings.access_key}`
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); toast('success', 'Link copied') }
    catch { toast('error', 'Copy failed. Select the link and copy it manually.') }
  }
  async function regenerate() {
    const ok = await confirm({
      title: 'Create a new judges link?',
      message: 'The current link stops working immediately and every judge is signed out. Send the new link to your judges.',
      confirmLabel: 'Create new link', danger: true,
    })
    if (ok) await run(api.adminRegenerateKey, 'New link created')
  }
  async function toggleNew() {
    await run(() => api.adminSetAllowNew(!ov.settings.allow_new_judges), ov.settings.allow_new_judges ? 'New names closed' : 'New names allowed')
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
      {frozen && <p className="rounded-xl bg-warn-50 px-4 py-3 text-sm text-warn">Results are finalized. Reopen the competition to add or edit judges.</p>}
      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" aria-label="Judges link">
        <h2 className="text-sm font-semibold text-slate-600">Private link for judges</h2>
        <p className="text-xs text-slate-500">Send this link only to the judges. Opening it, each judge types their name and starts evaluating. Anyone with the link can sign in as any registered name, so share it privately.</p>
        <input readOnly value={link} aria-label="Judges link" onFocus={(e) => e.currentTarget.select()}
               className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" data-testid="judge-link" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void copyLink()}>Copy link</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void regenerate()}>Create new link</Button>
          <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={ov.settings.allow_new_judges} onChange={() => void toggleNew()} disabled={busy}
                   className="h-5 w-5 accent-[#16324f]" />
            Allow judges to add their own name
          </label>
        </div>
      </section>

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
                <span className="text-xs text-slate-500 tnum">{j.completed}/{ov.totals.projects} scored</span>
                <Button size="sm" variant="secondary" disabled={frozen} onClick={() => setEdit({ id: j.id, name: j.name })}>Edit</Button>
                <Button size="sm" variant="ghost" disabled={busy || frozen} className={j.active ? '!text-bad' : ''} onClick={() => void toggle(j.id, j.name, j.active)}>
                  {j.active ? 'Deactivate' : 'Activate'}
                </Button>
              </>
            )}
          </li>
        ))}
        {ov.judges.length === 0 && <li className="px-4 py-8 text-center text-slate-500">No judges yet.</li>}
      </ul>

    </div>
  )
}
