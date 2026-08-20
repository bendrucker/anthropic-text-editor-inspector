import pipelineReview from '@/content/pipeline-review.md?raw'
import trailConditions from '@/content/trail-conditions.md?raw'
import nightSkyLog from '@/content/night-sky-log.md?raw'
import apiMigration from '@/content/api-migration.md?raw'
import reefSurvey from '@/content/reef-survey.md?raw'
import letterpress from '@/content/letterpress.md?raw'

export interface LibraryDocument {
  id: string
  title: string
  /** What this document puts the matcher and the apply paths through. */
  description: string
  markdown: string
  /** Edits that read naturally against this document and are not traps. */
  prompts: string[]
}

/**
 * Each document leans on a different part of the Markdown surface, because the
 * apply path depends on what the match lands inside. Prose streams character by
 * character, while anything crossing Markdown syntax is replaced whole.
 *
 * Ambiguity traps are not listed here. They are derived per document by
 * `deriveTraps`, so they stay true for generated documents too.
 */
export const SAMPLES: LibraryDocument[] = [
  {
    id: 'trail-conditions',
    title: 'Trail Conditions',
    description: 'Nested lists, where an edit inside a list item crosses Markdown syntax.',
    markdown: trailConditions.trimEnd(),
    prompts: [
      'The Upper Basin note buries the reroute. Lead with it.',
      'Tighten the Work Priorities section.',
    ],
  },
  {
    id: 'pipeline-review',
    title: 'Q3 Pipeline Review',
    description: 'Dense tables and figures, where column padding makes exact matching unforgiving.',
    markdown: pipelineReview.trimEnd(),
    prompts: [
      'Tighten the executive summary. Less hedging.',
      'The EMEA paragraph buries the slipped deal. Lead with it.',
    ],
  },
  {
    id: 'night-sky-log',
    title: 'Observing Log',
    description: 'Blockquotes and links, whose inline syntax the serializer has to preserve.',
    markdown: nightSkyLog.trimEnd(),
    prompts: [
      'Make the closing notes more decisive.',
      'Trim the hedging from the Conditions section.',
    ],
  },
  {
    id: 'api-migration',
    title: 'API Migration Note',
    description: 'Fenced code blocks in four languages, where whitespace inside the fence is exact.',
    markdown: apiMigration.trimEnd(),
    prompts: [
      'Explain why the 207 case is the one clients get wrong.',
      'Tighten the Timeline section.',
    ],
  },
  {
    id: 'reef-survey',
    title: 'Reef Survey',
    description: 'Three tables, where a single-cell edit re-pads its whole column.',
    markdown: reefSurvey.trimEnd(),
    prompts: [
      'Lead the recommendation with the seventh station.',
      'Tighten the temperature paragraph.',
    ],
  },
  {
    id: 'letterpress',
    title: 'Monotype Casting',
    description: 'Long prose and headings, with no tables to complicate the match.',
    markdown: letterpress.trimEnd(),
    prompts: [
      'Tighten the opening section.',
      'The closing section hedges. Make it direct.',
    ],
  },
]

/** The app opens here, on the sample with the least to read before the first edit. */
export const DEFAULT_DOCUMENT = SAMPLES[0]

export function findDocument(id: string): LibraryDocument | undefined {
  return SAMPLES.find((document) => document.id === id)
}
