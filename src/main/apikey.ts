import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// The key is encrypted with OS-backed safeStorage and kept in a small file in
// userData - deliberately outside SQLite.
function keyFile(): string {
  return join(app.getPath('userData'), 'apiKey.bin')
}

export function hasApiKey(): boolean {
  if (!existsSync(keyFile())) return false
  try {
    return safeStorage.decryptString(readFileSync(keyFile())).length > 0
  } catch {
    return false
  }
}

export function setApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API key cannot be empty')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system')
  }
  writeFileSync(keyFile(), safeStorage.encryptString(trimmed))
}

export function getApiKey(): string {
  const encrypted = readFileSync(keyFile())
  return safeStorage.decryptString(encrypted)
}
