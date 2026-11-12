import { Link, useSearchParams } from 'react-router-dom'
import { AdminGate, useAdmin } from '../lib/adminSession'
import * as api from '../lib/api'
import { Button, Chip, useUi } from '../components/ui'
import Results from '../components/admin/Results'
import Winners from '../components/admin/Winners'
import ProjectsTab from '../components/admin/ProjectsTab'
import JudgesTab from '../components/admin/JudgesTab'

const TABS = [
  { id: 'results', label: 'Results' },
  { id: 'winners', label: 'Winners' },
  { id: 'projects', label: 'Projects' },
  { id: 'judges', label: 'Judges' },
] as const

export default function Admin() {
  return <AdminGate><Dashboard /></AdminGate>
}

function Dashboard() {
  const { ov, refresh, offline, signOut } = useAdmin()
  const { confirm, toast } = useUi()
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'results'
  const { judging_open, finalized } = ov.settings

  async function toggleJudging() {
    const ok = await confirm(judging_open
      ? { title: 'Close judging?', message: 'Judges will no longer be able to save or edit scores. You can reopen it at any time.', confirmLabel: 'Close judging', danger: true }
      : { title: 'Open judging?', message: 'Judges will be able to save and edit their scores.', confirmLabel: 'Open judging' })
    if (!ok) return
    try { await api.adminSetJudging(!judging_open); await refresh(); toast('success', judging_open ? 'Judging closed' : 'Judging open') }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-16 pt-4 safe-t">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">Vibe Coding Exhibition · Admin</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {finalized ? <Chip tone="navy">Results finalized</Chip>
              : judging_open ? <Chip tone="ok">Judging open</Chip> : <Chip tone="warn">Judging closed</Chip>}
            {offline && <Chip tone="bad">Connection problem – retrying</Chip>}
          </div>
        </div>
        <div className="flex gap-2">
          {!finalized && (
            <Button variant="secondary" size="sm" onClick={() => void toggleJudging()}>
              {judging_open ? 'Close Judging' : 'Open Judging'}
            </Button>
          )}
          {finalized && <Link to="/present" className="inline-flex h-9 items-center rounded-xl bg-navy px-3 text-sm font-semibold text-white">Presentation Mode</Link>}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </header>

      <nav className="sticky top-0 z-10 -mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-slate-200 bg-[#f5f7fa]/95 px-4 backdrop-blur" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setParams({ tab: t.id }, { replace: true })}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`h-11 shrink-0 border-b-2 px-4 text-sm font-semibold ${tab === t.id ? 'border-navy text-navy' : 'border-transparent text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'results' && <Results />}
        {tab === 'winners' && <Winners />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'judges' && <JudgesTab />}
      </div>
    </div>
  )
}
