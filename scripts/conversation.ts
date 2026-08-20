/**
 * Asserts what leaves the browser: the prior turns, and the tool declaration.
 *
 * Without the turns the model cannot answer a follow-up or its own clarifying
 * question, which looks like working chat right up until a user replies to one.
 * Stubs fetch so this runs with no API key and no network.
 */
import { runEdit, stripDanglingToolUse, type ConversationTurn } from '@/lib/agent'
import type { AgentHandlers } from '@/lib/agent'

const requests: {
  messages: { role: string; content: unknown }[]
  tools: Record<string, unknown>[]
}[] = []

const realFetch = globalThis.fetch
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  requests.push(JSON.parse(init.body))
  return new Response(JSON.stringify({ error: { message: 'stubbed' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}) as typeof globalThis.fetch

const ignore = () => {}
const handlers: AgentHandlers = {
  onText: ignore,
  onEditStart: ignore,
  onEditDelta: ignore,
  onEditCommit: ignore,
  onEditRejected: ignore,
  onDone: ignore,
  onEvent: ignore,
  onBuffer: ignore,
}

const base = { apiKey: 'sk-ant-stub', document: '# Doc\n\nHello.\n', handlers }

await runEdit({ ...base, prompt: 'raise the Enterprise figure' }).catch(() => {})

// The model answered with a question rather than an edit.
const asked: ConversationTurn[] = [
  { role: 'user', content: 'raise the Enterprise figure' },
  { role: 'assistant', content: [{ type: 'text', text: 'Which Enterprise row?' }] },
]

await runEdit({ ...base, prompt: 'the pipeline one', history: asked }).catch(() => {})

// Anthropic owns the built-in tool's schema, so the request names a version
// instead of describing one, and has nowhere to put a user-defined-tool field.
await runEdit({ ...base, prompt: 'raise it', editorTool: 'builtin' }).catch(() => {})

globalThis.fetch = realFetch

const [first, second, builtin] = requests
const roles = (request: (typeof requests)[number]) => request.messages.map((m) => m.role).join(',')

const checks: [string, boolean][] = [
  ['a first request carries one user turn', roles(first) === 'user'],
  ['a follow-up carries the whole conversation', roles(second) === 'user,assistant,user'],
  [
    'the follow-up still carries the question it answers',
    JSON.stringify(second.messages[1]?.content ?? null).includes('Which Enterprise row?'),
  ],
  ['the reply is the last turn', second.messages.at(-1)?.content === 'the pipeline one'],
  ['the built-in tool goes out by version', builtin.tools[0]?.type === 'text_editor_20250728'],
  [
    'the built-in tool carries no streaming control',
    !('eager_input_streaming' in (builtin.tools[0] ?? {})),
  ],
  ['the custom tool still asks for its input early', first.tools[0]?.eager_input_streaming === true],
]

// A turn that stopped for any reason other than tool_use can still carry a
// tool call. Persisted, it makes every later request fail as malformed.
const answered: ConversationTurn[] = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'str_replace', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
]

const dangling: ConversationTurn[] = [
  { role: 'user', content: 'edit it' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Working on it' },
      { type: 'tool_use', id: 'b', name: 'str_replace', input: {} },
    ],
  },
]

const onlyDangling: ConversationTurn[] = [
  { role: 'user', content: 'edit it' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'str_replace', input: {} }] },
]

const stripped = stripDanglingToolUse(dangling)
const assistant = stripped[1]
const assistantBlocks = typeof assistant?.content === 'string' ? [] : (assistant?.content ?? [])

checks.push(
  ['an answered tool call survives', stripDanglingToolUse(answered).length === 2],
  ['an unanswered tool call is dropped', !assistantBlocks.some((b) => b.type === 'tool_use')],
  ['the text beside it is kept', assistantBlocks.some((b) => b.type === 'text')],
  [
    'an assistant turn left empty is dropped whole',
    stripDanglingToolUse(onlyDangling).length === 1,
  ],
)

for (const [label, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`)

if (checks.some(([, ok]) => !ok)) process.exit(1)
