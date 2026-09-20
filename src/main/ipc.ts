import { ipcMain } from 'electron'
import OpenAI from 'openai'
import { getApiKey, hasApiKey, setApiKey } from './apikey'
import { computeProposal, jsonSchema } from './ai'
import {
  StaleSeatingError,
  addStudent,
  createClass,
  generateInitialSeating,
  getSeating,
  listClasses,
  listStudents,
  renameStudent,
  saveSeating,
  type Db
} from './db'
import type { AiProposal, Seat } from '../shared/types'

const MODEL = 'gpt-4o-mini'

function makeLlmCall(): (messages: unknown[]) => Promise<unknown> {
  const apiKey = getApiKey()
  const client = new OpenAI({ apiKey, timeout: 30000, maxRetries: 1 })
  return async (messages) => {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: messages as never,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'seating_operations', strict: true, schema: jsonSchema as never }
      }
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('The AI provider returned an empty response')
    return JSON.parse(content)
  }
}

function register(channel: string, handler: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await handler(...(args as never[])) }
    } catch (err) {
      if (err instanceof StaleSeatingError) {
        return { ok: false, error: 'Seating changed since this request. Please try again.' }
      }
      return { ok: false, error: (err as Error).message || 'Unexpected error' }
    }
  })
}

export function registerIpc(db: Db): void {
  register('classes:list', () => listClasses(db))
  register('classes:create', (name: string) => createClass(db, name))
  register('students:list', (classId: string) => listStudents(db, classId))
  register('students:add', (classId: string, name: string) => addStudent(db, classId, name))
  register('students:rename', (studentId: string, name: string) =>
    renameStudent(db, studentId, name)
  )
  register('seating:get', (classId: string) => getSeating(db, classId))
  register('seating:generate', (classId: string) => generateInitialSeating(db, classId))
  register('seating:save', (classId: string, seats: Seat[], expectedVersion: number) =>
    saveSeating(db, classId, seats, expectedVersion)
  )

  register('ai:request', async (classId: string, request: string): Promise<AiProposal> => {
    if (!hasApiKey()) throw new Error('No API key set. Use "Set API Key" first.')
    const students = listStudents(db, classId)
    const arrangement = getSeating(db, classId)
    if (students.length === 0) throw new Error('Add students to this class first')
    if (arrangement.seats.length === 0) throw new Error('Generate a seating arrangement first')
    const proposal = await computeProposal({
      request,
      students,
      seats: arrangement.seats,
      callLlm: makeLlmCall()
    })
    return proposal.ok ? { ...proposal, version: arrangement.version } : proposal
  })

  register('apiKey:set', (key: string) => setApiKey(key))
  register('apiKey:status', () => ({ available: hasApiKey() }))
}
