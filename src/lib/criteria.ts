import type { CriterionKey } from './types'

export const CRITERIA: { key: CriterionKey; label: string; description: string }[] = [
  { key: 'idea', label: 'Idea & Innovation', description: 'Clarity, significance, and originality of the idea' },
  { key: 'functionality', label: 'Functionality & Implementation', description: 'Working features and completeness of core functionality' },
  { key: 'uiux', label: 'UI/UX Design', description: 'Visual consistency, usability, and ease of navigation' },
  { key: 'presentation', label: 'Presentation & Understanding', description: 'Clear explanation, live demonstration, and ability to answer questions' },
]
export const SCORES = [0, 1, 2, 3, 4, 5] as const
export const MAX_TOTAL = 20
