import { useCallback, useEffect, useRef, useState } from 'react'

/** Loads `fn` immediately and then every `ms` while the tab is visible. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const d = await fnRef.current()
      if (!alive.current) return
      setData(d)
      setError(null)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    if (!enabled) return
    void refresh()
    const id = setInterval(() => { if (!document.hidden) void refresh() }, ms)
    const onVis = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive.current = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms, enabled, refresh])

  return { data, error, loading, refresh, setData }
}
