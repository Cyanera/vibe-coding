import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import { getKey, getToken, setKey, setToken } from '../lib/judgeSession'
import type { LoginList } from '../lib/types'
import { Button, ErrorBox, Spinner, useUi } from '../components/ui'

export default function Welcome() {
  const nav = useNavigate()
  const loc = useLocation()
  const { confirm } = useUi()
  const [params] = useSearchParams()
  const expired = (loc.state as { expired?: boolean } | null)?.expired
  const [key, setKeyState] = useState<string | null>(() => params.get('k') ?? getKey())
  const [list, setList] = useState<LoginList | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(expired ? 'Your session expired. Please enter your name again.' : null)

  // Keep the key, then remove it from the address bar.
  useEffect(() => {
    const k = params.get('k')
    if (k) { setKey(k); nav('/', { replace: true }) }
  }, [params, nav])
  useEffect(() => { if (getToken()) nav('/judge', { replace: true }) }, [nav])

  const load = () => {
    if (!key) return
    setLoadErr(null)
    api.listLoginJudges(key).then((l) => { setList(l); if (!l.valid) setKey(null) }).catch((e: Error) => setLoadErr(e.message))
  }
  useEffect(load, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase()
    if (!q || !list) return []
    return list.judges.filter((j) => j.name.toLowerCase().includes(q) && j.name.toLowerCase() !== q).slice(0, 5)
  }, [name, list])

  async function signIn(typed: string, create = false) {
    if (!key || busy || !typed.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await api.judgeLogin(key, typed, create)
      if (r.ok) { setToken(r.token); nav('/judge', { replace: true }); return }
      if (r.reason === 'bad_key') { setKey(null); setKeyState(null); setList(null); return }
      if (r.reason === 'confirm_new') {
        setBusy(false)
        const ok = await confirm({
          title: 'Name not found',
          message: <>“<b>{typed.trim()}</b>” is not on the judges list. If you are already registered, cancel and tap your name from the suggestions. Otherwise create a new judge profile with this name.</>,
          confirmLabel: 'Create new profile',
        })
        if (ok) await signIn(typed, true)
        return
      }
      setErr(r.error)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed.')
    } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void signIn(name) }

  const invalid = !key || (list && !list.valid)
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-10 safe-t">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">University of Jeddah</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy">Vibe Coding Exhibition</h1>
        <p className="mt-1 text-lg italic text-slate-500">Project Evaluation Portal</p>
      </header>

      <section className="mt-10 flex-1">
        {invalid ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="font-semibold">{key ? 'This link is no longer valid.' : 'This portal is for invited judges only.'}</p>
            <p className="mt-2 text-sm text-slate-500">Please open the private link you received from the organizers, or ask them for a new one.</p>
          </div>
        ) : loadErr ? (
          <div className="space-y-3"><ErrorBox>{loadErr}</ErrorBox><Button variant="secondary" onClick={load}>Try again</Button></div>
        ) : !list ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <label htmlFor="name" className="block text-sm font-semibold text-slate-600">Your name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80}
                     autoComplete="name" autoCorrect="off" placeholder="e.g. Dr. Sara Alharbi"
                     className="mt-1 h-14 w-full rounded-xl border border-slate-300 px-4 text-lg font-semibold outline-none focus:border-navy focus:ring-2 focus:ring-navy/20" />
              {suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggestions">
                  {suggestions.map((s) => (
                    <button key={s.id} type="button" onClick={() => void signIn(s.name)}
                            className="min-h-11 rounded-full border border-slate-300 bg-navy-50 px-4 text-sm font-semibold text-navy active:bg-white">
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">Use the same name every time (any device) to continue where you left off.</p>
            </div>
            {err && <ErrorBox>{err}</ErrorBox>}
            <Button size="lg" className="w-full" disabled={busy || !name.trim()}>{busy ? <Spinner /> : 'Continue'}</Button>
          </form>
        )}
      </section>

      <footer className="pt-10 text-center">
        <Link to="/admin" className="text-sm text-slate-400 underline-offset-2 hover:underline">Administrator sign in</Link>
      </footer>
    </main>
  )
}
