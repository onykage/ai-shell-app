"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/main.ts
const electron_1 = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const security_js_1 = require("./security.js");
const jail_js_1 = require("./jail.js");
const index_js_1 = require("./providers/index.js");
const dotenv_1 = require("dotenv");
// Load in priority order, allowing later files to override earlier ones
const CWD = process.cwd();
const envCandidates = [
    path.join(CWD, ".env"),
    path.join(CWD, ".env.development"),
    path.join(CWD, ".env.local"), // your file
    path.join(CWD, ".env.development.local"), // if you use this
];
for (const p of envCandidates) {
    if (fs.existsSync(p)) {
        (0, dotenv_1.config)({ path: p, override: true }); // let .env.local win
    }
}
// Optional: quick sanity log (won't print the key)
console.log("[ai] OPENAI_API_KEY present in main:", Boolean(process.env.OPENAI_API_KEY));
(0, security_js_1.commonAppSecurity)();
let mainWindow = null;
const CONFIG_PATH = path.join(process.cwd(), "config.json");
function loadConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, "utf8");
        const j = JSON.parse(raw);
        return {
            ROOT_DIR: j.ROOT_DIR || (0, jail_js_1.getRootDir)(),
            AUTO_EXEC: j.AUTO_EXEC ?? true,
            PROVIDER: j.PROVIDER || (process.env.AI_PROVIDER || "openai"),
            MODEL: j.MODEL || (process.env.AI_MODEL || "gpt-4.1-mini"),
        };
    }
    catch {
        return {
            ROOT_DIR: (0, jail_js_1.getRootDir)(),
            AUTO_EXEC: true,
            PROVIDER: (process.env.AI_PROVIDER || "openai"),
            MODEL: (process.env.AI_MODEL || "gpt-4.1-mini"),
        };
    }
}
function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
let appCfg = loadConfig();
// ----------------------- Window / Boot ------------------------
async function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1120,
        height: 760,
        minWidth: 900,
        minHeight: 600,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });
    // Hide menu everywhere
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu?.();
    electron_1.Menu.setApplicationMenu(null);
    mainWindow.on("page-title-updated", (e) => {
        e.preventDefault();
        mainWindow.setTitle("Kage 2.0");
    });
    (0, security_js_1.applySecurity)(mainWindow);
    // Vite dev vs. file URL
    const devURL = "http://localhost:5173";
    try {
        await mainWindow.loadURL(devURL);
    }
    catch {
        await mainWindow.loadFile(path.join(process.cwd(), "dist", "index.html"));
    }
    mainWindow.on("closed", () => { mainWindow = null; });
}
// Initialize jail root (env > config > sandbox)
function initRoot() {
    const envRoot = process.env.APP_ROOT || process.env.ROOT_DIR;
    const cfgRoot = appCfg.ROOT_DIR;
    const root = envRoot || cfgRoot || path.join(process.cwd(), "sandbox");
    (0, jail_js_1.setRootDir)(root);
    appCfg.ROOT_DIR = root;
}
electron_1.app.whenReady().then(async () => {
    initRoot();
    // NOTE: your initProvider type only accepts { provider?, openaiKey? }
    (0, index_js_1.initProvider)({
        provider: appCfg.PROVIDER,
        openaiKey: process.env.OPENAI_API_KEY,
        // model: appCfg.MODEL,  // ❌ removed: your type doesn’t accept 'model'
    });
    registerIpc(); // <-- all handlers in one place
    await createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
// --------------------------- Helpers --------------------------
function validateCwdInsideJail(cwd) {
    const root = path.resolve((0, jail_js_1.getRootDir)());
    const resolved = path.resolve(cwd || root);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error("Path escapes jail");
    }
    return resolved;
}
// ----------------------------- IPC ----------------------------
function registerIpc() {
    // dev-friendly: ensure single registration
    const chans = [
        "getRoot",
        "cfg:getRoot", // alias for older renderer calls
        "fs:write",
        "fs:saveAs",
        "fs:pickFile",
        "cfg:get",
        "cfg:update",
        "cfg:selectRoot",
        "ai:complete",
        "exec:request",
        "exec:approve",
        "sys:mem",
    ];
    chans.forEach((c) => electron_1.ipcMain.removeHandler(c));
    // --- Root (new + legacy alias) ---
    electron_1.ipcMain.handle("getRoot", async () => ({ ok: true, root: (0, jail_js_1.getRootDir)() }));
    electron_1.ipcMain.handle("cfg:getRoot", async () => ({ ok: true, root: (0, jail_js_1.getRootDir)() })); // 🔁 alias
    // --- File ops (write is jailed; saveAs can save outside) ---
    electron_1.ipcMain.handle("fs:write", async (_e, arg1, arg2) => {
        try {
            const rel = typeof arg1 === "string" ? arg1 : arg1.rel;
            const content = typeof arg1 === "string" ? arg2 : arg1.content;
            if (!rel)
                throw new Error("Missing rel path");
            const abs = (0, jail_js_1.jailedPath)(rel); // ✅ ensures inside jail
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            await fsp.writeFile(abs, content);
            return { ok: true, rel };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle("sys:mem", async () => {
        try {
            const sys = process.getSystemMemoryInfo(); // { total, free, ... } in KB
            const proc = await process.getProcessMemoryInfo(); // { workingSetSize, private, ... } in KB
            return { ok: true, sys, proc };
        }
        catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    });
    electron_1.ipcMain.handle("fs:saveAs", async (_e, suggested, content) => {
        const { canceled, filePath } = await electron_1.dialog.showSaveDialog(electron_1.BrowserWindow.getFocusedWindow(), {
            title: "Save file",
            defaultPath: path.join((0, jail_js_1.getRootDir)(), suggested || "snippet.txt"),
        });
        if (canceled || !filePath)
            return { canceled: true };
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, content, "utf8");
        const root = path.resolve((0, jail_js_1.getRootDir)());
        const rel = filePath.startsWith(root + path.sep) ? path.relative(root, filePath) : undefined;
        return { ok: true, path: filePath, rel };
    });
    // --- Import from anywhere (no jail) ---
    let lastPickDir = null;
    electron_1.ipcMain.handle("fs:pickFile", async () => {
        const start = lastPickDir || (0, jail_js_1.getRootDir)();
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(electron_1.BrowserWindow.getFocusedWindow(), {
            title: "Select a file",
            defaultPath: start,
            properties: ["openFile"],
        });
        if (canceled || !filePaths?.length)
            return { canceled: true };
        const chosen = path.resolve(filePaths[0]);
        lastPickDir = path.dirname(chosen);
        const MAX = 200 * 1024;
        let contentUtf8 = await fsp.readFile(chosen, "utf8");
        let truncated = false;
        if (Buffer.byteLength(contentUtf8, "utf8") > MAX) {
            contentUtf8 = contentUtf8.slice(0, MAX);
            truncated = true;
        }
        const root = path.resolve((0, jail_js_1.getRootDir)());
        const rel = chosen.startsWith(root + path.sep) ? path.relative(root, chosen) : undefined;
        const stat = await fsp.stat(chosen);
        return {
            ok: true,
            path: chosen,
            rel,
            name: path.basename(chosen),
            size: stat.size,
            truncated,
            content: contentUtf8,
        };
    });
    // --- Config (get/update/selectRoot) ---
    electron_1.ipcMain.handle("cfg:get", async () => ({
        ok: true,
        config: appCfg,
        bridge: true,
        root: (0, jail_js_1.getRootDir)(),
    }));
    electron_1.ipcMain.handle("cfg:update", async (_e, patch) => {
        appCfg = { ...appCfg, ...patch };
        if (patch.ROOT_DIR)
            (0, jail_js_1.setRootDir)(patch.ROOT_DIR);
        saveConfig(appCfg);
        // Re-init provider (still no 'model' arg here due to type constraints)
        (0, index_js_1.initProvider)({
            provider: appCfg.PROVIDER,
            openaiKey: process.env.OPENAI_API_KEY,
            // model: appCfg.MODEL, // ❌ not supported by your initProvider type
        });
        return { ok: true, config: appCfg };
    });
    electron_1.ipcMain.handle("cfg:selectRoot", async () => {
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(electron_1.BrowserWindow.getFocusedWindow(), {
            title: "Select working directory",
            defaultPath: (0, jail_js_1.getRootDir)(),
            properties: ["openDirectory", "createDirectory"],
        });
        if (canceled || !filePaths?.length)
            return { canceled: true };
        const chosen = path.resolve(filePaths[0]);
        (0, jail_js_1.setRootDir)(chosen);
        appCfg.ROOT_DIR = chosen;
        saveConfig(appCfg);
        return { ok: true, root: chosen };
    });
    // --- AI ---
    electron_1.ipcMain.handle("ai:complete", async (_e, prompt) => {
        const text = await (0, index_js_1.complete)(prompt);
        return { ok: true, text };
    });
    const pendingApprovals = new Map();
    electron_1.ipcMain.handle("exec:request", async (_e, req) => {
        const safe = { ...req, cwd: (0, jail_js_1.getRootDir)() }; // always run in jail root
        pendingApprovals.set(req.id, safe);
        mainWindow?.webContents.send("exec:pending", safe);
        return { queued: true };
    });
    electron_1.ipcMain.handle("exec:approve", async (_e, { id, approved }) => {
        const req = pendingApprovals.get(id);
        if (!req)
            return { status: "error", error: "request not found" };
        pendingApprovals.delete(id);
        if (!approved)
            return { status: "rejected" };
        try {
            const cwd = validateCwdInsideJail(req.cwd);
            const { exec } = await Promise.resolve().then(() => require("node:child_process"));
            return await new Promise((resolve) => {
                exec(req.command, { cwd, windowsHide: true }, (err, stdout, stderr) => {
                    if (err) {
                        resolve({
                            status: "done",
                            code: err.code ?? 1,
                            stdout: String(stdout ?? ""),
                            stderr: String(stderr ?? "") || String(err),
                        });
                    }
                    else {
                        resolve({ status: "done", code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
                    }
                });
            });
        }
        catch (e) {
            return { status: "error", error: e?.message || String(e) };
        }
    });
}
