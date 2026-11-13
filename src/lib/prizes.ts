import type { AwardKey } from './types'

// Prize per place, in Saudi riyals.
export const PRIZES: Record<AwardKey, number> = { first: 300, second: 200, third: 100 }
export const prizeLabel = (k: AwardKey) => `${PRIZES[k]} SAR`
