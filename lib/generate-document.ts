/**
 * Random documents, so the matcher can be pointed at text nobody wrote by hand.
 *
 * The output is canonical Markdown by construction: columns padded the way the
 * serializer pads them, and the blank line it puts either side of a table. A
 * document that is not a serializer fixed point silently breaks `old_str`
 * matching, so `bun run roundtrip` checks generated documents alongside the
 * checked-in ones.
 *
 * Each document deliberately repeats one label and one figure, which is what
 * gives `deriveTraps` something to find.
 */
import type { LibraryDocument } from './library'

/** Small deterministic PRNG. The seed is always explicit so a document can be reproduced. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state)
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296
  }
}

interface Domain {
  title: string
  unit: string
  intro: string
  sections: [string, string, string]
  columns: [string, string, string]
  subjects: string[]
  labels: [string, string, string]
  bullets: string[]
  code?: { language: string; lines: string[] }
}

const DOMAINS: Domain[] = [
  {
    title: 'Municipal Water Sampling',
    unit: 'site',
    intro:
      'Quarterly sampling across the distribution network. Every site was tested with the same' +
      ' method, so the readings compare directly between them.',
    sections: ['Sample Results', 'Field Notes', 'Follow-up'],
    columns: ['Site', 'Turbidity', 'Status'],
    subjects: ['Brook Street', 'Hill Reservoir', 'Old Mill', 'Fair Oaks', 'Cedar Line', 'Quarry Road'],
    labels: ['Passing', 'Watch', 'Failing'],
    bullets: [
      'Sample bottles were held below 6C in transit and logged on arrival',
      'Duplicate samples were drawn at every third site as a blank check',
      'The meter was recalibrated midway through the run after a drift warning',
      'Two sites were resampled the following morning after an inconclusive first pass',
    ],
  },
  {
    title: 'Community Garden Plots',
    unit: 'plot',
    intro:
      'End of season notes on every plot in the lower field. Yields are recorded per plot rather' +
      ' than per grower, since several plots changed hands partway through the year.',
    sections: ['Plot Summary', 'Shared Beds', 'Next Season'],
    columns: ['Plot', 'Yield', 'Status'],
    subjects: ['A1', 'A4', 'B2', 'B7', 'C3', 'C9'],
    labels: ['Renewed', 'Vacant', 'Waitlisted'],
    bullets: [
      'The shared tool shed was reorganized and every borrowed item logged on the board',
      'Drip lines were replaced along the north edge where the old tubing had split',
      'Compost was turned four times, which is twice as often as the previous season',
      'The pollinator strip along the fence was extended by roughly twelve feet',
    ],
  },
  {
    title: 'Rare Book Conservation Queue',
    unit: 'volume',
    intro:
      'Condition survey of the volumes currently held in the conservation queue. Each was assessed' +
      ' against the same rubric so the queue can be ordered by need rather than by arrival date.',
    sections: ['Condition Survey', 'Treatment Notes', 'Scheduling'],
    columns: ['Volume', 'Pages', 'Status'],
    subjects: ['Herbal, 1583', 'Atlas, 1611', 'Psalter, 1490', 'Ledger, 1702', 'Almanac, 1655', 'Chronicle, 1544'],
    labels: ['Stable', 'Fragile', 'Treated'],
    bullets: [
      'Boards were reattached with wheat starch paste and Japanese tissue hinges',
      'Two volumes need their sewing structure replaced rather than merely reinforced',
      'Surface cleaning was completed on every volume before any structural work began',
      'Enclosures were measured but not yet cut, pending the treatment decisions below',
    ],
    code: {
      language: 'text',
      lines: [
        'Stable    no intervention needed this cycle',
        'Fragile   handle with support, treat before circulation',
        'Treated   work complete, returned to the stacks',
      ],
    },
  },
  {
    title: 'Model Railway Timetable Trial',
    unit: 'service',
    intro:
      'Results from the winter timetable trial on the club layout. Each service was run five times' +
      ' from a cold start, and the recorded figure is the median rather than the best pass.',
    sections: ['Service Results', 'Operating Notes', 'Revisions'],
    columns: ['Service', 'Runtime', 'Status'],
    subjects: ['Up Express', 'Down Local', 'Pick-up Goods', 'Branch Shuttle', 'Night Mail', 'Ballast Working'],
    labels: ['Adopted', 'Trial', 'Withdrawn'],
    bullets: [
      'Point motors on the east ladder were adjusted after two derailments in the first session',
      'The branch shuttle now clears the single-line section before the express is signalled',
      'Uncoupling ramps were relocated to the goods loop where the shunting actually happens',
      'Two operators are needed for the full sequence, against one for the previous timetable',
    ],
    code: {
      language: 'yaml',
      lines: [
        'sequence:',
        '  - service: Up Express',
        '    departs: "09:12"',
        '  - service: Branch Shuttle',
        '    departs: "09:20"',
      ],
    },
  },
]

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  )
  const line = (cells: string[]) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`
  const rule = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`
  return [line(headers), rule, ...rows.map(line)].join('\n')
}

/** The serializer leaves a blank line either side of a table, so blocks carry their own. */
function spaced(block: string): string {
  return `\n${block}\n`
}

export function generateDocument(seed: number): LibraryDocument {
  const random = mulberry32(seed)
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))

  const domain = DOMAINS[seed % DOMAINS.length]
  const [sectionA, sectionB, sectionC] = domain.sections

  // The repeated label and figure are what make the derived traps possible.
  const signature = pick(domain.labels)
  const figure = `${between(11, 39)}%`
  const rowCount = between(4, 6)

  const subjects = [...domain.subjects].sort(() => random() - 0.5).slice(0, rowCount)
  const rows = subjects.map((subject, index) => [
    subject,
    domain.columns[1] === 'Pages' ? String(between(80, 420)) : `${between(2, 88)}.${between(0, 9)}`,
    // Seeding the signature into most rows guarantees it repeats enough to be ambiguous.
    index % 2 === 0 ? signature : pick(domain.labels),
  ])

  const blocks: string[] = [
    `# ${domain.title}`,
    domain.intro,
    `## ${sectionA}`,
    `Of the ${rows.length} ${domain.unit}s surveyed, the ones marked ${signature} account for` +
      ` roughly ${figure} of the total. That share has held steady across the last two rounds,` +
      ` which is the first time it has done so.`,
    spaced(table(domain.columns, rows)),
    `The ${signature} entries are not clustered in any one part of the ${domain.unit} list. That` +
      ` matters, because a clustered pattern would point at a single cause and this one does not.`,
    `## ${sectionB}`,
    domain.bullets.map((bullet) => `- ${bullet}`).join('\n'),
  ]

  if (domain.code) {
    blocks.push(
      `## ${sectionC}`,
      ['```' + domain.code.language, ...domain.code.lines, '```'].join('\n'),
      `Anything still marked ${signature} at the end of the cycle carries forward. On current` +
        ` numbers that is about ${figure} of the list, which is the same share as last time.`,
    )
  } else {
    blocks.push(
      `## ${sectionC}`,
      `The ${figure} share is the figure worth watching. It is stable rather than improving, and a` +
        ` stable ${figure} means the current approach is holding the line without gaining ground.`,
    )
  }

  return {
    id: `generated-${seed}`,
    title: `${domain.title} (seed ${seed})`,
    description: `Generated from seed ${seed}. Repeats are planted, so the traps are real.`,
    markdown: blocks.join('\n\n'),
    prompts: [`Tighten the ${sectionA} section.`, `Make the ${sectionC} section more direct.`],
  }
}
