/**
 * The phone's Research screen opens before the tree is on the device (spec 094
 * K3.13): its modules never reach the tree (DataManager), the renderer or the
 * person picker — not even through another module. Type-only imports are
 * erased by the build and do not count; dynamic imports do.
 *
 * A module of the screen added later goes into SCREEN_MODULES.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

/** The modules of the Research screen (paths under src/). */
const SCREEN_MODULES = ['device/device-research-data.ts', 'device/device-agent.ts', 'ui/device-agent-ui.ts', 'ui/phone-research-ui.ts', 'ui/phone-person-search.ts'];

/** Modules the screen must never load. */
const FORBIDDEN_FILES = ['data.ts', 'renderer.ts', 'person-picker.ts'];
/** What the screen must never define through any module it loads (wherever these move). */
const FORBIDDEN_EXPORTS = /^export\s+(?:const|class|let|function)\s+(DataManager|TreeRenderer|PersonPicker)\b/m;

const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

function resolve(from: string, spec: string): string | null {
    const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ''));
    for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (candidate.endsWith('.ts') && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Every module `entry` loads (itself included), with the module that first imported it. */
function graphOf(entry: string): Map<string, string | null> {
    const seen = new Map<string, string | null>([[entry, null]]);
    const stack = [entry];
    while (stack.length) {
        const file = stack.pop()!;
        const source = fs.readFileSync(file, 'utf8');
        for (const m of source.matchAll(IMPORT)) {
            const spec = m[1] ?? m[2];
            if (!spec.startsWith('.')) continue;
            const target = resolve(file, spec);
            if (!target || seen.has(target)) continue;
            seen.set(target, file);
            stack.push(target);
        }
    }
    return seen;
}

function chain(graph: Map<string, string | null>, file: string): string {
    const out: string[] = [];
    for (let f: string | null | undefined = file; f; f = graph.get(f)) out.unshift(path.relative(SRC, f));
    return out.join(' → ');
}

describe('the Research screen of a phone loads no tree', () => {
    it.each(SCREEN_MODULES)('%s reaches neither DataManager, TreeRenderer nor the person picker', (entry) => {
        const file = path.join(SRC, entry);
        expect(fs.existsSync(file)).toBe(true);
        const graph = graphOf(file);
        const bad: string[] = [];
        for (const f of graph.keys()) {
            const rel = path.relative(SRC, f);
            if (FORBIDDEN_FILES.includes(rel) || FORBIDDEN_EXPORTS.test(fs.readFileSync(f, 'utf8'))) bad.push(chain(graph, f));
        }
        expect(bad).toEqual([]);
    });

    it('a type-only import (the UI class of uiModule) is not followed, a value import is', () => {
        const typeOnly = "import type { UIClass } from './index.js';";
        const value = "import { UIClass } from './index.js';";
        expect([...typeOnly.matchAll(IMPORT)]).toHaveLength(0);
        expect([...value.matchAll(IMPORT)].map(m => m[1])).toEqual(['./index.js']);
        // uiModule's own file names the UI class by its type only: the facade (and the whole app) stays out.
        const rel = [...graphOf(path.join(SRC, 'ui/module.ts')).keys()].map(f => path.relative(SRC, f));
        expect(rel).toEqual(['ui/module.ts']);
    });

    it('the check sees a module that does reach them', () => {
        // the walk itself works: the app's start reaches the tree
        const graph = graphOf(path.join(SRC, 'main.ts'));
        const rel = [...graph.keys()].map(f => path.relative(SRC, f));
        expect(rel).toContain('data.ts');
        expect(rel).toContain('renderer.ts');
    });
});
