import type { ApplyResult, Seat, SeatingOperation } from './types'

export function gridBounds(seats: Seat[]): { rows: number; columns: number } {
  if (seats.length === 0) return { rows: 0, columns: 0 }
  let rows = 0
  let columns = 0
  for (const s of seats) {
    rows = Math.max(rows, s.row + 1)
    columns = Math.max(columns, s.column + 1)
  }
  return { rows, columns }
}

export function seatAt(seats: Seat[], row: number, column: number): Seat | undefined {
  return seats.find((s) => s.row === row && s.column === column)
}

export function seatOfStudent(seats: Seat[], studentId: string): Seat | undefined {
  return seats.find((s) => s.studentId === studentId)
}

/** Roughly square grid, filled row-major. Always produces enough seats for every student. */
export function generateSeating(studentIds: string[]): Seat[] {
  if (studentIds.length === 0) return []
  const columns = Math.max(1, Math.ceil(Math.sqrt(studentIds.length)))
  const rows = Math.ceil(studentIds.length / columns)
  const seats: Seat[] = []
  for (let i = 0; i < rows * columns; i++) {
    const studentId = i < studentIds.length ? studentIds[i]! : null
    seats.push({ row: Math.floor(i / columns), column: i % columns, studentId })
  }
  return seats
}

function cloneSeats(seats: Seat[]): Seat[] {
  return seats.map((s) => ({ ...s }))
}

/**
 * Checks a full arrangement against the invariants that must hold before persisting:
 * unique seats, no student in two seats, and every seated student in the roster.
 */
export function validateArrangement(seats: Seat[], rosterIds: ReadonlySet<string>): string | null {
  const seatKeys = new Set<string>()
  const seated = new Set<string>()
  const bounds = gridBounds(seats)
  for (const s of seats) {
    if (!Number.isInteger(s.row) || !Number.isInteger(s.column) || s.row < 0 || s.column < 0) {
      return `Invalid seat position (row ${s.row}, column ${s.column})`
    }
    if (s.row >= bounds.rows || s.column >= bounds.columns) {
      return `Seat (${s.row}, ${s.column}) is outside the grid`
    }
    const key = `${s.row},${s.column}`
    if (seatKeys.has(key)) return `Duplicate seat (${s.row}, ${s.column})`
    seatKeys.add(key)
    if (s.studentId !== null) {
      if (!rosterIds.has(s.studentId)) {
        return `Student ${s.studentId} is not in this class`
      }
      if (seated.has(s.studentId)) {
        return `Student ${s.studentId} occupies more than one seat`
      }
      seated.add(s.studentId)
    }
  }
  return null
}

function moveStudentTo(seats: Seat[], studentId: string, target: Seat): string | null {
  const current = seatOfStudent(seats, studentId)
  if (!current) return `Student ${studentId} is not seated`
  if (current === target) return null // same-seat move is a no-op
  if (target.studentId === null) {
    target.studentId = studentId
    current.studentId = null
  } else {
    const other = target.studentId
    target.studentId = studentId
    current.studentId = other
  }
  return null
}

function separate(students: [string, string], seats: Seat[]): string | null {
  const [a, b] = students
  const seatA = seatOfStudent(seats, a)
  const seatB = seatOfStudent(seats, b)
  if (!seatA) return `Student ${a} is not seated`
  if (!seatB) return `Student ${b} is not seated`
  const distance = Math.max(Math.abs(seatA.row - seatB.row), Math.abs(seatA.column - seatB.column))
  if (distance >= 2) return null // already separated

  // Move B to the empty seat farthest from A; if none is empty, swap B with
  // whoever sits farthest from A.
  let best: Seat | null = null
  let bestDistance = -1
  for (const candidate of seats) {
    if (candidate === seatB || candidate.studentId === a) continue
    if (best && best.studentId === null && candidate.studentId !== null) continue
    const d = Math.max(Math.abs(seatA.row - candidate.row), Math.abs(seatA.column - candidate.column))
    if (d > bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  if (!best || bestDistance < 2) {
    return `No seat available to separate ${a} and ${b} in this layout`
  }
  const occupant = best.studentId
  best.studentId = b
  seatB.studentId = occupant
  return null
}

/**
 * Applies operations sequentially to a copy of the arrangement.
 * Returns a new arrangement on success; on any failure the input is untouched.
 * This is the single authority on seating validity - AI proposals and manual
 * moves both go through it, and nothing is persisted without passing it.
 */
export function applyOperations(
  seats: Seat[],
  rosterIds: ReadonlySet<string>,
  operations: SeatingOperation[]
): ApplyResult {
  const working = cloneSeats(seats)
  for (const op of operations) {
    let error: string | null = null
    switch (op.type) {
      case 'MOVE_STUDENT': {
        if (!rosterIds.has(op.studentId)) {
          error = `Student ${op.studentId} is not in this class`
          break
        }
        const target = seatAt(working, op.target.row, op.target.column)
        if (!target) {
          error = `Seat (row ${op.target.row}, column ${op.target.column}) does not exist`
          break
        }
        const current = seatOfStudent(working, op.studentId)
        if (!current) {
          // Student not currently seated: placing into an empty seat is allowed.
          if (target.studentId !== null) {
            error = `Seat (row ${op.target.row}, column ${op.target.column}) is occupied`
          } else {
            target.studentId = op.studentId
          }
        } else {
          error = moveStudentTo(working, op.studentId, target)
        }
        break
      }
      case 'SWAP_STUDENTS': {
        if (op.studentA === op.studentB) {
          error = 'Cannot swap a student with themselves'
          break
        }
        const seatA = seatOfStudent(working, op.studentA)
        const seatB = seatOfStudent(working, op.studentB)
        if (!seatA) {
          error = `Student ${op.studentA} is not seated`
          break
        }
        if (!seatB) {
          error = `Student ${op.studentB} is not seated`
          break
        }
        seatA.studentId = op.studentB
        seatB.studentId = op.studentA
        break
      }
      case 'MOVE_TO_FRONT':
      case 'MOVE_TO_BACK': {
        if (!rosterIds.has(op.studentId)) {
          error = `Student ${op.studentId} is not in this class`
          break
        }
        const current = seatOfStudent(working, op.studentId)
        if (!current) {
          error = `Student ${op.studentId} is not seated`
          break
        }
        const { rows } = gridBounds(working)
        const targetRow = op.type === 'MOVE_TO_FRONT' ? 0 : rows - 1
        if (current.row === targetRow) break // no-op
        const target = seatAt(working, targetRow, current.column)
        if (!target) {
          error = `Seat (row ${targetRow}, column ${current.column}) does not exist`
          break
        }
        error = moveStudentTo(working, op.studentId, target)
        break
      }
      case 'SEPARATE_STUDENTS': {
        if (op.studentA === op.studentB) {
          error = 'Cannot separate a student from themselves'
          break
        }
        error = separate([op.studentA, op.studentB], working)
        break
      }
      default:
        error = `Unknown operation type`
    }
    if (error) return { ok: false, error }
  }
  return { ok: true, seats: working }
}

/** Human-readable before/after diff, resolved to names by the caller. */
export function diffSeats(
  before: Seat[],
  after: Seat[]
): Array<{ studentId: string; from: Seat | null; to: Seat | null }> {
  const changes: Array<{ studentId: string; from: Seat | null; to: Seat | null }> = []
  for (const seatAfter of after) {
    if (seatAfter.studentId === null) continue
    const seatBefore = seatOfStudent(before, seatAfter.studentId)
    if (
      seatBefore &&
      seatBefore.row === seatAfter.row &&
      seatBefore.column === seatAfter.column
    ) {
      continue
    }
    changes.push({ studentId: seatAfter.studentId, from: seatBefore ?? null, to: seatAfter })
  }
  return changes
}
