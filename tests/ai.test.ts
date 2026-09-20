import { describe, expect, it } from 'vitest'
import {
  buildMessages,
  computeProposal,
  scrubStudentNames,
  validateAiResponse
} from '../src/main/ai'
import type { Seat, Student } from '../src/shared/types'

const students: Student[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alice' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bob' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Alice B' }
]

function seats(): Seat[] {
  return [
    { row: 0, column: 0, studentId: students[1]!.id },
    { row: 0, column: 1, studentId: null },
    { row: 1, column: 0, studentId: students[0]!.id },
    { row: 1, column: 1, studentId: students[2]!.id }
  ]
}

const roster = new Set(students.map((s) => s.id))

describe('privacy of the outgoing AI payload', () => {
  it('sends student IDs and never real student names', () => {
    const request = 'Move Alice to the front and swap Bob with Alice B'
    const messages = buildMessages(request, students, seats())
    const payload = JSON.stringify(messages)
    expect(payload).toContain(students[0]!.id)
    expect(payload).not.toContain('Alice')
    expect(payload).not.toContain('Bob')
    // The scrubbed request resolves names to the right IDs.
    const userMessage = messages[1]!.content
    expect(userMessage).toContain(`Move ${students[0]!.id} to the front`)
  })

  it('scrubs longer names before shorter ones', () => {
    const out = scrubStudentNames('Put Alice B next to Bob', students)
    expect(out).not.toContain('Alice')
    expect(out).toContain(students[2]!.id)
    expect(out).toContain(students[1]!.id)
  })
})

describe('local validation of AI responses', () => {
  it('accepts a valid structured response', () => {
    const result = validateAiResponse(
      {
        operations: [
          { type: 'MOVE_TO_FRONT', studentId: students[0]!.id, studentA: null, studentB: null, target: null }
        ]
      },
      roster,
      seats()
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.operations[0]!.type).toBe('MOVE_TO_FRONT')
  })

  it('rejects unknown student IDs', () => {
    const result = validateAiResponse(
      {
        operations: [
          { type: 'MOVE_TO_FRONT', studentId: '44444444-4444-4444-4444-444444444444', studentA: null, studentB: null, target: null }
        ]
      },
      roster,
      seats()
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/unknown student/i)
  })

  it('rejects unknown operation types, malformed shapes and out-of-bounds targets', () => {
    const cases = [
      { operations: [{ type: 'EXPLODE', studentId: students[0]!.id, studentA: null, studentB: null, target: null }] },
      { operations: 'nope' },
      {},
      {
        operations: [
          { type: 'MOVE_STUDENT', studentId: students[0]!.id, studentA: null, studentB: null, target: { row: 99, column: 0 } }
        ]
      }
    ]
    for (const data of cases) {
      expect(validateAiResponse(data, roster, seats()).ok).toBe(false)
    }
  })
})

describe('AI proposal pipeline', () => {
  const base = {
    request: 'Move Alice to the front',
    students,
    seats: seats()
  }

  it('produces a proposal from a valid LLM response', async () => {
    const proposal = await computeProposal({
      ...base,
      callLlm: async () => ({
        operations: [
          { type: 'MOVE_TO_FRONT', studentId: students[0]!.id, studentA: null, studentB: null, target: null }
        ]
      })
    })
    expect(proposal.ok).toBe(true)
    if (proposal.ok) {
      const aliceAfter = proposal.after.find((s) => s.studentId === students[0]!.id)!
      expect(aliceAfter.row).toBe(0)
      expect(proposal.after.find((s) => s.studentId === students[1]!.id)!.row).toBe(1)
      // The current arrangement is not mutated by the proposal.
      expect(base.seats.find((s) => s.studentId === students[0]!.id)!.row).toBe(1)
      expect(base.seats.find((s) => s.studentId === students[1]!.id)!.row).toBe(0)
    }
  })

  it('rejects an invalid AI operation without touching the arrangement', async () => {
    const proposal = await computeProposal({
      ...base,
      callLlm: async () => ({
        operations: [
          { type: 'MOVE_STUDENT', studentId: '99999999-9999-9999-9999-999999999999', studentA: null, studentB: null, target: { row: 1, column: 1 } }
        ]
      })
    })
    expect(proposal.ok).toBe(false)
    if (!proposal.ok) expect(proposal.error).toMatch(/unknown student/i)
  })

  it('rejects a malformed LLM response', async () => {
    const proposal = await computeProposal({ ...base, callLlm: async () => 'complete nonsense' })
    expect(proposal.ok).toBe(false)
  })

  it('turns provider/network failures into friendly errors', async () => {
    const proposal = await computeProposal({
      ...base,
      callLlm: async () => {
        throw new Error('Request timed out')
      }
    })
    expect(proposal.ok).toBe(false)
    if (!proposal.ok) expect(proposal.error).toMatch(/timed out/i)
  })

  it('produces no diff for an empty operation list', async () => {
    const proposal = await computeProposal({
      ...base,
      callLlm: async () => ({ operations: [] })
    })
    expect(proposal.ok).toBe(true)
    if (proposal.ok) {
      expect(proposal.before).toEqual(proposal.after)
    }
  })
})
