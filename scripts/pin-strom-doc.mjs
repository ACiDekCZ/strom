#!/usr/bin/env node
// Pins "How Strom works" (the strom-doc repository) to one commit for this app.
//
//   node scripts/pin-strom-doc.mjs [sha]      (npm run help:pin -- [sha])
//
// Source: $STROM_DOC_DIR, else ../strom-doc next to this repository. Without a
// sha it takes that clone's origin/main (fetch it first). A commit that is not
// on origin/main is refused: the app only carries published text.
//
// It replaces vendor/strom-doc/ with cs/ en/ de/ pl/ REJSTRIK.md CISLA.md
// LICENSE of that commit (git archive: the commit, never the working tree),
// writes vendor/strom-doc/PIN and "stromDoc" in package.json. The build reads
// only vendor/, so moving the pin is one commit here and needs no network.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(process.env.STROM_DOC_DIR || join(ROOT, '..', 'strom-doc'));
const VENDOR = join(ROOT, 'vendor', 'strom-doc');
const PATHS = ['cs', 'en', 'de', 'pl', 'REJSTRIK.md', 'CISLA.md', 'LICENSE'];

const fail = (message) => {
    console.error(`help:pin: ${message}`);
    process.exit(1);
};
const git = (...args) => execFileSync('git', ['-C', SOURCE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

if (!existsSync(join(SOURCE, '.git'))) fail(`${SOURCE} is not a strom-doc clone (set STROM_DOC_DIR)`);

const wanted = process.argv[2] || 'origin/main';
let sha;
try {
    sha = git('rev-parse', '--verify', `${wanted}^{commit}`);
} catch {
    fail(`${wanted} is not a commit of ${SOURCE}`);
}
try {
    execFileSync('git', ['-C', SOURCE, 'merge-base', '--is-ancestor', sha, 'origin/main'], { stdio: 'ignore' });
} catch {
    fail(`${sha} is not on origin/main of ${SOURCE}; only published text is pinned`);
}

const archive = execFileSync('git', ['-C', SOURCE, 'archive', '--format=tar', sha, ...PATHS], { maxBuffer: 256 * 1024 * 1024 });
rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(VENDOR, { recursive: true });
execFileSync('tar', ['-x', '-C', VENDOR], { input: archive });
writeFileSync(join(VENDOR, 'PIN'), sha + '\n');

const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
// a new key goes right after "version" (the app's version and its documentation side by side)
const next = 'stromDoc' in pkg ? { ...pkg, stromDoc: sha } : Object.fromEntries(
    Object.entries(pkg).flatMap(([k, v]) => (k === 'version' ? [[k, v], ['stromDoc', sha]] : [[k, v]])));
writeFileSync(pkgPath, JSON.stringify(next, null, 2) + '\n');

console.log(`help:pin: vendor/strom-doc = strom-doc ${sha}`);
