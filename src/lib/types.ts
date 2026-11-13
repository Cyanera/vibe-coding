export type Scores = { idea: number; functionality: number; uiux: number; presentation: number }
export type CriterionKey = keyof Scores
export type Evaluation = Scores & { total: number; updated_at: string }

export type JudgeProject = { id: string; number: number; name: string; evaluation: Evaluation | null }
export type JudgeState = {
  judge: { id: string; name: string }
  judging_open: boolean
  projects: JudgeProject[]
}
export type LoginJudge = { id: string; name: string }
export type LoginList = { valid: boolean; allow_new: boolean; judges: LoginJudge[] }
export type LoginResult =
  | { ok: true; token: string; judge: LoginJudge }
  | { ok: false; error: string; reason: 'bad_key' | 'empty' | 'inactive' | 'unknown' | 'confirm_new' | 'closed' }

export type AwardKey = 'first' | 'second' | 'third'
export type Candidate = { project_id: string; number: number; name: string; score: number }
export type Award = {
  key: AwardKey
  label: string
  max: number
  status: 'winner' | 'tie' | 'blocked' | 'none'
  winner: Candidate | null
  candidates: Candidate[]
  tie_resolved: boolean
  note: string | null
}
export type FinalAward = {
  key: AwardKey
  project_id: string
  number: number
  name: string
  score: number
  tie_resolved: boolean
  note: string | null
}
export type ProjectStat = {
  id: string
  number: number
  name: string
  n: number
  avg_total: number | null
  avg_idea: number | null
  avg_func: number | null
  avg_uiux: number | null
  avg_pres: number | null
  rank: number | null
}
export type JudgeRow = { id: string; name: string; active: boolean; completed: number }
export type Overview = {
  settings: { judging_open: boolean; finalized: boolean; reveal_count: number; access_key: string; allow_new_judges: boolean }
  totals: { projects: number; judges: number; expected: number; completed: number }
  complete: boolean
  ready_to_finalize: boolean
  awards: Award[]
  final: FinalAward[]
  projects: ProjectStat[]
  judges: JudgeRow[]
}
export type ProjectEvaluation = Scores & {
  judge_id: string
  judge: string
  active: boolean
  total: number
  updated_at: string
}
export type ExportRow = Scores & {
  project_number: number
  project: string
  judge: string
  judge_active: boolean
  total: number
  updated_at: string
}
