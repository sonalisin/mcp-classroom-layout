import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  generateSeating,
  validateArrangement
} from '../shared/seating'
import type { ClassInfo, Seat, SeatingArrangement, Student } from '../shared/types'

export type Db = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seating_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS class_students (
  class_id TEXT NOT NULL REFERENCES classes(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  PRIMARY KEY (class_id, student_id)
);
CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  row_num INTEGER NOT NULL,
  col_num INTEGER NOT NULL,
  student_id TEXT,
  UNIQUE (class_id, row_num, col_num),
  FOREIGN KEY (class_id, student_id) REFERENCES class_students(class_id, student_id)
);
`

export class StaleSeatingError extends Error {
  constructor() {
    super('STALE')
  }
}

export function openDatabase(path: string): Db {
  let db: Db
  try {
    db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
  } catch (err) {
    throw new Error(`Could not open database at ${path}: ${(err as Error).message}`)
  }
  return db
}

export function listClasses(db: Db): ClassInfo[] {
  return db
    .prepare('SELECT id, name FROM classes ORDER BY created_at, id')
    .all() as ClassInfo[]
}

export function createClass(db: Db, name: string): ClassInfo {
  const info = { id: randomUUID(), name: name.trim() }
  if (!info.name) throw new Error('Class name cannot be empty')
  db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
    info.id,
    info.name,
    new Date().toISOString()
  )
  return info
}

export function listStudents(db: Db, classId: string): Student[] {
  return db
    .prepare(
      `SELECT s.id, s.name FROM students s
       JOIN class_students cs ON cs.student_id = s.id
       WHERE cs.class_id = ? ORDER BY s.created_at, s.id`
    )
    .all(classId) as Student[]
}

export function addStudent(db: Db, classId: string, name: string): Student {
  const student = { id: randomUUID(), name: name.trim() }
  if (!student.name) throw new Error('Student name cannot be empty')
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO students (id, name, created_at) VALUES (?, ?, ?)').run(
      student.id,
      student.name,
      new Date().toISOString()
    )
    db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(
      classId,
      student.id
    )
  })
  tx()
  return student
}

export function renameStudent(db: Db, studentId: string, name: string): Student {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Student name cannot be empty')
  const result = db.prepare('UPDATE students SET name = ? WHERE id = ?').run(trimmed, studentId)
  if (result.changes === 0) throw new Error('Student not found')
  return { id: studentId, name: trimmed }
}

function loadSeats(db: Db, classId: string): Seat[] {
  return (db
    .prepare('SELECT row_num AS row, col_num AS column, student_id AS studentId FROM seats WHERE class_id = ? ORDER BY row_num, col_num')
    .all(classId) as Seat[])
}

export function getSeating(db: Db, classId: string): SeatingArrangement {
  const row = db
    .prepare('SELECT seating_version FROM classes WHERE id = ?')
    .get(classId) as { seating_version: number } | undefined
  if (!row) throw new Error('Class not found')
  return { seats: loadSeats(db, classId), version: row.seating_version }
}

export function saveSeating(
  db: Db,
  classId: string,
  seats: Seat[],
  expectedVersion: number
): SeatingArrangement {
  const roster = new Set(listStudents(db, classId).map((s) => s.id))
  const problem = validateArrangement(seats, roster)
  if (problem) throw new Error(problem)

  const tx = db.transaction(() => {
    const current = db
      .prepare('SELECT seating_version FROM classes WHERE id = ?')
      .get(classId) as { seating_version: number } | undefined
    if (!current) throw new Error('Class not found')
    if (current.seating_version !== expectedVersion) throw new StaleSeatingError()
    db.prepare('DELETE FROM seats WHERE class_id = ?').run(classId)
    const insert = db.prepare(
      'INSERT INTO seats (id, class_id, row_num, col_num, student_id) VALUES (?, ?, ?, ?, ?)'
    )
    for (const seat of seats) {
      insert.run(randomUUID(), classId, seat.row, seat.column, seat.studentId)
    }
    db.prepare('UPDATE classes SET seating_version = seating_version + 1 WHERE id = ?').run(classId)
  })
  tx()
  return getSeating(db, classId)
}

export function generateInitialSeating(db: Db, classId: string): SeatingArrangement {
  const students = listStudents(db, classId)
  if (students.length === 0) throw new Error('Add students before generating seating')
  const current = getSeating(db, classId)
  return saveSeating(db, classId, generateSeating(students.map((s) => s.id)), current.version)
}
