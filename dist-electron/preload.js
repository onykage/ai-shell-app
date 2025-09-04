"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("api", {
    // call the single canonical channel
    getRoot: () => electron_1.ipcRenderer.invoke("getRoot"),
    askAI: (prompt) => electron_1.ipcRenderer
        .invoke("ai:complete", prompt)
        .then((r) => (typeof r === "string" ? r : r?.text ?? "")),
    // Stop/cancel an in-flight AI request (renderer UI toggles Send↔Stop)
    cancelAI: () => electron_1.ipcRenderer.invoke("ai:cancel"),
    requestExec: (payload) => electron_1.ipcRenderer.invoke("exec:request", payload),
    approveExec: (id, approved) => electron_1.ipcRenderer.invoke("exec:approve", id, approved),
    writeFile: (rel, content) => electron_1.ipcRenderer.invoke("fs:write", { rel, content }),
    saveAs: (suggested, content) => electron_1.ipcRenderer.invoke("fs:saveAs", suggested, content),
    getConfig: () => electron_1.ipcRenderer.invoke("cfg:get"),
    getAISources: () => electron_1.ipcRenderer.invoke("ai:sources"),
    updateConfig: (patch) => electron_1.ipcRenderer.invoke("cfg:update", patch),
    selectRoot: () => electron_1.ipcRenderer.invoke("cfg:selectRoot"),
    onExecPending: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on("exec:pending", handler);
        return () => electron_1.ipcRenderer.removeListener("exec:pending", handler);
    },
    pickFile: () => electron_1.ipcRenderer.invoke("fs:pickFile"),
    // Menu command hook (from native menu in main.ts)
    onMenu: (cb) => {
        const handler = (_e, cmd) => cb(cmd);
        electron_1.ipcRenderer.on("menu:cmd", handler);
        return () => electron_1.ipcRenderer.removeListener("menu:cmd", handler);
    },
});
