import { describe, expect, it } from 'vitest'
import {
  applyOperations,
  diffSeats,
  generateSeating,
  seatAt,
  seatOfStudent,
  validateArrangement
} from '../src/shared/seating'
import type { Seat, SeatingOperation } from '../src/shared/types'

function makeGrid(w: string[][]): Seat[] {
  const seats: Seat[] = []
  w.forEach((row, r) =>
    row.forEach((id, c) => seats.push({ row: r, column: c, studentId: id === '.' ? null : id }))
  )
  return seats
}

function rosterOf(seats: Seat[]): Set<string> {
  return new Set(seats.filter((s) => s.studentId !== null).map((s) => s.studentId as string))
}

const apply = (seats: Seat[], ops: SeatingOperation[]) =>
  applyOperations(seats, rosterOf(seats), ops)

describe('seating generation', () => {
  it('assigns every student to exactly one seat', () => {
    const ids = Array.from({ length: 17 }, (_, i) => `s${i}`)
    const seats = generateSeating(ids)
    const seated = seats.filter((s) => s.studentId).map((s) => s.studentId)
    expect(seated.sort()).toEqual([...ids].sort())
    expect(seated.length).toBe(new Set(seated).size)
  })

  it('handles a single student and arbitrary counts', () => {
    expect(generateSeating(['only']).length).toBe(1)
    expect(generateSeating([])).toEqual([])
    expect(generateSeating(['a', 'b', 'c']).filter((s) => s.studentId).length).toBe(3)
  })
})

describe('manual seating operations', () => {
  it('moves a student to an empty seat', () => {
    const seats = makeGrid([
      ['a', 'b'],
      ['c', '.']
    ])
    const result = apply(seats, [{ type: 'MOVE_STUDENT', studentId: 'a', target: { row: 1, column: 1 } }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.seats.find((s) => s.row === 0 && s.column === 0)!.studentId).toBeNull()
      expect(result.seats.find((s) => s.row === 1 && s.column === 1)!.studentId).toBe('a')
    }
  })

  it('swaps two students atomically', () => {
    const seats = makeGrid([
      ['a', 'b'],
      ['c', '.']
    ])
    const result = apply(seats, [{ type: 'SWAP_STUDENTS', studentA: 'a', studentB: 'c' }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(seatAt(result.seats, 0, 0)!.studentId).toBe('c')
      expect(seatAt(result.seats, 1, 0)!.studentId).toBe('a')
      // Original arrangement is untouched.
      expect(seatAt(seats, 0, 0)!.studentId).toBe('a')
    }
  })

  it('treats a same-seat move as a no-op', () => {
    const seats = makeGrid([['a', 'b']])
    const result = apply(seats, [{ type: 'MOVE_STUDENT', studentId: 'a', target: { row: 0, column: 0 } }])
    expect(result.ok).toBe(true)
    if (result.ok) expect(diffSeats(seats, result.seats)).toEqual([])
  })

  it('moves a student to the front row (swapping if occupied)', () => {
    const seats = makeGrid([
      ['x', 'a'],
      ['b', '.']
    ])
    const result = apply(seats, [{ type: 'MOVE_TO_FRONT', studentId: 'b' }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(seatAt(result.seats, 0, 0)!.studentId).toBe('b')
      expect(seatAt(result.seats, 1, 0)!.studentId).toBe('x')
    }
  })

  it('separates adjacent students', () => {
    const seats = makeGrid([
      ['a', 'b', '.'],
      ['.', '.', '.'],
      ['.', '.', '.']
    ])
    const result = apply(seats, [{ type: 'SEPARATE_STUDENTS', studentA: 'a', studentB: 'b' }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      const seatA = seatOfStudent(result.seats, 'a')!
      const seatB = seatOfStudent(result.seats, 'b')!
      expect(Math.max(Math.abs(seatA.row - seatB.row), Math.abs(seatA.column - seatB.column))).toBeGreaterThanOrEqual(2)
    }
  })

  it('rejects invalid operations and leaves the original arrangement unchanged', () => {
    const seats = makeGrid([['a', 'b']])
    const cases: SeatingOperation[] = [
      { type: 'MOVE_STUDENT', studentId: 'zzz', target: { row: 0, column: 0 } },
      { type: 'MOVE_STUDENT', studentId: 'a', target: { row: 9, column: 9 } },
      { type: 'SWAP_STUDENTS', studentA: 'a', studentB: 'a' },
      { type: 'MOVE_TO_BACK', studentId: 'zzz' }
    ]
    for (const op of cases) {
      const result = apply(seats, [op])
      expect(result.ok).toBe(false)
      expect(seatAt(seats, 0, 0)!.studentId).toBe('a')
      expect(seatAt(seats, 0, 1)!.studentId).toBe('b')
    }
  })

  it('rejects a batch that fails halfway without applying earlier operations', () => {
    const seats = makeGrid([['a', 'b', '.']])
    const result = apply(seats, [
      { type: 'MOVE_STUDENT', studentId: 'a', target: { row: 0, column: 2 } },
      { type: 'MOVE_STUDENT', studentId: 'nope', target: { row: 0, column: 0 } }
    ])
    expect(result.ok).toBe(false)
    expect(seatAt(seats, 0, 0)!.studentId).toBe('a')
    expect(seatAt(seats, 0, 2)!.studentId).toBeNull()
  })
})

describe('arrangement validation', () => {
  it('rejects duplicate student assignments and students outside the roster', () => {
    const dup = makeGrid([['a', 'a']])
    expect(validateArrangement(dup, new Set(['a']))).toMatch(/more than one seat/)
    const foreign = makeGrid([['z']])
    expect(validateArrangement(foreign, new Set(['a']))).toMatch(/not in this class/)
  })

  it('accepts a valid arrangement', () => {
    expect(validateArrangement(makeGrid([['a', '.'], ['b', '.']]), new Set(['a', 'b']))).toBeNull()
  })
})
