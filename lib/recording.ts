import type { AgentHandlers } from './agent'

/**
 * A run, kept so it can be watched again slowly.
 *
 * Pausing a live SSE stream would misrepresent what streaming is and force
 * buffering into the path that is supposed to be immediate. Recording every
 * handler call with its offset and replaying through the same handlers keeps
 * the live path untouched: the first run is real, the replay is a retelling.
 */
export type RecordedCall = {
  [Name in keyof AgentHandlers]: {
    atMs: number
    name: Name
    arg: Parameters<AgentHandlers[Name]>[0]
  }
}[keyof AgentHandlers]

/** Wraps handlers so every call is appended to a recording as it happens. */
export function instrument(
  handlers: AgentHandlers,
  sink: (call: RecordedCall) => void,
  clock: () => number,
): AgentHandlers {
  return {
    onText: (arg) => {
      sink({ atMs: clock(), name: 'onText', arg })
      handlers.onText(arg)
    },
    onEditStart: (arg) => {
      sink({ atMs: clock(), name: 'onEditStart', arg })
      handlers.onEditStart(arg)
    },
    onEditDelta: (arg) => {
      sink({ atMs: clock(), name: 'onEditDelta', arg })
      handlers.onEditDelta(arg)
    },
    onEditCommit: (arg) => {
      sink({ atMs: clock(), name: 'onEditCommit', arg })
      handlers.onEditCommit(arg)
    },
    onEditRejected: (arg) => {
      sink({ atMs: clock(), name: 'onEditRejected', arg })
      handlers.onEditRejected(arg)
    },
    onTurnEnd: (arg) => {
      sink({ atMs: clock(), name: 'onTurnEnd', arg })
      handlers.onTurnEnd(arg)
    },
    onDone: (arg) => {
      sink({ atMs: clock(), name: 'onDone', arg })
      handlers.onDone(arg)
    },
    onEvent: (arg) => {
      sink({ atMs: clock(), name: 'onEvent', arg })
      handlers.onEvent(arg)
    },
    onBuffer: (arg) => {
      sink({ atMs: clock(), name: 'onBuffer', arg })
      handlers.onBuffer(arg)
    },
  }
}

/** Routes one recorded call back to the handler it came from. */
export function dispatch(handlers: AgentHandlers, call: RecordedCall): void {
  switch (call.name) {
    case 'onText':
      return handlers.onText(call.arg)
    case 'onEditStart':
      return handlers.onEditStart(call.arg)
    case 'onEditDelta':
      return handlers.onEditDelta(call.arg)
    case 'onEditCommit':
      return handlers.onEditCommit(call.arg)
    case 'onEditRejected':
      return handlers.onEditRejected(call.arg)
    case 'onTurnEnd':
      return handlers.onTurnEnd(call.arg)
    case 'onDone':
      return handlers.onDone(call.arg)
    case 'onEvent':
      return handlers.onEvent(call.arg)
    case 'onBuffer':
      return handlers.onBuffer(call.arg)
  }
}
