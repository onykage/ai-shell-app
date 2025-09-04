import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getRoot: () => ipcRenderer.invoke('cfg:getRoot'),
  askAI: (prompt: string) =>
    ipcRenderer.invoke("ai:complete", prompt).then((r) =>
      typeof r === "string" ? r : (r?.text ?? "")
    ),
  requestExec: (payload: { id: string, command: string, cwd: string }) => ipcRenderer.invoke('exec:request', payload),
  approveExec: (id: string, approved: boolean) => ipcRenderer.invoke('exec:approve', { id, approved }),
  writeFile: (rel: string, content: string) => ipcRenderer.invoke('fs:write', { rel, content }),
  // NEW:
  saveAs: (suggested: string, content: string) => ipcRenderer.invoke('fs:saveAs', { suggested, content }),
  getConfig: () => ipcRenderer.invoke("cfg:get"),
  updateConfig: (patch: any) => ipcRenderer.invoke("cfg:update", patch),
  selectRoot: () => ipcRenderer.invoke('cfg:selectRoot'),
  onExecPending: (cb: (req: { id: string; command: string; cwd: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('exec:pending', handler)
    return () => ipcRenderer.removeListener('exec:pending', handler)
  },
  pickFile: () => ipcRenderer.invoke('fs:pickFile'),
  getMem: () => ipcRenderer.invoke("sys:mem"),
})
