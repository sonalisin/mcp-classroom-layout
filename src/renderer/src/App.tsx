import { useEffect, useRef, useState } from 'react'
import { applyOperations, gridBounds } from '../../shared/seating'
import type { AiProposal, ClassInfo, SeatingArrangement, Seat, SeatingOperation, Student } from '../../shared/types'
import SeatingGrid from './SeatingGrid'
import AiPanel from './AiPanel'

type Selection = { kind: 'seat'; seat: Seat } | { kind: 'unseated'; studentId: string } | null

export default function App() {
  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [classId, setClassId] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [arrangement, setArrangement] = useState<SeatingArrangement | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [apiKeyAvailable, setApiKeyAvailable] = useState(false)
  const [newClassName, setNewClassName] = useState('')
  const [newStudentName, setNewStudentName] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [proposal, setProposal] = useState<AiProposal | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const currentClassRef = useRef<string | null>(null)

  const studentName = (id: string | null): string => {
    if (id === null) return 'Empty'
    const s = students.find((x) => x.id === id)
    return s ? s.name : `(${id.slice(0, 8)}…)`
  }

  useEffect(() => {
    window.seating.apiKeyStatus().then((s) => setApiKeyAvailable(s.available))
    window.seating.listClasses().then((cs) => {
      setClasses(cs)
      if (cs.length > 0) setClassId(cs[0]!.id)
    })
  }, [])

  useEffect(() => {
    currentClassRef.current = classId
    if (!classId) {
      setStudents([])
      setArrangement(null)
      return
    }
    Promise.all([window.seating.listStudents(classId), window.seating.getSeating(classId)])
      .then(([ss, a]) => {
        setStudents(ss)
        setArrangement(a)
      })
      .catch((e) => setStatus(e.message))
  }, [classId])

  useEffect(() => {
    // Rename box follows the selected seat.
    if (selection?.kind === 'seat' && selection.seat.studentId) {
      setRenameDraft(studentName(selection.seat.studentId))
    }
  }, [selection])

  async function refreshSeating(): Promise<void> {
    setArrangement(await window.seating.getSeating(classId!))
  }

  async function createClass(): Promise<void> {
    try {
      const c = await window.seating.createClass(newClassName)
      setNewClassName('')
      setClasses(await window.seating.listClasses())
      setClassId(c.id)
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  async function addStudent(): Promise<void> {
    try {
      await window.seating.addStudent(classId!, newStudentName)
      setNewStudentName('')
      setStudents(await window.seating.listStudents(classId!))
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  async function renameSelected(): Promise<void> {
    if (selection?.kind !== 'seat' || !selection.seat.studentId) return
    try {
      await window.seating.renameStudent(selection.seat.studentId, renameDraft)
      setStudents(await window.seating.listStudents(classId!))
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  async function generateSeating(): Promise<void> {
    try {
      setArrangement(await window.seating.generateSeating(classId!))
      setSelection(null)
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  async function onSeatClick(seat: Seat): Promise<void> {
    if (!arrangement) return
    if (selection === null) {
      if (seat.studentId !== null) setSelection({ kind: 'seat', seat })
      else setStatus('Click a student first, then click a destination seat.')
      return
    }
    if (selection.kind === 'unseated') {
      if (seat.studentId !== null) {
        setStatus('Choose an empty seat for the selected student.')
        return
      }
      await move([{ type: 'MOVE_STUDENT', studentId: selection.studentId, target: { row: seat.row, column: seat.column } }])
      setSelection(null)
      return
    }
    // selection.kind === 'seat'
    if (selection.seat === seat) {
      setSelection(null)
      return
    }
    const studentId = selection.seat.studentId!
    await move([{ type: 'MOVE_STUDENT', studentId, target: { row: seat.row, column: seat.column } }])
    setSelection(null)
  }

  async function move(ops: SeatingOperation[]): Promise<void> {
    try {
      const result = applyOperations(arrangement!.seats, new Set(students.map((s) => s.id)), ops)
      if (!result.ok) {
        setStatus(result.error)
        return
      }
      setArrangement(await window.seating.saveSeating(classId!, result.seats, arrangement!.version))
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
      setSelection(null)
      await refreshSeating()
    }
  }

  async function saveApiKey(): Promise<void> {
    try {
      await window.seating.setApiKey(apiKeyInput)
      setApiKeyInput('')
      setApiKeyAvailable(true)
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  async function askAi(request: string): Promise<void> {
    if (!classId) return
    const requestClassId = classId
    setAiBusy(true)
    setProposal(null)
    setStatus(null)
    try {
      const result = await window.seating.requestAiChange(requestClassId, request)
      // The teacher may have switched class while the request was pending.
      if (currentClassRef.current !== requestClassId) return
      setProposal(result)
    } catch (e) {
      if (currentClassRef.current === requestClassId) setStatus((e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  async function applyProposal(): Promise<void> {
    if (!proposal || !proposal.ok) return
    try {
      setArrangement(
        await window.seating.saveSeating(classId!, proposal.after, proposal.version)
      )
      setProposal(null)
      setStatus('AI proposal applied.')
    } catch (e) {
      // e.g. the arrangement changed while the proposal was being reviewed.
      setProposal(null)
      setStatus((e as Error).message)
      await refreshSeating()
    }
  }

  function rejectProposal(): void {
    setProposal(null)
    setStatus('AI proposal rejected. Seating unchanged.')
  }

  const unseated = students.filter((s) => !arrangement?.seats.some((seat) => seat.studentId === s.id))
  const bounds = arrangement ? gridBounds(arrangement.seats) : { rows: 0, columns: 0 }

  return (
    <div className="app">
      <header>
        <h1>Seating Planner</h1>
        <select value={classId ?? ''} onChange={(e) => { setClassId(e.target.value); setSelection(null); setProposal(null) }}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          placeholder="New class name"
          value={newClassName}
          onChange={(e) => setNewClassName(e.target.value)}
        />
        <button onClick={createClass} disabled={!newClassName.trim()}>Create class</button>
        <span className="spacer" />
        <span>{apiKeyAvailable ? 'API key set' : 'No API key'}</span>
        <input
          type="password"
          placeholder="OpenAI API key"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
        />
        <button onClick={saveApiKey} disabled={!apiKeyInput.trim()}>Set API key</button>
      </header>

      <div className="body">
        <aside>
          <h2>Students</h2>
          <div>
            <input
              placeholder="Student name"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStudent()}
              disabled={!classId}
            />
            <button onClick={addStudent} disabled={!classId || !newStudentName.trim()}>Add</button>
          </div>
          <ul>
            {students.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
        </aside>

        <main>
          {classId && (
            <>
              <div className="toolbar">
                <button onClick={generateSeating}>Generate seating</button>
                <span>
                  {arrangement && arrangement.seats.length > 0
                    ? `${bounds.rows} rows × ${bounds.columns} columns`
                    : 'No seating yet'}
                </span>
                {unseated.length > 0 && (
                  <span className="unseated-label">
                    Unseated: {unseated.map((s) => s.name).join(', ')}
                  </span>
                )}
              </div>

              {unseated.length > 0 && (
                <div className="chips">
                  {unseated.map((s) => (
                    <button
                      key={s.id}
                      className={selection?.kind === 'unseated' && selection.studentId === s.id ? 'chip selected' : 'chip'}
                      onClick={() =>
                        setSelection(
                          selection?.kind === 'unseated' && selection.studentId === s.id
                            ? null
                            : { kind: 'unseated', studentId: s.id }
                        )
                      }
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              {arrangement && arrangement.seats.length > 0 ? (
                <SeatingGrid
                  seats={arrangement.seats}
                  nameOf={studentName}
                  selectedSeat={
                    selection?.kind === 'seat' ? selection.seat : undefined
                  }
                  onSeatClick={onSeatClick}
                />
              ) : (
                <p className="empty">No seating yet. Add students and click “Generate seating”.</p>
              )}

              {selection?.kind === 'seat' && selection.seat.studentId && (
                <div className="rename">
                  <label>
                    Rename {studentName(selection.seat.studentId)}:
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                    />
                  </label>
                  <button onClick={renameSelected} disabled={!renameDraft.trim()}>Save name</button>
                </div>
              )}
            </>
          )}
          {!classId && <p className="empty">Create a class to get started.</p>}
        </main>

        <AiPanel
          enabled={!!classId && apiKeyAvailable && (arrangement?.seats.length ?? 0) > 0}
          busy={aiBusy}
          proposal={proposal}
          nameOf={studentName}
          onAsk={askAi}
          onApply={applyProposal}
          onReject={rejectProposal}
        />
      </div>

      {status && <footer className="status">{status}</footer>}
    </div>
  )
}
