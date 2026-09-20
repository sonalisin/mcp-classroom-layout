import { contextBridge, ipcRenderer } from 'electron'
import type { AiProposal, ClassInfo, SeatingArrangement, Seat, Student } from '../shared/types'

type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

// Fixed channel names only; no Node access is exposed to the renderer.
const api = {
  listClasses: () => call<ClassInfo[]>('classes:list'),
  createClass: (name: string) => call<ClassInfo>('classes:create', name),
  listStudents: (classId: string) => call<Student[]>('students:list', classId),
  addStudent: (classId: string, name: string) => call<Student>('students:add', classId, name),
  renameStudent: (studentId: string, name: string) => call<Student>('students:rename', studentId, name),
  getSeating: (classId: string) => call<SeatingArrangement>('seating:get', classId),
  generateSeating: (classId: string) => call<SeatingArrangement>('seating:generate', classId),
  saveSeating: (classId: string, seats: Seat[], expectedVersion: number) =>
    call<SeatingArrangement>('seating:save', classId, seats, expectedVersion),
  requestAiChange: (classId: string, request: string) =>
    call<AiProposal>('ai:request', classId, request),
  setApiKey: (key: string) => call<void>('apiKey:set', key),
  apiKeyStatus: () => call<{ available: boolean }>('apiKey:status')
}

contextBridge.exposeInMainWorld('seating', api)
