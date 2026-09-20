import {
  applyOperations,
  seatAt,
  seatOfStudent,
  gridBounds
} from '../shared/seating'
import type { Seat, SeatingOperation, Student } from '../shared/types'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type Seat2D = { row: number; column: number }

const OPERATION_TYPES = [
  'MOVE_STUDENT',
  'SWAP_STUDENTS',
  'MOVE_TO_FRONT',
  'MOVE_TO_BACK',
  'SEPARATE_STUDENTS'
] as const

const jsonSchema = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...OPERATION_TYPES] },
          studentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          studentA: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          studentB: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          target: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  row: { type: 'integer' },
                  column: { type: 'integer' }
                },
                required: ['row', 'column'],
                additionalProperties: false
              },
              { type: 'null' }
            ]
          }
        },
        required: ['type', 'studentId', 'studentA', 'studentB', 'target'],
        additionalProperties: false
      }
    }
  },
  required: ['operations'],
  additionalProperties: false
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces student names in the teacher's request with their IDs so that real
 * names never leave the machine. Longest names first so "Alice B" wins over "Alice".
 */
export function scrubStudentNames(request: string, students: Student[]): string {
  let out = request
  const byLength = [...students].sort((a, b) => b.name.length - a.name.length)
  for (const student of byLength) {
    const name = student.name.trim()
    if (!name) continue
    out = out.replace(new RegExp(escapeRegExp(name), 'gi'), student.id)
  }
  return out
}

/** Builds the outgoing LLM payload. Contains only student IDs, never names. */
export function buildMessages(request: string, students: Student[], seats: Seat[]): ChatMessage[] {
  const { rows, columns } = gridBounds(seats)
  const grid = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < columns; c++) {
      const seat = seatAt(seats, r, c)
      row.push(seat?.studentId ?? null)
    }
    grid.push(row)
  }
  const unseated = students
    .filter((s) => !seatOfStudent(seats, s.id))
    .map((s) => s.id)

  const system = [
    'You are a classroom seating assistant for a teacher.',
    'The classroom grid is given as rows of student IDs; row 0 is the FRONT of the room.',
    'Students are identified only by their opaque IDs.',
    'Translate the teacher request into the smallest list of seating operations.',
    'Use MOVE_TO_FRONT / MOVE_TO_BACK when the teacher says front/back.',
    'If you cannot resolve the request to valid student IDs, return an empty operations list.',
    'Never invent student IDs.'
  ].join(' ')

  const user = JSON.stringify({
    studentIds: students.map((s) => s.id),
    grid,
    unseated,
    request: scrubStudentNames(request, students)
  })

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/** Local validation of the raw parsed LLM response. Returns seating operations or an error. */
export function validateAiResponse(
  data: unknown,
  rosterIds: ReadonlySet<string>,
  seats: Seat[]
): { ok: true; operations: SeatingOperation[] } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'AI response is not an object' }
  }
  const raw = data as Record<string, unknown>
  if (!Array.isArray(raw.operations)) {
    return { ok: false, error: 'AI response is missing an operations list' }
  }
  if (raw.operations.length > 10) {
    return { ok: false, error: 'AI proposed too many operations' }
  }
  const { rows, columns } = gridBounds(seats)
  const operations: SeatingOperation[] = []
  for (const item of raw.operations) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, error: 'AI response contains an invalid operation' }
    }
    const op = item as Record<string, unknown>
    if (typeof op.type !== 'string' || !OPERATION_TYPES.includes(op.type as never)) {
      return { ok: false, error: `Unknown operation type: ${String(op.type)}` }
    }
    const validStudent = (value: unknown): value is string =>
      typeof value === 'string' && rosterIds.has(value)
    switch (op.type) {
      case 'MOVE_STUDENT': {
        if (!validStudent(op.studentId)) {
          return { ok: false, error: 'MOVE_STUDENT references an unknown student' }
        }
        const t = op.target as Seat2D | null | undefined
        if (
          !t ||
          !Number.isInteger(t.row) ||
          !Number.isInteger(t.column) ||
          t.row < 0 ||
          t.row >= rows ||
          t.column < 0 ||
          t.column >= columns
        ) {
          return { ok: false, error: 'MOVE_STUDENT has an invalid target seat' }
        }
        operations.push({
          type: 'MOVE_STUDENT',
          studentId: op.studentId,
          target: { row: t.row, column: t.column }
        })
        break
      }
      case 'SWAP_STUDENTS':
      case 'SEPARATE_STUDENTS': {
        if (!validStudent(op.studentA) || !validStudent(op.studentB)) {
          return { ok: false, error: `${op.type} references an unknown student` }
        }
        if (op.studentA === op.studentB) {
          return { ok: false, error: `${op.type} needs two different students` }
        }
        const a = op.studentA
        const b = op.studentB
        operations.push(
          op.type === 'SWAP_STUDENTS'
            ? { type: 'SWAP_STUDENTS', studentA: a, studentB: b }
            : { type: 'SEPARATE_STUDENTS', studentA: a, studentB: b }
        )
        break
      }
      case 'MOVE_TO_FRONT':
      case 'MOVE_TO_BACK': {
        if (!validStudent(op.studentId)) {
          return { ok: false, error: `${op.type} references an unknown student` }
        }
        operations.push({
          type: op.type,
          studentId: op.studentId
        })
        break
      }
    }
  }
  return { ok: true, operations }
}

export type LlmCall = (messages: ChatMessage[]) => Promise<unknown>

export type ProposalResult =
  | {
      ok: true
      operations: SeatingOperation[]
      before: Seat[]
      after: Seat[]
    }
  | { ok: false; error: string }

/**
 * Full AI pipeline: scrub names out of the request, ask the LLM, locally
 * validate the response, and apply the operations to a copy of the seating.
 * Never touches the database - the caller decides whether to persist.
 */
export async function computeProposal(opts: {
  request: string
  students: Student[]
  seats: Seat[]
  callLlm: LlmCall
}): Promise<ProposalResult> {
  const roster = new Set(opts.students.map((s) => s.id))
  let data: unknown
  try {
    data = await opts.callLlm(buildMessages(opts.request, opts.students, opts.seats))
  } catch (err) {
    return { ok: false, error: friendlyLlmError(err) }
  }
  const validated = validateAiResponse(data, roster, opts.seats)
  if (!validated.ok) return validated
  const applied = applyOperations(opts.seats, roster, validated.operations)
  if (!applied.ok) return applied
  return {
    ok: true,
    operations: validated.operations,
    before: opts.seats,
    after: applied.seats
  }
}

export function friendlyLlmError(err: unknown): string {
  const status = (err as { status?: number }).status
  if (status === 401 || status === 403) return 'The AI request was rejected: invalid API key.'
  const message = String((err as Error).message ?? err)
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'The AI request timed out. Please try again.'
  }
  if (message.includes('Connection') || message.includes('fetch failed') || message.includes('ENOTFOUND') || message.includes('ECONN')) {
    return 'Could not reach the AI provider. Check your internet connection.'
  }
  return 'The AI request failed. Please try again.'
}

export { jsonSchema }
