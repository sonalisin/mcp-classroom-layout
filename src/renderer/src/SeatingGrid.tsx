import { gridBounds } from '../../shared/seating'
import type { Seat } from '../../shared/types'

type Props = {
  seats: Seat[]
  nameOf: (studentId: string | null) => string
  selectedSeat?: Seat
  onSeatClick: (seat: Seat) => void
}

export default function SeatingGrid({ seats, nameOf, selectedSeat, onSeatClick }: Props) {
  const { rows, columns } = gridBounds(seats)
  return (
    <div className="board">
      <div className="board-label">Front of room</div>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(110px, 1fr))` }}
      >
        {Array.from({ length: rows * columns }, (_, i) => {
          const seat = seats.find((s) => s.row === Math.floor(i / columns) && s.column === i % columns)
          if (!seat) return <div key={i} className="seat ghost" />
          const selected = selectedSeat === seat
          return (
            <button
              key={i}
              className={
                'seat' + (seat.studentId ? '' : ' empty') + (selected ? ' selected' : '')
              }
              onClick={() => onSeatClick(seat)}
            >
              <span className="pos">{seat.row + 1}-{seat.column + 1}</span>
              <span className="who">{seat.studentId ? nameOf(seat.studentId) : 'Empty'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
