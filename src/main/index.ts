import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db'
import { registerIpc } from './ipc'

let db: ReturnType<typeof openDatabase> | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Teacher Seating Planner',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  try {
    db = openDatabase(join(app.getPath('userData'), 'seating.db'))
  } catch (err) {
    dialog.showErrorBox('Seating Planner', (err as Error).message)
    app.exit(1)
    return
  }
  registerIpc(db)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
