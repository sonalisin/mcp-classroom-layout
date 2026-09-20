import { useState } from 'react'
import { diffSeats } from '../../shared/seating'
import type { AiProposal } from '../../shared/types'

type Props = {
  enabled: boolean
  busy: boolean
  proposal: AiProposal | null
  nameOf: (studentId: string) => string
  onAsk: (request: string) => void
  onApply: () => void
  onReject: () => void
}

function seatLabel(seat: { row: number; column: number } | null): string {
  return seat ? `row ${seat.row + 1}, column ${seat.column + 1}` : 'no seat'
}

export default function AiPanel({ enabled, busy, proposal, nameOf, onAsk, onApply, onReject }: Props) {
  const [request, setRequest] = useState('')

  return (
    <aside className="ai">
      <h2>AI seating assistant</h2>
      <textarea
        placeholder='e.g. "Move the student in seat 1-2 to the front" or "Swap Alice and Bob"'
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        disabled={!enabled || busy}
        rows={3}
      />
      <button
        onClick={() => onAsk(request)}
        disabled={!enabled || busy || !request.trim()}
      >
        {busy ? 'Asking…' : 'Ask AI'}
      </button>

      {proposal && proposal.ok && (
        <div className="proposal">
          <h3>Proposed changes</h3>
          {diff(proposal, nameOf).length === 0 ? (
            <p>No changes proposed.</p>
          ) : (
            <ul>
              {diff(proposal, nameOf).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <div className="proposal-actions">
            <button className="primary" onClick={onApply}>Apply</button>
            <button onClick={onReject}>Reject</button>
          </div>
        </div>
      )}
      {proposal && !proposal.ok && <p className="error">{proposal.error}</p>}
    </aside>
  )
}

function diff(proposal: Extract<AiProposal, { ok: true }>, nameOf: (id: string) => string): string[] {
  return diffSeats(proposal.before, proposal.after).map(
    (c) => `${nameOf(c.studentId)}: ${seatLabel(c.from)} → ${seatLabel(c.to)}`
  )
}
