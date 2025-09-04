import * as path from "node:path";
import * as fs from "node:fs";

let ROOT_DIR = "";

export function setRootDir(dir: string) {
  ROOT_DIR = path.resolve(dir);
  if (!fs.existsSync(ROOT_DIR)) fs.mkdirSync(ROOT_DIR, { recursive: true });
}

export function getRootDir() {
  return ROOT_DIR;
}

export function inJail(p: string) {
  const resolved = path.resolve(p);
  const base = path.resolve(ROOT_DIR || ".");
  return resolved === base || resolved.startsWith(base + path.sep);
}

/** Resolve a path INSIDE the jail. Supports (rel) or (root, rel). */
export function jailedPath(rel: string): string;
export function jailedPath(rootDir: string, rel: string): string;
export function jailedPath(a: string, b?: string): string {
  const root = b === undefined ? getRootDir() : path.resolve(a);
  const rel = b === undefined ? a : b;

  if (!root) throw new Error("Jail root not set; call setRootDir(...) before jailedPath(rel)");
  if (typeof rel !== "string") throw new TypeError(`jailedPath: rel must be string; got ${typeof rel}`);

  const clean = path.normalize(rel).replace(/^([/\\])+/, "");
  const abs = path.join(root, clean);
  const base = path.resolve(root);
  const resolved = path.resolve(abs);

  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("Path escapes jail");
  }
  return resolved;
}
