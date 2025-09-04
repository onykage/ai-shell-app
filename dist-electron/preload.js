"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    getRoot: () => electron_1.ipcRenderer.invoke('cfg:getRoot'),
    askAI: (prompt) => electron_1.ipcRenderer.invoke("ai:complete", prompt).then((r) => typeof r === "string" ? r : (r?.text ?? "")),
    requestExec: (payload) => electron_1.ipcRenderer.invoke('exec:request', payload),
    approveExec: (id, approved) => electron_1.ipcRenderer.invoke('exec:approve', { id, approved }),
    writeFile: (rel, content) => electron_1.ipcRenderer.invoke('fs:write', { rel, content }),
    // NEW:
    saveAs: (suggested, content) => electron_1.ipcRenderer.invoke('fs:saveAs', { suggested, content }),
    getConfig: () => electron_1.ipcRenderer.invoke("cfg:get"),
    updateConfig: (patch) => electron_1.ipcRenderer.invoke("cfg:update", patch),
    selectRoot: () => electron_1.ipcRenderer.invoke('cfg:selectRoot'),
    onExecPending: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on('exec:pending', handler);
        return () => electron_1.ipcRenderer.removeListener('exec:pending', handler);
    },
    pickFile: () => electron_1.ipcRenderer.invoke('fs:pickFile'),
    getMem: () => electron_1.ipcRenderer.invoke("sys:mem"),
});
