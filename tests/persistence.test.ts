import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addStudent,
  createClass,
  generateInitialSeating,
  getSeating,
  listClasses,
  listStudents,
  openDatabase,
  renameStudent,
  saveSeating,
  StaleSeatingError
} from '../src/main/db'
import type { Seat } from '../src/shared/types'

let dir: string
let dbPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'seating-'))
  dbPath = join(dir, 'seating.db')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seededIds(): { classId: string; ids: string[] } {
  const db = openDatabase(dbPath)
  const cls = createClass(db, 'Math 2A')
  const ids = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map((name) => addStudent(db, cls.id, name).id)
  db.close()
  return { classId: cls.id, ids }
}

describe('persistence', () => {
  it('persists class, students and seating across a restart (db reopen)', () => {
    const { classId, ids } = seededIds()

    const db = openDatabase(dbPath)
    const generated = generateInitialSeating(db, classId)
    expect(generated.seats.filter((s) => s.studentId).length).toBe(5)
    db.close()

    // Simulates an app restart: brand new connection.
    const db2 = openDatabase(dbPath)
    const classes = listClasses(db2)
    expect(classes.map((c) => c.name)).toContain('Math 2A')
    const students = listStudents(db2, classId)
    expect(students.map((s) => s.name).sort()).toEqual(['Alice', 'Bob', 'Carol', 'Dave', 'Eve'])
    expect(students.map((s) => s.id).sort()).toEqual([...ids].sort())

    const seating = getSeating(db2, classId)
    expect(seating.seats.length).toBeGreaterThanOrEqual(5)
    expect(seating.seats.filter((s) => s.studentId).length).toBe(5)
    db2.close()
  })

  it('renames a student while keeping their ID', () => {
    const { classId } = seededIds()
    const db = openDatabase(dbPath)
    const student = listStudents(db, classId).find((s) => s.name === 'Alice')!
    const renamed = renameStudent(db, student.id, 'Alice B')
    expect(renamed.id).toBe(student.id)
    db.close()

    const db2 = openDatabase(dbPath)
    const after = listStudents(db2, classId).find((s) => s.id === student.id)!
    expect(after.name).toBe('Alice B')
    expect(listStudents(db2, classId).length).toBe(5) // no duplicate student record
    db2.close()
  })

  it('persists a manually saved arrangement', () => {
    const { classId } = seededIds()
    const db = openDatabase(dbPath)
    const current = generateInitialSeating(db, classId)
    const moved = current.seats.map((s) =>
      s.row === 0 && s.column === 0 ? { ...s, studentId: null } : s
    )
    const saved = saveSeating(db, classId, moved, current.version)
    expect(saved.version).toBe(current.version + 1)
    db.close()

    const db2 = openDatabase(dbPath)
    const reloaded = getSeating(db2, classId)
    expect(reloaded.seats.find((s) => s.row === 0 && s.column === 0)!.studentId).toBeNull()
    expect(reloaded.version).toBe(saved.version)
    db2.close()
  })

  it('rejects stale saves and leaves data unchanged', () => {
    const { classId } = seededIds()
    const db = openDatabase(dbPath)
    const current = generateInitialSeating(db, classId)
    const tampered = current.seats.map((s) => ({ ...s }))
    expect(() => saveSeating(db, classId, tampered, current.version - 1)).toThrow(StaleSeatingError)
    expect(getSeating(db, classId).version).toBe(current.version)
    db.close()
  })

  it('refuses to seat a student who is not in the class and keeps the original arrangement', () => {
    const db = openDatabase(dbPath)
    const classA = createClass(db, 'A')
    const classB = createClass(db, 'B')
    const studentA = addStudent(db, classA.id, 'A1')
    const studentB = addStudent(db, classB.id, 'B1')
    const generated = generateInitialSeating(db, classA.id)

    const smuggled: Seat[] = generated.seats.map((s) => ({ ...s }))
    smuggled[0]!.studentId = studentB.id // student from another class
    expect(() => saveSeating(db, classA.id, smuggled, generated.version)).toThrow(/not in this class/)

    const duplicated: Seat[] = [
      { row: 0, column: 0, studentId: studentA.id },
      { row: 1, column: 0, studentId: studentA.id }
    ]
    expect(() => saveSeating(db, classA.id, duplicated, generated.version)).toThrow(/more than one seat/)

    const after = getSeating(db, classA.id)
    expect(after.seats).toEqual(generated.seats) // nothing changed
    db.close()
  })

  it('throws instead of silently creating a database over an unreadable file', () => {
    const corruptPath = join(dir, 'not-a-db.db')
    writeFileSync(corruptPath, 'this is definitely not sqlite')
    expect(() => openDatabase(corruptPath)).toThrow(/Could not open database/)
  })
})

describe('classes and students basics', () => {
  it('allows duplicate student names within a class', () => {
    const db = openDatabase(dbPath)
    const cls = createClass(db, 'Twins')
    addStudent(db, cls.id, 'Chris')
    addStudent(db, cls.id, 'Chris')
    const students = listStudents(db, cls.id)
    expect(students.length).toBe(2)
    expect(new Set(students.map((s) => s.id)).size).toBe(2)
    db.close()
  })
})
