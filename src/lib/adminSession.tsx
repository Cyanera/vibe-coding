import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import * as api from './api'
import { ApiError } from './api'
import { usePoll } from './usePoll'
import type { Overview } from './types'
import { Button, ErrorBox, FullSpinner, Spinner } from '../components/ui'

type Ctx = { ov: Overview; refresh: () => Promise<void>; offline: boolean; signOut: () => Promise<void> }
const AdminCtx = createContext<Ctx | null>(null)
export const useAdmin = () => {
  const c = useContext(AdminCtx)
  if (!c) throw new Error('AdminGate missing')
  return c
}

export function AdminGate({ children, pollMs = 4000 }: { children: ReactNode; pollMs?: number }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <FullSpinner />
  if (!session) return <AdminLogin />
  return <Authed pollMs={pollMs}>{children}</Authed>
}

function Authed({ children, pollMs }: { children: ReactNode; pollMs: number }) {
  const { data, error, loading, refresh } = usePoll(api.adminOverview, pollMs)
  const signOut = async () => { await api.adminSignOut() }

  if (error instanceof ApiError && error.forbidden) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <ErrorBox>This account is signed in but is not an administrator.</ErrorBox>
        <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
      </main>
    )
  }
  if (!data) {
    if (loading) return <FullSpinner label="Loading dashboard…" />
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <ErrorBox>{error?.message ?? 'Could not load the dashboard.'}</ErrorBox>
        <div className="flex gap-2">
          <Button onClick={() => void refresh()}>Try again</Button>
          <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </main>
    )
  }
  return <AdminCtx.Provider value={{ ov: data, refresh, offline: Boolean(error), signOut }}>{children}</AdminCtx.Provider>
}

function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try { await api.adminSignIn(email.trim(), password) }
    catch (x) { setErr(x instanceof Error ? x.message : 'Sign-in failed.') }
    finally { setBusy(false) }
  }
  const field = 'mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 outline-none focus:border-navy focus:ring-2 focus:ring-navy/20'
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold text-navy">Administrator sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Vibe Coding Exhibition</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm font-semibold text-slate-600">Email
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-semibold text-slate-600">Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
        {err && <ErrorBox>{err}</ErrorBox>}
        <Button className="w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</Button>
      </form>
      <Link to="/" className="mt-8 text-center text-sm text-slate-400 hover:underline">‹ Judge sign in</Link>
    </main>
  )
}
