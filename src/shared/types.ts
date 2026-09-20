export type ClassInfo = { id: string; name: string }

export type Student = { id: string; name: string }

export type Seat = { row: number; column: number; studentId: string | null }

export type SeatingArrangement = {
  seats: Seat[]
  /** Bumped every time seating is saved; used to reject stale AI proposals. */
  version: number
}

export type SeatRef = { row: number; column: number }

export type SeatingOperation =
  | { type: 'MOVE_STUDENT'; studentId: string; target: SeatRef }
  | { type: 'SWAP_STUDENTS'; studentA: string; studentB: string }
  | { type: 'MOVE_TO_FRONT'; studentId: string }
  | { type: 'MOVE_TO_BACK'; studentId: string }
  | { type: 'SEPARATE_STUDENTS'; studentA: string; studentB: string }

export type ApplyResult =
  | { ok: true; seats: Seat[] }
  | { ok: false; error: string }

export type AiProposal =
  | {
      ok: true
      operations: SeatingOperation[]
      before: Seat[]
      after: Seat[]
      version: number
    }
  | { ok: false; error: string }
