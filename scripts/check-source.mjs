import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const list = file => readFileSync(resolve(root, file), 'utf8').trim().split(/\r?\n/);
const files = list('scripts/release-files.txt');
assert.equal(new Set(files).size, files.length, 'Duplicate package path');
const originals = list('docs/ORIGINALS.sha256');
assert.equal(originals.length, 11, 'Original asset count');
const originalPaths = new Set();
for (const line of originals) {
  const [, expected, path] = /^([a-fA-F0-9]{64})  ([\w./-]+)$/.exec(line) ?? [];
  assert.ok(files.includes(path) && !originalPaths.has(path), 'Original asset manifest entry');
  originalPaths.add(path);
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'),
    expected.toLowerCase(), path);
}
assert.ok(originalPaths.has('LICENSE'), 'Upstream LICENSE must be checked');
const license = readFileSync(resolve(root, 'LICENSE'), 'utf8');
const notice = readFileSync(resolve(root, 'NOTICE.md'), 'utf8');
assert.match(license, /PolyForm Noncommercial License 1\.0\.0/);
for (const required of [
  'Required Notice: Copyright (c) 2026 Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT) - https://github.com/Ryder191/haloflux',
  'Required Notice: Noncommercial use only. Any commercial use is strictly prohibited. No commercial licenses are offered.',
  'Li Xian（李显）', 'unofficial',
]) assert.ok(notice.includes(required), 'NOTICE is missing required attribution or restrictions');
const sensitive = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\b(?:sk-(?:proj-)?[\w-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[\w]{25,}|AKIA[A-Z0-9]{16}|xox[baprs]-[\w-]{18,})\b/,
  /\beyJ[\w-]{15,}\.eyJ[\w-]{15,}\.[\w-]{15,}\b/,
  /(?:[a-z]:[\\/]Users[\\/]|\/(?:Users|home)\/)[\w.-]+[\\/]/i,
];
const excluded = /(?:^|\/)(?:\.git|\.env(?:\.[^/]*)?|\.codex|dist|output|node_modules|auth\.json)(?:\/|$)/i;
for (const file of files) {
  assert.match(file, /^(?:[\w-]+\/)*[\w.-]+$/);
  assert.ok(!file.split('/').some(part => part === '.' || part === '..') && !excluded.test(file), 'Disallowed release path');
  const path = resolve(root, file);
  const inside = relative(root, realpathSync(path));
  assert.ok(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep), file);
  assert.ok(lstatSync(path).isFile(), file);
  const content = readFileSync(path).toString('utf8');
  assert.ok(!sensitive.some(pattern => pattern.test(content)), 'Sensitive data pattern in ' + file);
  if (/\.[cm]?js$/.test(file)) {
    const syntax = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit', windowsHide: true });
    assert.equal(syntax.status, 0, file);
  }
}
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json')));
assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }).length, 0);
console.log(files.length + ' allowlisted paths, 11 original hashes, license, notices, syntax and sensitive data scan passed.');
