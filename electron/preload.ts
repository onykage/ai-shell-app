import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  // call the single canonical channel
  getRoot: () => ipcRenderer.invoke("getRoot"),

  askAI: (prompt: string) =>
    ipcRenderer
      .invoke("ai:complete", prompt)
      .then((r) => (typeof r === "string" ? r : r?.text ?? "")),

  // Stop/cancel an in-flight AI request (renderer UI toggles Send↔Stop)
  cancelAI: () => ipcRenderer.invoke("ai:cancel"),

  requestExec: (payload: { id: string; command: string; cwd: string }) =>
    ipcRenderer.invoke("exec:request", payload),

  approveExec: (id: string, approved: boolean) =>
    ipcRenderer.invoke("exec:approve", id, approved),

  writeFile: (rel: string, content: string) =>
    ipcRenderer.invoke("fs:write", { rel, content }),

  saveAs: (suggested: string, content: string) =>
    ipcRenderer.invoke("fs:saveAs", suggested, content),

  getConfig: () => ipcRenderer.invoke("cfg:get"),
  getAISources: () => ipcRenderer.invoke("ai:sources"),
  updateConfig: (patch: any) => ipcRenderer.invoke("cfg:update", patch),
  selectRoot: () => ipcRenderer.invoke("cfg:selectRoot"),

  onExecPending: (cb: (req: { id: string; command: string; cwd: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on("exec:pending", handler);
    return () => ipcRenderer.removeListener("exec:pending", handler);
  },

  pickFile: () => ipcRenderer.invoke("fs:pickFile"),

  // Menu command hook (from native menu in main.ts)
  onMenu: (cb: (cmd: string) => void) => {
    const handler = (_e: any, cmd: string) => cb(cmd);
    ipcRenderer.on("menu:cmd", handler);
    return () => ipcRenderer.removeListener("menu:cmd", handler);
  },
});
