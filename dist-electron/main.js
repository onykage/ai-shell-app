"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/main.ts
const electron_1 = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const node_child_process_1 = require("node:child_process");
const node_child_process_2 = require("node:child_process");
const node_util_1 = require("node:util");
const dotenv = require("dotenv");
const jail_1 = require("./jail");
function getAppIconPath() {
    const candidates = [
        path.join(electron_1.app.getAppPath(), "public", "assets", "icon-256.png"),
        path.join(process.cwd(), "public", "assets", "icon-256.png"),
        path.join(__dirname, "../public/assets/icon-256.png"),
        path.join(__dirname, "../../public/assets/icon-256.png"),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p))
                return p;
        }
        catch { }
    }
    return undefined;
}
const exec = (0, node_util_1.promisify)(node_child_process_2.exec);
function migrateConfig() {
    try {
        const p = configPath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, "utf8");
            const parsed = JSON.parse(raw);
            if (!("UI_MODE" in parsed) || parsed.UI_MODE === "split") {
                // Default to AI Only for first-time/legacy configs
                fs.writeFileSync(p, JSON.stringify({ ...parsed, UI_MODE: "aiOnly" }, null, 2), "utf8");
            }
        }
    }
    catch { }
}
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
        if (fs.existsSync(p))
            dotenv.config({ path: p, override: true });
    }
}
catch { /* optional */ }
const DEFAULT_CONFIG = {
    ROOT_DIR: path.join(os.homedir(), "ai-shell-jail"),
    AUTO_EXEC: true,
    PROVIDER: "openai",
    MODEL: "gpt-4o-mini",
    UI_MODE: "aiOnly",
};
function configPath() {
    return path.join(electron_1.app.getPath("userData"), "config.json");
}
function readConfig() {
    try {
        const p = configPath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, "utf8");
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_CONFIG, ...parsed };
        }
    }
    catch { }
    return { ...DEFAULT_CONFIG };
}
async function writeConfig(patch) {
    const next = { ...readConfig(), ...patch };
    await fsp.mkdir(path.dirname(configPath()), { recursive: true });
    await fsp.writeFile(configPath(), JSON.stringify(next, null, 2), "utf8");
    return next;
}
// ─────────────────────────────────────────────────────────────
// Ensure jail exists on startup
// ─────────────────────────────────────────────────────────────
async function ensureJail() {
    const root = readConfig().ROOT_DIR;
    await fsp.mkdir(root, { recursive: true });
    (0, jail_1.setRootDir)(root); // make sure jail.ts knows the current root
}
// ─────────────────────────────────────────────────────────────
// BrowserWindow
// ─────────────────────────────────────────────────────────────
let mainWindow = null;
async function createWindow() {
    await ensureJail();
    mainWindow = new electron_1.BrowserWindow({
        width: 1120,
        height: 780,
        title: "Kage 2.0",
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true, // ← enable <webview> for the Editor pane
        },
    });
    const DEV_URL = process.env.VITE_DEV_SERVER_URL || process.env.DEV_SERVER_URL || "";
    if (DEV_URL) {
        await mainWindow.loadURL(DEV_URL);
    }
    else {
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
    const macAppSubmenu = [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
    ];
    const fileSubmenu = [
        {
            label: "Settings",
            accelerator: "CmdOrCtrl+,",
            click: () => mainWindow?.webContents.send("menu:cmd", "openSettings"),
        },
        { label: "Toggle Editor Console",
            accelerator: "CmdOrCtrl+Shift+K",
            click: () => mainWindow?.webContents.send("menu:cmd", "toggleEditorConsole"),
        },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => mainWindow?.webContents.send("menu:cmd", "file:open") },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => mainWindow?.webContents.send("menu:cmd", "file:save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => mainWindow?.webContents.send("menu:cmd", "file:saveAs") },
        {
            label: "Select Working Directory…",
            click: async () => {
                const res = await electron_1.dialog.showOpenDialog({
                    title: "Select working directory (jail root)",
                    properties: ["openDirectory", "createDirectory"],
                });
                if (!res.canceled && res.filePaths[0]) {
                    // Let renderer refresh its view of config/root
                    mainWindow?.webContents.send("menu:cmd", "reloadConfigAfterRootPick", res.filePaths[0]);
                }
            },
        },
        { type: "separator" },
        isMac ? { role: "close" }
            : { role: "quit" },
    ];
    const aiSubmenu = [
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
    const viewSubmenu = [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { label: "AI Only", accelerator: "CmdOrCtrl+1", click: () => mainWindow?.webContents.send("menu:cmd", "ui:aiOnly") },
        { label: "Split View", accelerator: "CmdOrCtrl+2", click: () => mainWindow?.webContents.send("menu:cmd", "ui:split") },
        { label: "Editor Only", accelerator: "CmdOrCtrl+3", click: () => mainWindow?.webContents.send("menu:cmd", "ui:editorOnly") },
    ];
    const helpSubmenu = [
        {
            label: "Open Jail Folder",
            click: () => electron_1.shell.openPath((0, jail_1.getRootDir)()),
        },
        {
            label: "Open Config Folder",
            click: () => electron_1.shell.openPath(electron_1.app.getPath("userData")),
        },
    ];
    const template = [
        ...(isMac
            ? [{ label: electron_1.app.name, submenu: macAppSubmenu }]
            : []),
        { label: "File", submenu: fileSubmenu },
        { label: "AI", submenu: aiSubmenu },
        { label: "View", submenu: viewSubmenu },
        { label: "Help", submenu: helpSubmenu },
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
// ─────────────────────────────────────────────────────────────
// OpenAI (Responses API) minimal wrapper
// ─────────────────────────────────────────────────────────────
async function complete(prompt) {
    const { MODEL, PROVIDER } = readConfig();
    if ((PROVIDER || "openai").toLowerCase() !== "openai") {
        throw new Error(`Provider '${PROVIDER}' not implemented in main`);
    }
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY;
    if (!key)
        throw new Error("OpenAI not configured");
    const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL || "gpt-4o-mini", input: prompt }),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`OpenAI error: ${res.status} ${txt}`);
    }
    const data = await res.json();
    const text = data?.output?.[0]?.content?.[0]?.text ??
        data?.output_text ??
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        JSON.stringify(data);
    return String(text);
}
const pendingById = new Map();
function pushExecToRenderer(req) {
    if (!mainWindow)
        return;
    mainWindow.webContents.send("exec:pending", req);
}
// ─────────────────────────────────────────────────────────────
// AI cancel tokens (Stop button support)
// ─────────────────────────────────────────────────────────────
/** We don't abort HTTP here; we ignore stale responses via tokens. */
const aiTokens = new Map();
function listAISources() {
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
            models: [], // TODO: populate from Chatly once supported
        },
        {
            id: "v0",
            label: "v0.dev",
            envVar: v0Has ? (env.V0_API_KEY ? "V0_API_KEY" : "VERCEL_V0_API_KEY") : "V0_API_KEY",
            hasKey: v0Has,
            supported: false, // TODO: implement provider call
            models: [], // TODO: populate dynamically
        },
    ];
}
// ─────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────
function registerIpc() {
    // Root helpers
    electron_1.ipcMain.handle("getRoot", async () => ({ ok: true, root: (0, jail_1.getRootDir)() }));
    electron_1.ipcMain.handle("cfg:getRoot", async () => ({ ok: true, root: (0, jail_1.getRootDir)() }));
    // Config
    electron_1.ipcMain.handle("cfg:get", async () => ({ ok: true, config: readConfig(), bridge: true, root: (0, jail_1.getRootDir)() }));
    electron_1.ipcMain.handle("cfg:update", async (_e, patch) => {
        const next = await writeConfig(patch || {});
        // keep jail.ts in sync if root changed
        if (patch.ROOT_DIR)
            (0, jail_1.setRootDir)(next.ROOT_DIR);
        return { ok: true, config: next };
    });
    electron_1.ipcMain.handle("ai:sources", async () => {
        return { ok: true, sources: listAISources() };
    });
    electron_1.ipcMain.handle("cfg:selectRoot", async () => {
        const res = await electron_1.dialog.showOpenDialog({
            title: "Select working directory (jail root)",
            properties: ["openDirectory", "createDirectory"],
        });
        if (res.canceled || !res.filePaths?.[0])
            return { canceled: true };
        const next = await writeConfig({ ROOT_DIR: res.filePaths[0] });
        (0, jail_1.setRootDir)(next.ROOT_DIR);
        return { ok: true, root: next.ROOT_DIR };
    });
    // Pick a file (constrained to jail), read it, report preview-ability + file:// URL
    electron_1.ipcMain.handle("editor:openDialog", async () => {
        const root = (0, jail_1.getRootDir)();
        const res = await electron_1.dialog.showOpenDialog({
            title: "Open File",
            defaultPath: root,
            properties: ["openFile"],
        });
        if (res.canceled || !res.filePaths[0])
            return { ok: false, canceled: true };
        // Normalize & verify the path stays inside the jail (Windows-safe)
        const absPicked = path.normalize(res.filePaths[0]);
        const rootNorm = path.normalize(root);
        // Must be the same drive and inside root
        const inside = absPicked.toLowerCase() === rootNorm.toLowerCase() ||
            absPicked.toLowerCase().startsWith(rootNorm.toLowerCase() + path.sep);
        if (!inside) {
            await electron_1.dialog.showMessageBox({
                type: "error",
                title: "Outside Working Directory",
                message: "Selected file is outside the Working Directory (jail).",
                detail: `Working Directory:\n${root}\n\nSelected:\n${absPicked}`,
            });
            return { ok: false, canceled: true, reason: "outside-jail" };
        }
        const rel = path.relative(rootNorm, absPicked);
        const content = await fsp.readFile(absPicked, "utf8");
        const ext = path.extname(absPicked).toLowerCase();
        const previewable = [".html", ".htm", ".md", ".markdown"].includes(ext);
        const fileURL = "file://" + absPicked.replace(/\\/g, "/");
        return { ok: true, rel, abs: absPicked, content, previewable, fileURL };
    });
    electron_1.ipcMain.handle("editor:save", async (_e, args) => {
        const abs = (0, jail_1.jailedPath)(args.rel);
        await fsp.writeFile(abs, args.content, "utf8");
        return { ok: true };
    });
    electron_1.ipcMain.handle("editor:saveAs", async (_e, args) => {
        const root = (0, jail_1.getRootDir)();
        const defaultPath = args.suggestRel ? path.join(root, args.suggestRel) : root;
        const res = await electron_1.dialog.showSaveDialog({
            title: "Save As",
            defaultPath,
        });
        if (res.canceled || !res.filePath)
            return { ok: false, canceled: true };
        const rel = path.relative(root, res.filePath);
        const abs = (0, jail_1.jailedPath)(rel);
        await fsp.writeFile(abs, args.content, "utf8");
        const ext = path.extname(abs).toLowerCase();
        const previewable = [".html", ".htm", ".md", ".markdown"].includes(ext);
        const fileURL = "file://" + abs.replace(/\\/g, "/");
        return { ok: true, rel, abs, previewable, fileURL };
    });
    // File ops (jailed)
    electron_1.ipcMain.handle("fs:write", async (_e, arg1, arg2) => {
        try {
            const rel = typeof arg1 === "string" ? arg1 : arg1?.rel;
            const content = typeof arg1 === "string" ? arg2 : arg1?.content;
            if (!rel)
                throw new Error("Missing rel");
            const dst = (0, jail_1.jailedPath)(rel); // ✅ single-arg form uses current jail root
            await fsp.mkdir(path.dirname(dst), { recursive: true });
            await fsp.writeFile(dst, String(content ?? ""), "utf8");
            return { ok: true, rel };
        }
        catch (err) {
            return { ok: false, error: err?.message || String(err) };
        }
    });
    electron_1.ipcMain.handle("fs:saveAs", async (_e, suggested, content) => {
        const res = await electron_1.dialog.showSaveDialog({
            title: "Save As",
            defaultPath: suggested || "snippet.txt",
            showsTagField: false,
        });
        if (res.canceled || !res.filePath)
            return { canceled: true };
        await fsp.mkdir(path.dirname(res.filePath), { recursive: true });
        await fsp.writeFile(res.filePath, content ?? "", "utf8");
        // If saved into jail, return a rel path too
        let rel;
        try {
            const base = path.resolve((0, jail_1.getRootDir)());
            const abs = path.resolve(res.filePath);
            if (abs === base || abs.startsWith(base + path.sep))
                rel = path.relative(base, abs) || ".";
        }
        catch { }
        return { ok: true, path: res.filePath, rel };
    });
    electron_1.ipcMain.handle("fs:pickFile", async () => {
        const res = await electron_1.dialog.showOpenDialog({ title: "Pick a file to attach", properties: ["openFile"] });
        if (res.canceled || !res.filePaths?.[0])
            return { canceled: true };
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
            }
            else {
                content = buf.toString("utf8");
            }
        }
        catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
        return { ok: true, path: p, name: path.basename(p), size: stat.size, truncated, content };
    });
    // AI
    electron_1.ipcMain.handle("ai:complete", async (e, prompt) => {
        const wcid = e.sender.id;
        const my = (aiTokens.get(wcid) ?? 0) + 1;
        aiTokens.set(wcid, my);
        try {
            const text = await complete(prompt);
            if ((aiTokens.get(wcid) ?? 0) !== my)
                return { ok: false, canceled: true }; // user pressed Stop
            return { ok: true, text };
        }
        catch (err) {
            if ((aiTokens.get(wcid) ?? 0) !== my)
                return { ok: false, canceled: true };
            return { ok: false, error: err?.message ?? String(err) };
        }
    });
    electron_1.ipcMain.handle("ai:cancel", async (e) => {
        const wcid = e.sender.id;
        aiTokens.set(wcid, (aiTokens.get(wcid) ?? 0) + 1);
        return { ok: true, canceled: true };
    });
    // Exec approval flow
    electron_1.ipcMain.handle("exec:request", async (_e, payload) => {
        const id = payload?.id || String(Date.now());
        // Always lock CWD to the jail root; ignore renderer-provided cwd
        const req = {
            id,
            command: String(payload?.command || ""),
            cwd: (0, jail_1.getRootDir)(),
        };
        pendingById.set(id, req);
        pushExecToRenderer(req);
        return { queued: true };
    });
    electron_1.ipcMain.handle("exec:approve", async (_e, id, approved) => {
        const req = pendingById.get(id);
        if (!req)
            return { status: "error", error: "Unknown request id" };
        pendingById.delete(id);
        if (!approved)
            return { status: "rejected" };
        try {
            const jail = (0, jail_1.getRootDir)();
            async function runPowerShell(command) {
                return new Promise((resolve) => {
                    const child = (0, node_child_process_1.spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: jail, windowsHide: true });
                    let stdout = "";
                    let stderr = "";
                    child.stdout.on("data", (d) => (stdout += d.toString()));
                    child.stderr.on("data", (d) => (stderr += d.toString()));
                    child.on("close", (code) => resolve({ code, stdout, stderr }));
                    // 10 min hard timeout
                    setTimeout(() => child.kill("SIGKILL"), 10 * 60 * 1000);
                });
            }
            async function runSh(command) {
                return new Promise((resolve) => {
                    const child = (0, node_child_process_1.spawn)("/bin/sh", ["-lc", command], { cwd: jail });
                    let stdout = "";
                    let stderr = "";
                    child.stdout.on("data", (d) => (stdout += d.toString()));
                    child.stderr.on("data", (d) => (stderr += d.toString()));
                    child.on("close", (code) => resolve({ code, stdout, stderr }));
                    setTimeout(() => child.kill("SIGKILL"), 10 * 60 * 1000);
                });
            }
            const result = process.platform === "win32"
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
        }
        catch (e) {
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
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.whenReady().then(async () => {
    migrateConfig();
    registerIpc();
    await createWindow();
    createAppMenu();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
// Open external links in the default browser
electron_1.app.on("web-contents-created", (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
});
