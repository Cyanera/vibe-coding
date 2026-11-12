import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react'

// ---- Button -----------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-700 disabled:bg-slate-300 disabled:text-slate-500',
  secondary: 'bg-white text-navy border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-bad text-white hover:bg-red-800 disabled:bg-slate-300',
  ghost: 'text-navy hover:bg-navy-50 disabled:text-slate-400',
}
export function Button({
  variant = 'primary', size = 'md', className = '', ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'h-14 px-6 text-lg' : size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-base'
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${className}`}
    />
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-navy ${className}`}
    />
  )
}
export const FullSpinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex min-h-dvh items-center justify-center gap-3 text-slate-500"><Spinner />{label}</div>
)

export function ProgressBar({ value, max, className = '' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className={`h-3 w-full overflow-hidden rounded-full bg-slate-200 ${className}`} role="progressbar"
         aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Chip({ tone = 'slate', children }: { tone?: 'slate' | 'ok' | 'warn' | 'bad' | 'navy'; children: ReactNode }) {
  const t = {
    slate: 'bg-slate-100 text-slate-600', ok: 'bg-ok-50 text-ok', warn: 'bg-warn-50 text-warn',
    bad: 'bg-bad-50 text-bad', navy: 'bg-navy-50 text-navy',
  }[tone]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${t}`}>{children}</span>
}

export const ErrorBox = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="rounded-xl border border-red-200 bg-bad-50 px-4 py-3 text-sm text-bad">{children}</div>
)

// ---- Toasts + confirm dialog -----------------------------------------
type Toast = { id: number; kind: 'success' | 'error'; text: string }
type ConfirmOpts = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }
type Ctx = {
  toast: (kind: Toast['kind'], text: string) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
}
const UiCtx = createContext<Ctx | null>(null)
export const useUi = () => {
  const c = useContext(UiCtx)
  if (!c) throw new Error('UiProvider missing')
  return c
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 1800)
  }, [])
  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    [],
  )
  const close = (v: boolean) => { dialog?.resolve(v); setDialog(null) }

  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-3 safe-t" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id}
               className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${t.kind === 'success' ? 'bg-ok text-white' : 'bg-bad text-white'}`}>
            {t.text}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={dialog.title}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">{dialog.title}</h2>
            <div className="mt-2 text-sm text-slate-600">{dialog.message}</div>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => close(false)}>Cancel</Button>
              <Button variant={dialog.danger ? 'danger' : 'primary'} className="flex-1" onClick={() => close(true)} autoFocus>
                {dialog.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </UiCtx.Provider>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-3">{children}</div>
        <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}
