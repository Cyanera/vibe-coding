import { useState, type FormEvent } from 'react'
import { useAdmin } from '../../lib/adminSession'
import * as api from '../../lib/api'
import { pad2 } from '../../lib/format'
import { Button, useUi } from '../ui'

const input = 'h-11 rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-navy focus:ring-2 focus:ring-navy/20'

export default function ProjectsTab() {
  const { ov, refresh } = useAdmin()
  const { confirm, toast } = useUi()
  const nextNo = Math.max(0, ...ov.projects.map((p) => p.number)) + 1
  const [num, setNum] = useState<string>('')
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<{ id: string; num: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const frozen = ov.settings.finalized

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try { await fn(); await refresh(); toast('success', ok); return true }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Failed'); return false }
    finally { setBusy(false) }
  }
  async function add(e: FormEvent) {
    e.preventDefault()
    if (await run(() => api.adminSaveProject(null, Number(num || nextNo), name), 'Project added')) { setName(''); setNum('') }
  }
  async function saveEdit() {
    if (edit && await run(() => api.adminSaveProject(edit.id, Number(edit.num), edit.name), 'Project updated')) setEdit(null)
  }
  async function remove(id: string, n: number, title: string) {
    const ok = await confirm({
      title: `Remove Project ${pad2(n)}?`,
      message: <>“{title}” and <b>all evaluations for it</b> will be permanently deleted.</>,
      confirmLabel: 'Remove project', danger: true,
    })
    if (ok) await run(() => api.adminDeleteProject(id), 'Project removed')
  }

  return (
    <div className="space-y-4">
      {frozen && <p className="rounded-xl bg-warn-50 px-4 py-3 text-sm text-warn">Results are finalized, so projects are locked. Reopen the competition to make changes.</p>}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-slate-500">No.
          <input type="number" min={1} value={num} onChange={(e) => setNum(e.target.value)} placeholder={String(nextNo)} className={`${input} mt-1 block w-20`} />
        </label>
        <label className="min-w-48 flex-1 text-xs font-semibold text-slate-500">Project name
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={`${input} mt-1 block w-full`} />
        </label>
        <Button disabled={busy || frozen || !name.trim()}>Add project</Button>
      </form>

      <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm">
        {ov.projects.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {edit?.id === p.id ? (
              <>
                <input type="number" min={1} aria-label="Project number" value={edit.num} onChange={(e) => setEdit({ ...edit, num: e.target.value })} className={`${input} w-20`} />
                <input aria-label="Project name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} className={`${input} min-w-40 flex-1`} />
                <Button size="sm" disabled={busy || !edit.name.trim()} onClick={() => void saveEdit()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              </>
            ) : (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 font-bold text-navy tnum">{pad2(p.number)}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                <span className="text-xs text-slate-500 tnum">{p.n} evaluation{p.n === 1 ? '' : 's'}</span>
                <Button size="sm" variant="secondary" disabled={frozen} onClick={() => setEdit({ id: p.id, num: String(p.number), name: p.name })}>Edit</Button>
                <Button size="sm" variant="ghost" disabled={frozen} className="!text-bad" onClick={() => void remove(p.id, p.number, p.name)}>Remove</Button>
              </>
            )}
          </li>
        ))}
        {ov.projects.length === 0 && <li className="px-4 py-8 text-center text-slate-500">No projects yet.</li>}
      </ul>
    </div>
  )
}
