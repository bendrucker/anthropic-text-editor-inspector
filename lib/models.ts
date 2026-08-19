export interface ModelChoice {
  id: string
  label: string
  /** Fast mode is a research preview limited to the Opus 5 family. */
  supportsFast: boolean
  /** `output_config.effort` is rejected by Haiku 4.5. */
  supportsEffort: boolean
  note: string
}

export const MODELS: ModelChoice[] = [
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    supportsFast: false,
    supportsEffort: true,
    note: 'Balanced. The realistic production choice for scoped edits.',
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    supportsFast: true,
    supportsEffort: true,
    note: 'Most capable, and the only family here with fast mode.',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    supportsFast: false,
    supportsEffort: false,
    note: 'Cheapest and quickest to first token. No effort control.',
  },
]

export const DEFAULT_MODEL = MODELS[0].id

export function findModel(id: string): ModelChoice | undefined {
  return MODELS.find((model) => model.id === id)
}

/**
 * `output_config.effort` caps how much reasoning the model spends before answering.
 * For a scoped edit it mostly controls how much preamble arrives ahead of the tool
 * call, which is directly visible in the latency breakdown.
 */
export interface EffortChoice {
  id: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  label: string
  note: string
}

export const EFFORTS: EffortChoice[] = [
  { id: 'auto', label: 'Auto', note: 'Send no effort setting and let the model decide.' },
  { id: 'low', label: 'Low', note: 'Go straight to the edit. Least preamble, fastest target.' },
  { id: 'medium', label: 'Medium', note: 'Some deliberation before committing to a match.' },
  { id: 'high', label: 'High', note: 'Reasons about the request first. Slower to first edit.' },
  { id: 'xhigh', label: 'Extra high', note: 'Well past what a single-paragraph edit needs.' },
  { id: 'max', label: 'Max', note: 'Deliberately excessive, to show what effort costs.' },
]

export const DEFAULT_EFFORT: EffortChoice['id'] = 'low'

export function findEffort(id: string): EffortChoice | undefined {
  return EFFORTS.find((effort) => effort.id === id)
}
