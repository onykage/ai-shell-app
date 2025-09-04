"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRootDir = setRootDir;
exports.getRootDir = getRootDir;
exports.inJail = inJail;
exports.jailedPath = jailedPath;
const path = require("node:path");
const fs = require("node:fs");
let ROOT_DIR = "";
function setRootDir(dir) {
    ROOT_DIR = path.resolve(dir);
    if (!fs.existsSync(ROOT_DIR))
        fs.mkdirSync(ROOT_DIR, { recursive: true });
}
function getRootDir() {
    return ROOT_DIR;
}
function inJail(p) {
    const resolved = path.resolve(p);
    const base = path.resolve(ROOT_DIR || ".");
    return resolved === base || resolved.startsWith(base + path.sep);
}
function jailedPath(a, b) {
    const root = b === undefined ? getRootDir() : path.resolve(a);
    const rel = b === undefined ? a : b;
    if (!root)
        throw new Error("Jail root not set; call setRootDir(...) before jailedPath(rel)");
    if (typeof rel !== "string")
        throw new TypeError(`jailedPath: rel must be string; got ${typeof rel}`);
    const clean = path.normalize(rel).replace(/^([/\\])+/, "");
    const abs = path.join(root, clean);
    const base = path.resolve(root);
    const resolved = path.resolve(abs);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        throw new Error("Path escapes jail");
    }
    return resolved;
}
