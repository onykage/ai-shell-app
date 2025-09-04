"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCwdInsideJail = validateCwdInsideJail;
exports.runPowershell = runPowershell;
exports.wireExecHandlers = wireExecHandlers;
const node_child_process_1 = require("node:child_process");
const path = require("node:path");
const jail_1 = require("./jail");
function validateCwdInsideJail(cwd) {
    const base = (0, jail_1.getRootDir)();
    const resolved = path.resolve(cwd || base);
    const rel = path.relative(base, resolved);
    return (0, jail_1.jailedPath)(rel); // throws if outside
}
function runPowershell(cmd, cwd) {
    const ps = (0, node_child_process_1.spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd], { cwd, windowsHide: true });
    return ps;
}
function wireExecHandlers(_win, approve) {
    return async (req) => {
        const safeCwd = validateCwdInsideJail(req.cwd);
        const ok = await approve(req);
        if (!ok)
            throw new Error("Command not approved");
        const child = runPowershell(req.command, safeCwd);
        return new Promise((resolve) => {
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (d) => (stdout += d.toString()));
            child.stderr.on("data", (d) => (stderr += d.toString()));
            child.on("close", (code) => resolve({ code, stdout, stderr }));
            setTimeout(() => child.kill("SIGKILL"), 5 * 60 * 1000); // 5m hard timeout
        });
    };
}
