import { useNavigate } from 'react-router-dom'
import { useJudge } from '../lib/judgeSession'
import { pad2 } from '../lib/format'
import { Button, Chip, ProgressBar } from '../components/ui'

export default function JudgeHome() {
  const { state, signOut } = useJudge()
  const nav = useNavigate()
  const total = state.projects.length
  const done = state.projects.filter((p) => p.evaluation).length
  const next = state.projects.find((p) => !p.evaluation)

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-5 safe-t">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Signed in as <span className="font-semibold text-slate-800">{state.judge.name}</span></p>
        <button onClick={() => void signOut()} className="text-sm font-semibold text-navy">Sign out</button>
      </div>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-2xl font-bold tracking-tight text-navy tnum">{done} of {total} Projects Evaluated</p>
        <ProgressBar value={done} max={total} className="mt-3" />
        {!state.judging_open ? (
          <p className="mt-4 rounded-xl bg-warn-50 px-4 py-3 text-sm font-medium text-warn">Judging is closed. Your scores are locked.</p>
        ) : next ? (
          <Button size="lg" className="mt-4 w-full" onClick={() => nav(`/judge/project/${next.number}`)}>Continue Evaluating</Button>
        ) : total > 0 ? (
          <p className="mt-4 rounded-xl bg-ok-50 px-4 py-3 text-sm font-medium text-ok">All projects evaluated. Thank you! You can still tap a project to edit its scores.</p>
        ) : null}
      </section>

      <ul className="mt-4 space-y-3">
        {state.projects.map((p) => (
          <li key={p.id}>
            <button onClick={() => nav(`/judge/project/${p.number}`)}
                    className="flex min-h-[4.5rem] w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 text-left shadow-sm active:bg-navy-50">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-lg font-bold text-navy tnum">{pad2(p.number)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Project {pad2(p.number)}</span>
                <span className="block truncate text-base font-semibold">{p.name}</span>
              </span>
              {p.evaluation ? <Chip tone="ok">Completed · {p.evaluation.total}/20</Chip> : <Chip tone="warn">Pending</Chip>}
            </button>
          </li>
        ))}
        {total === 0 && <li className="py-8 text-center text-slate-500">No projects have been added yet.</li>}
      </ul>
    </main>
  )
}
