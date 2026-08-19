/**
 * Asserts that prior turns reach the request.
 *
 * Without them the model cannot answer a follow-up or its own clarifying
 * question, which looks like working chat right up until a user replies to one.
 * Stubs fetch so this runs with no API key and no network.
 */
import { runEdit, type ConversationTurn } from '@/lib/agent'
import type { AgentHandlers } from '@/lib/agent'

const requests: { messages: { role: string; content: unknown }[] }[] = []

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

globalThis.fetch = realFetch

const [first, second] = requests
const roles = (request: (typeof requests)[number]) => request.messages.map((m) => m.role).join(',')

const checks: [string, boolean][] = [
  ['a first request carries one user turn', roles(first) === 'user'],
  ['a follow-up carries the whole conversation', roles(second) === 'user,assistant,user'],
  [
    'the follow-up still carries the question it answers',
    JSON.stringify(second.messages[1]?.content ?? null).includes('Which Enterprise row?'),
  ],
  ['the reply is the last turn', second.messages.at(-1)?.content === 'the pipeline one'],
]

for (const [label, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`)

if (checks.some(([, ok]) => !ok)) process.exit(1)
