import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminGate, useAdmin } from '../lib/adminSession'
import * as api from '../lib/api'
import { projectLabel } from '../lib/format'

export default function Present() {
  return <AdminGate pollMs={2000}><Stage /></AdminGate>
}

const LABELS = ['Best Overall Project', 'Best Innovative Idea', 'Best UI/UX Design']

function Stage() {
  const { ov, refresh } = useAdmin()
  const nav = useNavigate()
  const [controls, setControls] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const busy = useRef(false)
  const { finalized, reveal_count: shown } = ov.settings

  const set = useCallback(async (n: number) => {
    if (busy.current) return
    busy.current = true
    try { await api.adminSetReveal(Math.max(0, Math.min(3, n))); setError(null); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { busy.current = false }
  }, [refresh])

  useEffect(() => {
    const wake = () => {
      setControls(true)
      clearTimeout(idle.current)
      idle.current = setTimeout(() => setControls(false), 3500)
    }
    const key = (e: KeyboardEvent) => {
      wake()
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); void set(shown + 1) }
      else if (['ArrowLeft', 'Backspace', 'PageUp'].includes(e.key)) { e.preventDefault(); void set(shown - 1) }
      else if (e.key === 'Escape' && !document.fullscreenElement) nav('/admin?tab=winners')
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('touchstart', wake)
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(idle.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('touchstart', wake)
      window.removeEventListener('keydown', key)
    }
  }, [set, shown, nav])

  if (!finalized) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-navy p-8 text-center text-white">
        <p className="text-xl">Presentation Mode is available after results are finalized.</p>
        <Link to="/admin?tab=winners" className="rounded-xl bg-white px-5 py-3 font-semibold text-navy">Back to dashboard</Link>
      </main>
    )
  }

  return (
    <main className={`fixed inset-0 flex flex-col overflow-y-auto bg-navy text-white ${controls ? '' : 'cursor-none'}`}>
      <header className="px-6 pt-10 text-center md:pt-14">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70 md:text-xl">University of Jeddah</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-7xl">Vibe Coding Exhibition</h1>
        <p className="mt-3 text-xl text-white/70 md:text-3xl">Competition Winners</p>
      </header>

      <section className="mx-auto grid w-full max-w-7xl flex-1 content-center gap-6 px-6 py-10 md:grid-cols-3">
        {LABELS.map((label, i) => {
          const f = ov.final.find((x) => x.key === (['overall', 'innovation', 'uiux'] as const)[i])
          const revealed = i < shown && f
          return (
            <article key={label} data-testid={`slot-${i + 1}`}
                     className={`flex min-h-56 flex-col items-center justify-center rounded-3xl border px-6 py-10 text-center transition-opacity duration-500 md:min-h-80 ${
                       revealed ? 'border-white/40 bg-white/10 opacity-100' : 'border-white/10 bg-white/[0.03] opacity-60'}`}>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70 md:text-lg">Award {i + 1}</p>
              <h2 className="mt-2 text-2xl font-bold md:text-3xl">{label}</h2>
              {revealed ? (
                <div className="mt-8">
                  <p className="text-base uppercase tracking-widest text-white/60 md:text-xl">{projectLabel(f.number)}</p>
                  <p className="mt-2 text-4xl font-extrabold leading-tight md:text-5xl" data-testid={`reveal-${i + 1}`}>{f.name}</p>
                </div>
              ) : (
                <p className="mt-8 text-5xl tracking-[0.4em] text-white/20" aria-label="Not yet revealed">• • •</p>
              )}
            </article>
          )
        })}
      </section>

      <div className={`fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 bg-black/50 p-3 transition-opacity safe-b ${controls ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <button onClick={() => void set(shown - 1)} disabled={shown === 0} className="h-11 rounded-xl border border-white/30 px-4 font-semibold disabled:opacity-30">‹ Hide last</button>
        <button onClick={() => void set(shown + 1)} disabled={shown >= 3} className="h-11 rounded-xl bg-white px-6 font-semibold text-navy disabled:opacity-30">
          {shown >= 3 ? 'All winners revealed' : `Reveal ${LABELS[shown]}`}
        </button>
        <button onClick={() => void set(0)} disabled={shown === 0} className="h-11 rounded-xl border border-white/30 px-4 font-semibold disabled:opacity-30">Reset</button>
        <button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.() }}
                className="h-11 rounded-xl border border-white/30 px-4 font-semibold">Full screen</button>
        <Link to="/admin?tab=winners" className="inline-flex h-11 items-center rounded-xl border border-white/30 px-4 font-semibold">Exit</Link>
        <span className="w-full text-center text-xs text-white/50">Space / → reveal next · ← hide last · Esc exit{error ? ` · ${error}` : ''}</span>
      </div>
    </main>
  )
}
