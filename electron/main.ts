// electron/main.ts
import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { exec as cpExec } from "node:child_process";
import type { ExecOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import * as dotenv from "dotenv";

import { getRootDir, setRootDir, jailedPath } from "./jail";

const exec = promisify(cpExec);

// ─────────────────────────────────────────────────────────────
// Load env for MAIN (so OPENAI_API_KEY is available here)
// ─────────────────────────────────────────────────────────────
try {
  const CWD = process.cwd();
  const candidates = [
    path.join(CWD, ".env"),
    path.join(CWD, ".env.development"),
    path.join(CWD, ".env.local"),
    path.join(CWD, ".env.development.local"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  }
} catch { /* optional */ }

// ─────────────────────────────────────────────────────────────
// Types & minimal config helpers (stored under userData/config.json)
// ─────────────────────────────────────────────────────────────
type AppConfig = {
  ROOT_DIR: string;
  AUTO_EXEC: boolean;
  PROVIDER: string;
  MODEL: string;
  SEND_ON_ENTER?: boolean; // future setting
};

const DEFAULT_CONFIG: AppConfig = {
  ROOT_DIR: path.join(os.homedir(), "ai-shell-jail"),
  AUTO_EXEC: true,
  PROVIDER: "openai",
  MODEL: "gpt-4o-mini",
};

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

async function writeConfig(patch: Partial<AppConfig>) {
  const next = { ...readConfig(), ...patch };
  await fsp.mkdir(path.dirname(configPath()), { recursive: true });
  await fsp.writeFile(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next as AppConfig;
}

// ─────────────────────────────────────────────────────────────
// Ensure jail exists on startup
// ─────────────────────────────────────────────────────────────
async function ensureJail() {
  const root = readConfig().ROOT_DIR;
  await fsp.mkdir(root, { recursive: true });
  setRootDir(root); // make sure jail.ts knows the current root
}

// ─────────────────────────────────────────────────────────────
// BrowserWindow
// ─────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  await ensureJail();

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    title: "Kage 2.0",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const DEV_URL = process.env.VITE_DEV_SERVER_URL || process.env.DEV_SERVER_URL || "";
  if (DEV_URL) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Keep our title regardless of <title> in the page
  mainWindow.on("page-title-updated", (e) => {
    e.preventDefault();
    mainWindow?.setTitle("Kage 2.0");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createAppMenu() {
  const isMac = process.platform === "darwin";

  const macAppSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "about" as const },
    { type: "separator" as const },
    { role: "services" as const },
    { type: "separator" as const },
    { role: "hide" as const },
    { role: "hideOthers" as const },
    { role: "unhide" as const },
    { type: "separator" as const },
    { role: "quit" as const },
  ];

  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Settings",
      accelerator: "CmdOrCtrl+,",
      click: () => mainWindow?.webContents.send("menu:cmd", "openSettings"),
    },
    {
      label: "Select Working Directory…",
      click: async () => {
        const res = await dialog.showOpenDialog({
          title: "Select working directory (jail root)",
          properties: ["openDirectory", "createDirectory"],
        });
        if (!res.canceled && res.filePaths[0]) {
          // Let renderer refresh its view of config/root
          mainWindow?.webContents.send("menu:cmd", "reloadConfigAfterRootPick", res.filePaths[0]);
        }
      },
    },
    { type: "separator" as const },
    isMac ? ({ role: "close" as const } as Electron.MenuItemConstructorOptions)
         : ({ role: "quit"  as const } as Electron.MenuItemConstructorOptions),
  ];

  const aiSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Summarize & Save",
      accelerator: "CmdOrCtrl+S",
      click: () => mainWindow?.webContents.send("menu:cmd", "summarize"),
    },
    {
      label: "Stop",
      accelerator: "Esc",
      click: () => mainWindow?.webContents.send("menu:cmd", "stop"),
    },
  ];

  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "reload" as const },
    { role: "toggleDevTools" as const },
    { type: "separator" as const },
    { role: "togglefullscreen" as const },
  ];

  const helpSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Open Jail Folder",
      click: () => shell.openPath(getRootDir()),
    },
    {
      label: "Open Config Folder",
      click: () => shell.openPath(app.getPath("userData")),
    },
  ];

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: app.name, submenu: macAppSubmenu }]
      : []),
    { label: "File", submenu: fileSubmenu },
    { label: "AI", submenu: aiSubmenu },
    { label: "View", submenu: viewSubmenu },
    { label: "Help", submenu: helpSubmenu },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}


// ─────────────────────────────────────────────────────────────
// OpenAI (Responses API) minimal wrapper
// ─────────────────────────────────────────────────────────────
async function complete(prompt: string): Promise<string> {
  const { MODEL, PROVIDER } = readConfig();
  if ((PROVIDER || "openai").toLowerCase() !== "openai") {
    throw new Error(`Provider '${PROVIDER}' not implemented in main`);
  }
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY;
  if (!key) throw new Error("OpenAI not configured");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL || "gpt-4o-mini", input: prompt }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${res.status} ${txt}`);
  }
  const data: any = await res.json();
  const text =
    data?.output?.[0]?.content?.[0]?.text ??
    data?.output_text ??
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    JSON.stringify(data);
  return String(text);
}

// ─────────────────────────────────────────────────────────────
// Exec queue w/ approval (renderer shows modal)
// ─────────────────────────────────────────────────────────────
type PendingExec = { id: string; command: string; cwd: string };
const pendingById = new Map<string, PendingExec>();

function pushExecToRenderer(req: PendingExec) {
  if (!mainWindow) return;
  mainWindow.webContents.send("exec:pending", req);
}

// ─────────────────────────────────────────────────────────────
// AI cancel tokens (Stop button support)
// ─────────────────────────────────────────────────────────────
/** We don't abort HTTP here; we ignore stale responses via tokens. */
const aiTokens = new Map<number, number>();

// ─────────────────────────────────────────────────────────────
// AI Source / Model inventory (env-aware)
// ─────────────────────────────────────────────────────────────
type AISourceInfo = {
  id: "openai" | "chatly" | "v0";
  label: string;
  envVar: string;
  hasKey: boolean;
  supported: boolean;
  models: string[];
};

function listAISources(): AISourceInfo[] {
  // Read env once (dotenv already loaded at startup)
  const env = process.env;

  // Known sources (You can expand this later)
  const openaiHas = !!(env.OPENAI_API_KEY || env.OPENAI_APIKEY);
  const chatlyHas = !!env.CHATLY_API_KEY;
  const v0Has = !!(env.V0_API_KEY || env.VERCEL_V0_API_KEY);

  // NOTE: Only OpenAI is actually implemented in ai:complete today.
  // chatly and v0 are shown but marked supported:false (UI will disable them).
  return [
    {
      id: "openai",
      label: "ChatGPT",
      envVar: openaiHas ? (env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "OPENAI_APIKEY") : "OPENAI_API_KEY",
      hasKey: openaiHas,
      supported: true,
      // Static list for now; TODO: fetch dynamically from provider
      models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    },
    {
      id: "chatly",
      label: "Chatly",
      envVar: "CHATLY_API_KEY",
      hasKey: chatlyHas,
      supported: false, // TODO: implement provider call
      models: [],       // TODO: populate from Chatly once supported
    },
    {
      id: "v0",
      label: "v0.dev",
      envVar: v0Has ? (env.V0_API_KEY ? "V0_API_KEY" : "VERCEL_V0_API_KEY") : "V0_API_KEY",
      hasKey: v0Has,
      supported: false, // TODO: implement provider call
      models: [],       // TODO: populate dynamically
    },
  ];
}


// ─────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────
function registerIpc() {
  // Root helpers
  ipcMain.handle("getRoot", async () => ({ ok: true, root: getRootDir() }));
  ipcMain.handle("cfg:getRoot", async () => ({ ok: true, root: getRootDir() }));
  // Config
  ipcMain.handle("cfg:get", async () => ({ ok: true, config: readConfig(), bridge: true, root: getRootDir() }));
  ipcMain.handle("cfg:update", async (_e, patch: Partial<AppConfig>) => {
    const next = await writeConfig(patch || {});
    // keep jail.ts in sync if root changed
    if (patch.ROOT_DIR) setRootDir(next.ROOT_DIR);
    return { ok: true, config: next };
  });
  ipcMain.handle("ai:sources", async () => {
    return { ok: true, sources: listAISources() };
  });
  ipcMain.handle("cfg:selectRoot", async () => {
    const res = await dialog.showOpenDialog({
      title: "Select working directory (jail root)",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths?.[0]) return { canceled: true };
    const next = await writeConfig({ ROOT_DIR: res.filePaths[0] });
    setRootDir(next.ROOT_DIR);
    return { ok: true, root: next.ROOT_DIR };
  });

  // File ops (jailed)
  ipcMain.handle("fs:write", async (_e, arg1, arg2) => {
    try {
      const rel = typeof arg1 === "string" ? arg1 : arg1?.rel;
      const content = typeof arg1 === "string" ? arg2 : arg1?.content;
      if (!rel) throw new Error("Missing rel");
      const dst = jailedPath(rel); // ✅ single-arg form uses current jail root
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.writeFile(dst, String(content ?? ""), "utf8");
      return { ok: true, rel };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("fs:saveAs", async (_e, suggested: string, content: string) => {
    const res = await dialog.showSaveDialog({
      title: "Save As",
      defaultPath: suggested || "snippet.txt",
      showsTagField: false,
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    await fsp.mkdir(path.dirname(res.filePath), { recursive: true });
    await fsp.writeFile(res.filePath, content ?? "", "utf8");
    // If saved into jail, return a rel path too
    let rel: string | undefined;
    try {
      const base = path.resolve(getRootDir());
      const abs = path.resolve(res.filePath);
      if (abs === base || abs.startsWith(base + path.sep)) rel = path.relative(base, abs) || ".";
    } catch {}
    return { ok: true, path: res.filePath, rel };
  });

  ipcMain.handle("fs:pickFile", async () => {
    const res = await dialog.showOpenDialog({ title: "Pick a file to attach", properties: ["openFile"] });
    if (res.canceled || !res.filePaths?.[0]) return { canceled: true };
    const p = res.filePaths[0];
    const stat = await fsp.stat(p);
    const MAX = 2 * 1024 * 1024;
    let content = "";
    let truncated = false;
    try {
      const buf = await fsp.readFile(p);
      if (buf.length > MAX) {
        content = buf.subarray(0, MAX).toString("utf8");
        truncated = true;
      } else {
        content = buf.toString("utf8");
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
    return { ok: true, path: p, name: path.basename(p), size: stat.size, truncated, content };
  });

  // AI
  ipcMain.handle("ai:complete", async (e, prompt: string) => {
    const wcid = e.sender.id;
    const my = (aiTokens.get(wcid) ?? 0) + 1;
    aiTokens.set(wcid, my);
    try {
      const text = await complete(prompt);
      if ((aiTokens.get(wcid) ?? 0) !== my) return { ok: false, canceled: true }; // user pressed Stop
      return { ok: true, text };
    } catch (err: any) {
      if ((aiTokens.get(wcid) ?? 0) !== my) return { ok: false, canceled: true };
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle("ai:cancel", async (e) => {
    const wcid = e.sender.id;
    aiTokens.set(wcid, (aiTokens.get(wcid) ?? 0) + 1);
    return { ok: true, canceled: true };
  });

  // Exec approval flow
  ipcMain.handle("exec:request", async (_e, payload: { id: string; command: string; cwd: string }) => {
    const id = payload?.id || String(Date.now());
    // Always lock CWD to the jail root; ignore renderer-provided cwd
    const req: { id: string; command: string; cwd: string } = {
      id,
      command: String(payload?.command || ""),
      cwd: getRootDir(),
    };
    pendingById.set(id, req);
    pushExecToRenderer(req);
    return { queued: true };
  });

  ipcMain.handle("exec:approve", async (_e, id: string, approved: boolean) => {
    const req = pendingById.get(id);
    if (!req) return { status: "error", error: "Unknown request id" };
    pendingById.delete(id);
    if (!approved) return { status: "rejected" };

    try {
      const jail = getRootDir();

      async function runPowerShell(command: string) {
        return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
            { cwd: jail, windowsHide: true }
          );
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (d) => (stdout += d.toString()));
          child.stderr.on("data", (d) => (stderr += d.toString()));
          child.on("close", (code) => resolve({ code, stdout, stderr }));
          // 10 min hard timeout
          setTimeout(() => child.kill("SIGKILL"), 10 * 60 * 1000);
        });
      }

      async function runSh(command: string) {
        return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn("/bin/sh", ["-lc", command], { cwd: jail });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (d) => (stdout += d.toString()));
          child.stderr.on("data", (d) => (stderr += d.toString()));
          child.on("close", (code) => resolve({ code, stdout, stderr }));
          setTimeout(() => child.kill("SIGKILL"), 10 * 60 * 1000);
        });
      }

      const result =
        process.platform === "win32"
          ? await runPowerShell(req.command)
          : await runSh(req.command);

      if (result.code && result.code !== 0) {
        // Non-zero exit → surface as error to renderer
        return {
          status: "error",
          error: `Exit ${result.code}`,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
        };
      }

      return { status: "done", code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr };
    } catch (e: any) {
      return {
        status: "error",
        error: e?.message || "exec error",
        stdout: e?.stdout ?? "",
        stderr: e?.stderr ?? "",
      };
    }

  });
}

// ─────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  createAppMenu();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Open external links in the default browser
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
});
