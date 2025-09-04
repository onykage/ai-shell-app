"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRootDir = setRootDir;
exports.getRootDir = getRootDir;
exports.inJail = inJail;
exports.jailedPath = jailedPath;
const path = require("node:path");
const fs = require("node:fs");
let ROOT_DIR = '';
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
    return resolved.startsWith(ROOT_DIR + path.sep);
}
function jailedPath(rootDir, rel) {
    if (typeof rel !== 'string') {
        throw new TypeError(`jailedPath: rel must be string; got ${typeof rel}`);
    }
    // Normalize and strip any leading slashes to keep join relative
    const clean = path.normalize(rel).replace(/^([/\\])+/, '');
    const abs = path.join(rootDir, clean);
    const root = path.resolve(rootDir);
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(root)) {
        throw new Error('Path escapes jail');
    }
    return resolved;
}
