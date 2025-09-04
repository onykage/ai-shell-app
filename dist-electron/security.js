"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySecurity = applySecurity;
exports.commonAppSecurity = commonAppSecurity;
const electron_1 = require("electron");
function applySecurity(win) {
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
function commonAppSecurity() {
    electron_1.app.commandLine.appendSwitch('disable-site-isolation-trials');
}
