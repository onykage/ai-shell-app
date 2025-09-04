import { spawn } from "node:child_process";
import { BrowserWindow } from "electron";
import * as path from "node:path";
import { jailedPath, getRootDir } from "./jail";

export type PendingExec = {
  id: string;
  command: string;
  cwd: string;
};

export function validateCwdInsideJail(cwd: string) {
  const base = getRootDir();
  const resolved = path.resolve(cwd || base);
  const rel = path.relative(base, resolved);
  return jailedPath(rel); // throws if outside
}

export function runPowershell(cmd: string, cwd: string) {
  const ps = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { cwd, windowsHide: true }
  );
  return ps;
}

export function wireExecHandlers(_win: BrowserWindow, approve: (p: PendingExec) => Promise<boolean>) {
  return async (req: PendingExec) => {
    const safeCwd = validateCwdInsideJail(req.cwd);
    const ok = await approve(req);
    if (!ok) throw new Error("Command not approved");

    const child = runPowershell(req.command, safeCwd);

    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => child.kill("SIGKILL"), 5 * 60 * 1000); // 5m hard timeout
    });
  };
}
