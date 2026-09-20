import type { AiProposal, ClassInfo, SeatingArrangement, Seat, Student } from '../../shared/types'

declare global {
  interface Window {
    seating: {
      listClasses(): Promise<ClassInfo[]>
      createClass(name: string): Promise<ClassInfo>
      listStudents(classId: string): Promise<Student[]>
      addStudent(classId: string, name: string): Promise<Student>
      renameStudent(studentId: string, name: string): Promise<Student>
      getSeating(classId: string): Promise<SeatingArrangement>
      generateSeating(classId: string): Promise<SeatingArrangement>
      saveSeating(classId: string, seats: Seat[], expectedVersion: number): Promise<SeatingArrangement>
      requestAiChange(classId: string, request: string): Promise<AiProposal>
      setApiKey(key: string): Promise<void>
      apiKeyStatus(): Promise<{ available: boolean }>
    }
  }
}

export {}
