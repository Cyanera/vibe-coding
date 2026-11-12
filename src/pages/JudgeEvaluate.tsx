import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useJudge } from '../lib/judgeSession'
import { CRITERIA, MAX_TOTAL, SCORES } from '../lib/criteria'
import { pad2, projectLabel } from '../lib/format'
import type { CriterionKey, Scores } from '../lib/types'
import { Button, ErrorBox, Spinner, useUi } from '../components/ui'

export default function JudgeEvaluate() {
  const { number } = useParams()
  const { state } = useJudge()
  const project = state.projects.find((p) => p.number === Number(number))
  if (!project) return <Navigate to="/judge" replace />
  // key => fresh draft state for each project
  return <Evaluate key={project.id} projectId={project.id} />
}

function Evaluate({ projectId }: { projectId: string }) {
  const { token, state, setEvaluation, handleAuthError } = useJudge()
  const { toast } = useUi()
  const nav = useNavigate()
  const project = state.projects.find((p) => p.id === projectId)!
  const existing = project.evaluation
  const locked = !state.judging_open

  // The draft lives in component state: if a save fails, nothing is lost.
  const [draft, setDraft] = useState<Partial<Scores>>(
    existing ? { idea: existing.idea, functionality: existing.functionality, uiux: existing.uiux, presentation: existing.presentation } : {},
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const chosen = CRITERIA.filter((c) => draft[c.key] !== undefined).length
  const complete = chosen === CRITERIA.length
  const sum = CRITERIA.reduce((a, c) => a + (draft[c.key] ?? 0), 0)

  function pick(key: CriterionKey, v: number) {
    if (locked) return
    setDraft((d) => ({ ...d, [key]: v }))
    setError(null)
  }

  async function save() {
    if (!complete || inFlight.current || locked) return
    inFlight.current = true            // blocks double-taps / duplicate submissions
    setSaving(true); setError(null)
    try {
      const ev = await api.judgeSave(token, project.id, draft as Scores)
      setEvaluation(project.id, ev)
      toast('success', `Saved · ${projectLabel(project.number)} · ${ev.total}/${MAX_TOTAL}`)
      const merged = state.projects.map((p) => (p.id === project.id ? { ...p, evaluation: ev } : p))
      const next = merged.find((p) => !p.evaluation && p.number > project.number) ?? merged.find((p) => !p.evaluation)
      nav(next ? `/judge/project/${next.number}` : '/judge', { replace: true })
    } catch (e) {
      if (handleAuthError(e)) return
      const msg = e instanceof Error ? e.message : 'Could not save.'
      setError(`${msg} Your scores are still here. Tap Save & Next to retry.`)
      toast('error', 'Not saved')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur safe-t">
        <Link to="/judge" className="shrink-0 py-2 pr-1 text-sm font-semibold text-navy" aria-label="Back to projects">‹ Projects</Link>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-slate-500">
            Project {pad2(project.number)}{existing ? ' · editing' : ''}
          </p>
          <h1 className="truncate text-lg font-bold leading-6 text-navy">{project.name}</h1>
        </div>
      </header>

      <main className="flex-1 space-y-2 px-3 py-2">
        {locked && <ErrorBox>Judging is closed. Scores can no longer be changed.</ErrorBox>}
        {CRITERIA.map((c) => (
          <section key={c.key} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm" aria-labelledby={`h-${c.key}`}>
            <h2 id={`h-${c.key}`} className="text-[15px] font-semibold leading-5">{c.label}</h2>
            <p className="mb-2 text-[11px] leading-[14px] text-slate-500">{c.description}</p>
            <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label={c.label}>
              {SCORES.map((v) => {
                const on = draft[c.key] === v
                return (
                  <button key={v} type="button" role="radio" aria-checked={on} disabled={locked}
                          onClick={() => pick(c.key, v)}
                          className={`h-12 rounded-xl border text-xl font-bold tnum transition-colors ${
                            on ? 'border-navy bg-navy text-white shadow-inner'
                               : 'border-slate-300 bg-white text-slate-700 active:bg-navy-50'} disabled:opacity-60`}>
                    {v}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-slate-200 bg-white px-4 pt-2 safe-b">
        {error && <div className="mb-2"><ErrorBox>{error}</ErrorBox></div>}
        <div className="flex items-center gap-3">
          <div className="min-w-[5.5rem]" aria-live="polite">
            <p className="text-2xl font-bold leading-none text-navy tnum" data-testid="total">{sum} / {MAX_TOTAL}</p>
            <p className="mt-1 text-xs text-slate-500">{complete ? 'All scored' : `${chosen} of 4 scored`}</p>
          </div>
          <Button size="lg" className="flex-1" onClick={() => void save()} disabled={!complete || saving || locked}>
            {saving ? <><Spinner /> Saving…</> : 'Save & Next'}
          </Button>
        </div>
      </footer>
    </div>
  )
}
