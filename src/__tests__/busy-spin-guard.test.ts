/**
 * Guard of the one working state (waiting buttons §1.3): every spinner is `.busy-spin` (+ `s12` / `s16`), the older
 * spinner classes and their keyframes are gone from the sources and the stylesheet, and a working element is never
 * dimmed: no rule for `[aria-busy]`, `.is-busy`, `.is-sending` or `[data-busy]` lowers its opacity. The one dimming
 * left is a list read for a filter (`.busy-list-dim`, §6.3); a disabled element (not a working one) keeps its own.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const INDEX = join(SRC, '..', 'index.html');

function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name !== '__tests__') out.push(...sources(path));
        } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
            out.push(path);
        }
    }
    return out;
}

/** The older spinners (classes and keyframes) the one spinner replaced. */
const OLD = [
    'toast-spinner', 'toast-spin', 'research-sync-spinner', 'live-panel-spinner', 'direction-form__spinner',
    'direction-form-spin', 'prc-spinner', 'prc-spin', 'read-task-spin', 'media-spinner', 'media-spin',
    'research-direction__spin', 'phone-spinner', 'phone-spin', 'waiting-audit__spin', 'waiting-audit-spin',
    'research-overview__queue-search-spin {',
];

/**
 * Rotations that stay, each with its reason: the one spinner; the agent's arc at work round a card's avatar, in its
 * rows and marks (a signal of the agent, in one phase across the page, not a waiting element); the satellite strip's
 * icon turning while a window takes over (an icon, not a ring).
 */
const KEYFRAMES_KEPT = new Set(['busy-spin', 'agSpin', 'sat-strip-spin']);

describe('busy-spin guard (§1.3)', () => {
    const index = readFileSync(INDEX, 'utf8');
    const files = sources(SRC).map(path => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

    it('no older spinner class or keyframes in src/ or index.html', () => {
        const found: string[] = [];
        for (const name of OLD) {
            const re = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
            if (re.test(index)) found.push(`index.html: ${name}`);
            for (const f of files) if (re.test(f.text)) found.push(`${f.path}: ${name}`);
        }
        expect(found).toEqual([]);
    });

    it('a turning ring in the stylesheet is the one spinner (or a listed exception)', () => {
        const rotating = [...index.matchAll(/@keyframes\s+([\w-]+)\s*\{\s*(?:from\s*\{[^}]*\}\s*)?to\s*\{\s*transform:\s*rotate\(360deg\)/g)]
            .map(m => m[1]);
        expect(rotating.filter(n => !KEYFRAMES_KEPT.has(n))).toEqual([]);
        expect(rotating).toContain('busy-spin');
    });

    it('a working element is not dimmed', () => {
        const dimmed: string[] = [];
        const css = index.replace(/\/\*[\s\S]*?\*\//g, '');
        // Each innermost rule: what is between its "{" and "}" (split on "}", linear on a large page).
        for (const chunk of css.split('}')) {
            const open = chunk.lastIndexOf('{');
            if (open < 0) continue;
            const selector = chunk.slice(0, open).split(/[{};]/).pop()!.trim();
            const body = chunk.slice(open + 1);
            // The others locked beside a working element (`:not([data-busy])`) are not the working one.
            const own = selector.replace(/:not\([^()]*\)/g, '');
            if (!/\[aria-busy|\.is-busy\b|\.is-sending\b|\[data-busy/.test(own)) continue;
            const opacity = /(?:^|;|\s)opacity\s*:\s*([\d.]+)/.exec(body);
            if (opacity && Number(opacity[1]) < 1) dimmed.push(`${selector} { opacity: ${opacity[1]} }`);
        }
        expect(dimmed).toEqual([]);
    });
});
