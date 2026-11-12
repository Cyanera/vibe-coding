import { Fragment, useEffect, useMemo, useState } from 'react'
import { useAdmin } from '../../lib/adminSession'
import * as api from '../../lib/api'
import { CRITERIA, MAX_TOTAL } from '../../lib/criteria'
import { downloadCsv, fmt, pad2 } from '../../lib/format'
import type { ProjectEvaluation, ProjectStat } from '../../lib/types'
import { Button, Chip, ProgressBar, useUi } from '../ui'

type SortKey = 'rank' | 'project' | 'avg' | 'n'

export default function Results() {
  const { ov } = useAdmin()
  const { toast } = useUi()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 })
  const [open, setOpen] = useState<string | null>(null)
  const pct = ov.totals.expected ? Math.round((ov.totals.completed / ov.totals.expected) * 100) : 0

  const winners = useMemo(() => {
    const m = new Map<string, string[]>()
    const short = { overall: 'Overall', innovation: 'Idea', uiux: 'UI/UX' } as const
    const add = (id: string | undefined, k: keyof typeof short) => { if (id) m.set(id, [...(m.get(id) ?? []), short[k]]) }
    if (ov.settings.finalized) ov.final.forEach((f) => add(f.project_id, f.key))
    else ov.awards.forEach((a) => add(a.winner?.project_id, a.key))
    return m
  }, [ov])

  const rows = useMemo(() => {
    const val = (p: ProjectStat): number | string | null =>
      sort.key === 'rank' ? p.rank : sort.key === 'project' ? p.number : sort.key === 'avg' ? p.avg_total : p.n
    return [...ov.projects].sort((a, b) => {
      const x = val(a), y = val(b)
      if (x === null && y === null) return a.number - b.number
      if (x === null) return 1            // unscored projects always last
      if (y === null) return -1
      return (Number(x) - Number(y)) * sort.dir || a.number - b.number
    })
  }, [ov.projects, sort])

  const th = (key: SortKey, label: string, cls = '') => (
    <th scope="col" className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${cls}`}
        aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : (key === 'avg' || key === 'n') && s.key !== key ? -1 : 1 }))}
              className="inline-flex items-center gap-1 uppercase">
        {label}<span aria-hidden className="text-slate-300">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )

  async function exportEvaluations() {
    try {
      const data = await api.adminExport()
      downloadCsv('vibe-coding-evaluations.csv', [
        ['Project #', 'Project', 'Judge', ...CRITERIA.map((c) => c.label), `Total (/${MAX_TOTAL})`, 'Judge active', 'Last updated'],
        ...data.map((r) => [r.project_number, r.project, r.judge, r.idea, r.functionality, r.uiux, r.presentation, r.total, r.judge_active ? 'Yes' : 'No', r.updated_at]),
      ])
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Export failed') }
  }
  function exportRankings() {
    downloadCsv('vibe-coding-rankings.csv', [
      ['Rank', 'Project #', 'Project', `Average total (/${MAX_TOTAL})`, ...CRITERIA.map((c) => `Avg ${c.label} (/5)`), 'Evaluations', 'Active judges'],
      ...[...ov.projects].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.number - b.number).map((p) => [
        p.rank, p.number, p.name, p.avg_total, p.avg_idea, p.avg_func, p.avg_uiux, p.avg_pres, p.n, ov.totals.judges]),
    ])
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Overview">
        <Stat label="Total Projects" value={ov.totals.projects} />
        <Stat label="Total Judges" value={ov.totals.judges} />
        <Stat label="Completed Evaluations" value={`${ov.totals.completed} / ${ov.totals.expected}`} />
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall Progress</p>
          <p className="mt-1 text-2xl font-bold text-navy tnum">{pct}%</p>
          <ProgressBar value={ov.totals.completed} max={ov.totals.expected} className="mt-2 !h-2" />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Judge progress">
        <h2 className="text-sm font-semibold text-slate-600">Judge progress</h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {ov.judges.filter((j) => j.active).map((j) => (
            <li key={j.id} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-sm">{j.name}</span>
              <ProgressBar value={j.completed} max={ov.totals.projects} className="!h-2 flex-1" />
              <span className="w-12 text-right text-sm text-slate-500 tnum">{j.completed}/{ov.totals.projects}</span>
            </li>
          ))}
          {ov.totals.judges === 0 && <li className="text-sm text-slate-500">No active judges.</li>}
        </ul>
      </section>

      <section className="rounded-2xl bg-white shadow-sm" aria-label="Project rankings">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-lg font-semibold">Project Rankings</h2>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportEvaluations()}>Export evaluations (CSV)</Button>
            <Button variant="secondary" size="sm" onClick={exportRankings}>Export rankings (CSV)</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>{th('rank', 'Rank')}{th('project', 'Project')}{th('avg', 'Average Score')}{th('n', 'Evaluations')}</tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Fragment key={p.id}>
                  <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <td className="px-3 py-3 font-bold tnum">{p.rank ?? '–'}</td>
                    <td className="px-3 py-3">
                      <button className="text-left font-semibold text-navy" aria-expanded={open === p.id}>
                        Project {pad2(p.number)} <span className="font-normal text-slate-600">· {p.name}</span>
                      </button>
                      <span className="ml-2 inline-flex gap-1 align-middle">
                        {winners.get(p.id)?.map((w) => <Chip key={w} tone="navy">{w}</Chip>)}
                      </span>
                    </td>
                    <td className="px-3 py-3 tnum">{p.avg_total === null ? '–' : `${fmt(p.avg_total)} / ${MAX_TOTAL}`}</td>
                    <td className="px-3 py-3 tnum">
                      <span className={p.n === ov.totals.judges && p.n > 0 ? 'text-ok' : 'text-slate-600'}>{p.n}/{ov.totals.judges}</span>
                    </td>
                  </tr>
                  {open === p.id && (
                    <tr className="bg-slate-50"><td colSpan={4} className="px-3 py-4"><Detail project={p} /></td></tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No projects yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-2xl bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold text-navy tnum">{value}</p>
  </div>
)

function Detail({ project }: { project: ProjectStat }) {
  const [evals, setEvals] = useState<ProjectEvaluation[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const sig = `${project.n}|${project.avg_total}`
  useEffect(() => {
    let live = true
    api.adminProjectEvaluations(project.id).then((d) => live && setEvals(d)).catch((e: Error) => live && setErr(e.message))
    return () => { live = false }
  }, [project.id, sig])

  const avgs = [project.avg_idea, project.avg_func, project.avg_uiux, project.avg_pres]
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-600">Criterion averages</h3>
        <ul className="mt-2 space-y-2">
          {CRITERIA.map((c, i) => (
            <li key={c.key}>
              <div className="flex justify-between text-sm"><span>{c.label}</span><span className="font-semibold tnum">{fmt(avgs[i])} / 5</span></div>
              <ProgressBar value={Number(avgs[i] ?? 0)} max={5} className="mt-1 !h-2" />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-600">Judges' evaluations</h3>
        {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        {!evals && !err && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
        {evals && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-semibold">Judge</th><th className="px-2 font-semibold" title="Idea & Innovation">Idea</th>
                <th className="px-2 font-semibold" title="Functionality & Implementation">Func.</th><th className="px-2 font-semibold">UI/UX</th>
                <th className="px-2 font-semibold" title="Presentation & Understanding">Pres.</th><th className="px-2 font-semibold">Total</th></tr></thead>
              <tbody>
                {evals.map((e) => (
                  <tr key={e.judge_id} className="border-t border-slate-200">
                    <td className="py-1.5 pr-2">{e.judge}{!e.active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}</td>
                    <td className="px-2 tnum">{e.idea}</td><td className="px-2 tnum">{e.functionality}</td>
                    <td className="px-2 tnum">{e.uiux}</td><td className="px-2 tnum">{e.presentation}</td>
                    <td className="px-2 font-semibold tnum">{e.total}</td>
                  </tr>
                ))}
                {evals.length === 0 && <tr><td colSpan={6} className="py-3 text-slate-500">No evaluations yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
