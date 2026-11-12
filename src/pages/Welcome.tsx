import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { getToken, setToken } from '../lib/judgeSession'
import type { LoginJudge } from '../lib/types'
import { Button, ErrorBox, Spinner } from '../components/ui'

export default function Welcome() {
  const nav = useNavigate()
  const loc = useLocation()
  const expired = (loc.state as { expired?: boolean } | null)?.expired
  const [judges, setJudges] = useState<LoginJudge[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<LoginJudge | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(expired ? 'Your session expired. Please sign in again.' : null)

  useEffect(() => { if (getToken()) nav('/judge', { replace: true }) }, [nav])
  const load = () => {
    setLoadErr(null)
    api.listLoginJudges().then(setJudges).catch((e: Error) => setLoadErr(e.message))
  }
  useEffect(load, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!picked || busy || !code.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await api.judgeLogin(picked.id, code)
      if (!r.ok) { setErr(r.error); setCode(''); return }
      setToken(r.token)
      nav('/judge', { replace: true })
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Sign-in failed.')
    } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-10 safe-t">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">University of Jeddah</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy">Vibe Coding Exhibition</h1>
        <p className="mt-1 text-lg italic text-slate-500">Project Evaluation Portal</p>
      </header>

      <section className="mt-10 flex-1">
        {!picked ? (
          <>
            <h2 className="mb-3 text-sm font-semibold text-slate-600">Select your name</h2>
            {loadErr && (
              <div className="space-y-3"><ErrorBox>{loadErr}</ErrorBox><Button variant="secondary" onClick={load}>Try again</Button></div>
            )}
            {!judges && !loadErr && <div className="flex justify-center py-8"><Spinner /></div>}
            {judges?.length === 0 && <p className="text-slate-500">No judges are available yet.</p>}
            <div className="space-y-3">
              {judges?.map((j) => (
                <button key={j.id} onClick={() => { setPicked(j); setErr(null); setCode('') }}
                        className="flex min-h-[4.5rem] w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 text-left text-lg font-semibold shadow-sm active:bg-navy-50">
                  {j.name}<span aria-hidden className="text-2xl text-slate-300">›</span>
                </button>
              ))}
            </div>
            {err && <div className="mt-4"><ErrorBox>{err}</ErrorBox></div>}
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <button type="button" onClick={() => { setPicked(null); setErr(null) }} className="text-sm font-semibold text-navy">‹ Change name</button>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Signing in as</p>
              <p className="text-xl font-semibold">{picked.name}</p>
              <label htmlFor="code" className="mt-5 block text-sm font-semibold text-slate-600">Access code</label>
              <input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus
                     autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                     placeholder="XXXX-XXXX"
                     className="mt-1 h-14 w-full rounded-xl border border-slate-300 px-4 text-center text-2xl font-semibold uppercase tracking-widest outline-none focus:border-navy focus:ring-2 focus:ring-navy/20" />
            </div>
            {err && <ErrorBox>{err}</ErrorBox>}
            <Button size="lg" className="w-full" disabled={busy || !code.trim()}>{busy ? <Spinner /> : 'Sign in'}</Button>
          </form>
        )}
      </section>

      <footer className="pt-10 text-center">
        <Link to="/admin" className="text-sm text-slate-400 underline-offset-2 hover:underline">Administrator sign in</Link>
      </footer>
    </main>
  )
}
