import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import * as api from './api'
import { ApiError } from './api'
import type { Evaluation, JudgeState } from './types'
import { ErrorBox, FullSpinner, Button } from '../components/ui'

// Only the opaque session token lives in the browser. Evaluations live in the database.
const KEY = 'vibe.judge.token'
export const getToken = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const setToken = (t: string | null) => {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch { /* private mode */ }
}

// The private link key (from ?k=...) is remembered so a refresh or an expired session needs no new link.
const KEY_K = 'vibe.judge.key'
export const getKey = () => { try { return localStorage.getItem(KEY_K) } catch { return null } }
export const setKey = (k: string | null) => {
  try { if (k) localStorage.setItem(KEY_K, k); else localStorage.removeItem(KEY_K) } catch { /* private mode */ }
}

type Ctx = {
  token: string
  state: JudgeState
  refresh: () => Promise<void>
  setEvaluation: (projectId: string, ev: Evaluation) => void
  signOut: () => Promise<void>
  handleAuthError: (e: unknown) => boolean
}
const JudgeCtx = createContext<Ctx | null>(null)
export const useJudge = () => {
  const c = useContext(JudgeCtx)
  if (!c) throw new Error('JudgeProvider missing')
  return c
}

export function JudgeLayout() {
  const token = getToken()
  const nav = useNavigate()
  const [state, setState] = useState<JudgeState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const expire = useCallback(() => {
    setToken(null)
    nav('/', { replace: true, state: { expired: true } })
  }, [nav])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      setState(await api.judgeState(token))
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.sessionExpired) expire()
      else setError(e instanceof Error ? e.message : 'Could not load projects.')
    }
  }, [token, expire])

  useEffect(() => { void refresh() }, [refresh])

  const ctx = useMemo<Ctx | null>(() => {
    if (!token || !state) return null
    return {
      token, state, refresh,
      setEvaluation: (projectId, ev) =>
        setState((s) => s && ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? { ...p, evaluation: ev } : p)) })),
      signOut: async () => { try { await api.judgeLogout(token) } catch { /* ignore */ } setToken(null); nav('/', { replace: true }) },
      handleAuthError: (e) => { if (e instanceof ApiError && e.sessionExpired) { expire(); return true } return false },
    }
  }, [token, state, refresh, nav, expire])

  if (!token) return <Navigate to="/" replace />
  if (!ctx) {
    return error ? (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <ErrorBox>{error}</ErrorBox>
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    ) : <FullSpinner label="Loading projects…" />
  }
  return <JudgeCtx.Provider value={ctx}><Outlet /></JudgeCtx.Provider>
}
