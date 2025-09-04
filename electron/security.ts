import { app, BrowserWindow } from 'electron'

export function applySecurity(win: BrowserWindow) {
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function commonAppSecurity() {
  app.commandLine.appendSwitch('disable-site-isolation-trials')
}
