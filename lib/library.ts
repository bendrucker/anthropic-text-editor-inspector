import { getSchema } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import pipelineReview from '@/content/pipeline-review.md?raw'
import trailConditions from '@/content/trail-conditions.md?raw'
import nightSkyLog from '@/content/night-sky-log.md?raw'
import apiMigration from '@/content/api-migration.md?raw'
import reefSurvey from '@/content/reef-survey.md?raw'
import letterpress from '@/content/letterpress.md?raw'
import canneryRecords from '@/content/cannery-records.md?raw'
import { documentExtensions, parse } from './markdown'
import { resolveTarget } from './positions'
import { locateEdit } from './str-replace'

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
 * A prompt that quotes a short run of prose, so the `old_str` it steers toward
 * lands inside one paragraph's plain text and the edit streams in character by
 * character. Every other prompt here asks for a section rewrite, whose match
 * crosses Markdown syntax and replaces the block whole.
 */
interface LeadPrompt {
  /** The run of prose the prompt quotes, verified unique and inline. */
  target: string
  prompt: string
}

interface DocumentSpec extends Omit<LibraryDocument, 'prompts'> {
  /** Offered first, so the streaming path is one click from a cold start. */
  lead: LeadPrompt
  /** Section rewrites, which land on the reparse path. */
  prompts: string[]
}

const schema = getSchema(documentExtensions)

/**
 * Checks the lead prompt against the same matcher and the same position mapping
 * the app runs, and throws rather than degrading. A quoted run that has drifted
 * out of the document, or that now spans Markdown syntax, would turn the first
 * click into a whole-document reparse, which is the outcome the lead prompt
 * exists to avoid, and it would do so silently.
 *
 * What this cannot check is the model's choice of `old_str`. The guarantee is
 * that the run the prompt quotes is there, is unique, and streams when matched.
 */
function verified(spec: DocumentSpec): LibraryDocument {
  const { lead, prompts, ...document } = spec

  const outcome = locateEdit(document.markdown, lead.target)
  if (!outcome.ok) {
    throw new Error(`${document.id}: lead prompt quotes "${lead.target}". ${outcome.message}`)
  }

  const parsed = Node.fromJSON(schema, parse(document.markdown))
  const { kind } = resolveTarget(parsed, document.markdown, outcome.matches[0])
  if (kind !== 'inline') {
    throw new Error(
      `${document.id}: "${lead.target}" resolves to ${kind}, so the lead edit would not stream.`,
    )
  }

  return { ...document, prompts: [lead.prompt, ...prompts] }
}

/**
 * Each document leans on a different part of the Markdown surface, because the
 * apply path depends on what the match lands inside. Prose streams character by
 * character, while anything crossing Markdown syntax is replaced whole. Every
 * document leads with a prompt that takes the first path and follows it with
 * rewrites that take the second, so the two are one click apart.
 *
 * Ambiguity traps are not listed here. They are derived per document by
 * `deriveTraps`, so they stay true for generated documents too.
 */
const SPECS: DocumentSpec[] = [
  {
    id: 'trail-conditions',
    title: 'Trail Conditions',
    description: 'Nested lists, where an edit inside a list item crosses Markdown syntax.',
    markdown: trailConditions.trimEnd(),
    lead: {
      target: 'a crew of six',
      prompt: 'In Work Priorities, replace "a crew of six" with "a crew of eight".',
    },
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
    lead: {
      target: 'held steady at 91%',
      prompt: 'In the executive summary, replace "held steady at 91%" with "held steady at 92%".',
    },
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
    lead: {
      target: 'within about ninety seconds',
      prompt: 'Replace "within about ninety seconds" with "within about two minutes".',
    },
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
    lead: {
      target: 'the first of next month',
      prompt: 'In the Timeline, replace "the first of next month" with "October 1".',
    },
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
    lead: {
      target: 'the obvious first explanation',
      prompt: 'Replace "the obvious first explanation" with "the likeliest explanation".',
    },
    prompts: [
      'Lead the recommendation with the seventh station.',
      'Tighten the temperature paragraph.',
    ],
  },
  {
    id: 'letterpress',
    title: 'Monotype Casting',
    description: 'Headings and paragraphs and nothing else, where every match lands in inline text.',
    markdown: letterpress.trimEnd(),
    lead: {
      target: 'within about a decade',
      prompt: 'Replace "within about a decade" with "within about fifteen years".',
    },
    prompts: [
      'Tighten the opening section.',
      'The closing section hedges. Make it direct.',
    ],
  },
  {
    id: 'cannery-records',
    title: 'Cannery Records',
    description: 'Plain prose at three times the length of the rest, where the match sits off screen.',
    markdown: canneryRecords.trimEnd(),
    lead: {
      target: "four months of one archivist's time",
      prompt:
        'In Outstanding Work, replace "four months of one archivist\'s time" with "six months of one archivist\'s time".',
    },
    prompts: [
      'Tighten the Appraisal section.',
      'The Condition on Arrival section buries the mold. Lead with it.',
    ],
  },
]

/** Verified on load, so a lead prompt that no longer resolves is never offered. */
export const SAMPLES: LibraryDocument[] = SPECS.map(verified)

/** The app opens here, on the sample with the least to read before the first edit. */
export const DEFAULT_DOCUMENT = SAMPLES[0]

export function findDocument(id: string): LibraryDocument | undefined {
  return SAMPLES.find((document) => document.id === id)
}
