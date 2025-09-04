import * as path from 'node:path'
import * as fs from 'node:fs'

let ROOT_DIR = ''

export function setRootDir(dir: string) {
  ROOT_DIR = path.resolve(dir)
  if (!fs.existsSync(ROOT_DIR)) fs.mkdirSync(ROOT_DIR, { recursive: true })
}

export function getRootDir() {
  return ROOT_DIR
}

export function inJail(p: string) {
  const resolved = path.resolve(p)
  return resolved.startsWith(ROOT_DIR + path.sep)
}

export function jailedPath(rootDir: string, rel: string) {
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