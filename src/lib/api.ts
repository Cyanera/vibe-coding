import { supabase } from './supabase'
import type {
  ExportRow, JudgeState, LoginJudge, LoginResult, Overview, ProjectEvaluation,
} from './types'

export class ApiError extends Error {
  code: string
  network: boolean
  constructor(message: string, code = '', network = false) {
    super(message)
    this.code = code
    this.network = network
  }
  /** Judge session missing/expired (Postgres 28000). */
  get sessionExpired() { return this.code === '28000' }
  /** Signed in, but not an administrator (Postgres 42501). */
  get forbidden() { return this.code === '42501' }
}

function toApiError(e: { message?: string; code?: string } | null): ApiError {
  const msg = e?.message ?? 'Unknown error'
  const code = e?.code ?? ''
  const network = !code && /fetch|network|load failed|failed to|timeout/i.test(msg)
  if (network) return new ApiError('No connection to the server. Check your network and try again.', '', true)
  if (code === '42501' || /permission denied/i.test(msg)) return new ApiError('Not authorized.', '42501')
  return new ApiError(msg, code)
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res
  try {
    res = await supabase.rpc(fn, args)
  } catch (e) {
    throw toApiError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw toApiError(res.error)
  return res.data as T
}

// ---- judges ------------------------------------------------------------
export const listLoginJudges = () => rpc<LoginJudge[]>('list_login_judges')
export const judgeLogin = (judgeId: string, code: string) =>
  rpc<LoginResult>('judge_login', { p_judge_id: judgeId, p_code: code })
export const judgeLogout = (token: string) => rpc<void>('judge_logout', { p_token: token })
export const judgeState = (token: string) => rpc<JudgeState>('judge_state', { p_token: token })
export const judgeSave = (token: string, projectId: string, s: { idea: number; functionality: number; uiux: number; presentation: number }) =>
  rpc<NonNullable<JudgeState['projects'][number]['evaluation']>>('judge_save', {
    p_token: token, p_project: projectId,
    p_idea: s.idea, p_functionality: s.functionality, p_uiux: s.uiux, p_presentation: s.presentation,
  })

// ---- admin -------------------------------------------------------------
export const adminOverview = () => rpc<Overview>('admin_overview')
export const adminProjectEvaluations = (id: string) => rpc<ProjectEvaluation[]>('admin_project_evaluations', { p_project: id })
export const adminExport = () => rpc<ExportRow[]>('admin_export')
export const adminSaveProject = (id: string | null, number: number, name: string) =>
  rpc<{ id: string }>('admin_save_project', { p_id: id, p_number: number, p_name: name })
export const adminDeleteProject = (id: string) => rpc<void>('admin_delete_project', { p_id: id })
export const adminCreateJudge = (name: string) => rpc<{ id: string; code: string }>('admin_create_judge', { p_name: name })
export const adminUpdateJudge = (id: string, name: string, active: boolean) =>
  rpc<void>('admin_update_judge', { p_id: id, p_name: name, p_active: active })
export const adminResetCode = (id: string) => rpc<{ id: string; code: string }>('admin_reset_judge_code', { p_id: id })
export const adminSetJudging = (open: boolean) => rpc<void>('admin_set_judging', { p_open: open })
export const adminSetReveal = (count: number) => rpc<void>('admin_set_reveal', { p_count: count })
export const adminResolveTie = (award: string, winner: string, note: string) =>
  rpc<void>('admin_resolve_tie', { p_award: award, p_winner: winner, p_note: note })
export const adminClearTie = (award: string) => rpc<void>('admin_clear_tie', { p_award: award })
export const adminFinalize = () => rpc<void>('admin_finalize')
export const adminReopen = () => rpc<void>('admin_reopen')

export async function adminSignIn(email: string, password: string) {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new ApiError(error.message, 'auth')
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw toApiError({ message: e instanceof Error ? e.message : String(e) })
  }
}
export const adminSignOut = () => supabase.auth.signOut()
