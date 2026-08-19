/**
 * The record a run leaves behind.
 *
 * Two streams get interleaved: what arrived on the wire, and what this app
 * decided in response. The mapping between them is the part worth reading, so
 * neither is useful alone.
 */

export type TimelineSource = 'wire' | 'app'

export interface TimelineEntry {
  id: string
  atMs: number
  source: TimelineSource
  label: string
  detail?: string
  /** The raw `input_json_delta` fragment, before it is valid JSON. */
  raw?: string
  /** Document positions this entry touched, for highlighting on click. */
  range?: { from: number; to: number }
  tone?: 'normal' | 'good' | 'bad'
}

/** The scan state of one tool block's accumulated buffer, as of the last fragment. */
export interface BufferState {
  toolUseId: string
  buffer: string
  oldStr?: string
  oldStrComplete: boolean
  newStr?: string
  newStrComplete: boolean
  fragments: number
}
