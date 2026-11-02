/**
 * Guard of the research actions' marks (CLAUDE.md "Marks of research actions"): every control that launches a
 * research link takes its mark from ONE map (`RESEARCH_LINK_MARKS` + `researchLinkMark()` / `researchUrlMark()`),
 * through the shared helpers of `src/ui/research-open-mark.ts` (`researchActionLabel`, `setResearchActionLabel`,
 * `researchActionMark`, `researchMarkFlags`, `researchLinkFlags`). This scans the UI sources:
 *
 * 1. the low-level drawers (`researchOpenLabel`, `setResearchOpenLabel`, `researchOpenMark`) are called only by the
 *    listed generic renderers, which draw the flags their callers derived from the map;
 * 2. no control hard-codes its flags (`research: true`, `ext: true`, `external: true`, `ai: true`, `badge: 'ai'`);
 * 3. no helper is handed a hand-picked group (`'terminal'`, `'agent'`, `'none'` as a whole argument, `mark: '…'`);
 * 4. a control whose run launches the research carries a mark (a flag, `mark:` or the flags of a helper);
 * 5. `↗` stays for the web in a new window, never on an action of the research.
 *
 * Each exception names its file, how many times it may occur and why.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RESEARCH_TOOL_ACTIONS, researchLinkMark } from '../research-link.js';

const SRC = join(__dirname, '..');

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

/** Each source with its lines; whole comment lines are blank (a comment may name a forbidden form). */
const FILES = sources(SRC).map(path => {
    const rel = relative(SRC, path).split('\\').join('/');
    let inBlock = false;
    const lines = readFileSync(path, 'utf8').split('\n').map(line => {
        const t = line.trim();
        if (inBlock) {
            if (t.includes('*/')) inBlock = false;
            return '';
        }
        if (t.startsWith('/*')) {
            if (!t.includes('*/')) inBlock = true;
            return '';
        }
        return t.startsWith('//') || t.startsWith('*') ? '' : line;
    });
    return { rel, lines };
});
const UI = FILES.filter(f => f.rel.startsWith('ui/') && f.rel !== 'ui/research-open-mark.ts');

/** `pattern`'s hits per file (the files with none left out). */
function hits(files: typeof FILES, pattern: RegExp): Record<string, number> {
    const out: Record<string, number> = {};
    for (const f of files) {
        let n = 0;
        for (const line of f.lines) n += line.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
        if (n) out[f.rel] = n;
    }
    return out;
}

/** The whole arguments of every call of `fn` (top-level commas only). */
function callArgs(text: string, fn: string): string[][] {
    const calls: string[][] = [];
    const re = new RegExp(`\\b${fn}\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        let depth = 0;
        let arg = '';
        const args: string[] = [];
        let quote: string | null = null;
        for (let i = m.index + m[0].length; i < text.length; i++) {
            const c = text[i];
            if (quote) {
                arg += c;
                if (c === '\\') { arg += text[++i] ?? ''; continue; }
                if (c === quote) quote = null;
                continue;
            }
            if (c === '\'' || c === '"' || c === '`') { quote = c; arg += c; continue; }
            if (c === '(' || c === '[' || c === '{') depth++;
            if (c === ')' || c === ']' || c === '}') {
                if (depth === 0) { args.push(arg.trim()); break; }
                depth--;
            }
            if (c === ',' && depth === 0) { args.push(arg.trim()); arg = ''; continue; }
            arg += c;
        }
        calls.push(args);
    }
    return calls;
}

describe('the marks of research actions come from the one map', () => {
    it('leaves the low-level drawers to the generic renderers', () => {
        // Each draws the flags its callers derived with researchMarkFlags / researchLinkFlags / researchLinkMark.
        const RENDERERS: Record<string, number> = {
            'ui/misc.ts': 1, // a toast's action ({ research, ai })
            'ui/dialogs.ts': 2, // a choice's button and the dialog's link ({ research })
            'ui/bottom-sheet.ts': 2, // a sheet row ({ ext, ai }) and the sheet's state action ({ research, ai })
            'ui/material-viewer-ui.ts': 2, // the viewer's card buttons and its actions ({ research })
            'ui/context-menu.ts': 1, // a person menu item ({ external } + badge)
            'ui/tree-management.ts': 2, // the tree menu's rows ({ research })
            'ui/tree-actions.ts': 1, // the tree sheet's rows ({ research })
            'ui/research-actions-ui.ts': 1, // a Research submenu item ({ ext, ai } from its link's group)
        };
        expect(hits(UI, /\b(?:researchOpenLabel|setResearchOpenLabel|researchOpenMark)\(/)).toEqual(RENDERERS);
    });

    it('draws the bare terminal glyph only where its group decides it', () => {
        const others = FILES.filter(f => f.rel !== 'history-symbols.ts' && f.rel !== 'ui/research-open-mark.ts');
        expect(hits(others, /\bresearchOpenSvg\(/)).toEqual({
            'ui/research-actions-ui.ts': 1, // the Research menu's footer: the legend of the mark, not an action
            'book.ts': 1, // the book's story links (keep, final, approve), drawn when researchLinkMark('story') has a mark
            'person-page.ts': 1, // the person page's research links, each with the mark of its link
        });
        for (const rel of ['book.ts', 'person-page.ts']) {
            expect(hits(FILES.filter(f => f.rel === rel), /\bresearchLinkMark\(/)[rel] ?? 0).toBeGreaterThan(0);
        }
    });

    it('hard-codes no flag of a control', () => {
        const ALLOWED: Record<string, number> = {
            // "Read a document" works through the bridge with an agent and no terminal: the AI badge alone.
            'ui/read-document-ui.ts': 2,
            // The person menu's "Read a document" (the same bridge reading): the AI badge alone.
            'ui/context-menu.ts': 1,
            // The More sheet opened at its Research section: not a mark.
            'ui/research-actions-ui.ts': 1,
        };
        expect(hits(UI, /\b(?:research|ext|external|ai): true\b|\bbadge: 'ai'/)).toEqual(ALLOWED);
    });

    it('hands the helpers no hand-picked group', () => {
        const picked: string[] = [];
        for (const f of UI) {
            const text = f.lines.join('\n');
            for (const fn of ['researchActionLabel', 'setResearchActionLabel', 'researchActionMark', 'researchMarkFlags', 'researchMarkOptions']) {
                for (const args of callArgs(text, fn)) {
                    if (args.some(a => /^'(?:none|terminal|agent)'$/.test(a))) picked.push(`${f.rel}: ${fn}(${args.join(', ')})`);
                }
            }
            f.lines.forEach((line, i) => {
                if (/\bmark: '(?:none|terminal|agent)'/.test(line)) picked.push(`${f.rel}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(picked).toEqual([]);
    });

    it('marks every control whose run launches the research', () => {
        const LAUNCH = /\brun: [^}]*\b(?:launchResearchLink|handOverResearchLink|historyLaunchExperiment|historyEnableSearch|researchSyncAction|researchSendTree|sendTreeToResearch|treeActionStartResearch|startResearchAdopt|runDirection|runLiveTask|answerResearchTask)\(/;
        const MARKED = /\b(?:research|ext|external|ai|mark): |\bresearch(?:Mark|Link)Flags\(/;
        const ALLOWED: Record<string, number> = {
            // "Send again" / "Retry" after the bridge refused or lost a send: the bridge sends again (no terminal).
            'ui/research-sync-ui.ts': 6,
        };
        const unmarked: Record<string, number> = {};
        for (const f of UI) {
            f.lines.forEach((line, i) => {
                if (!LAUNCH.test(line)) return;
                // The object may start a line or two above its run.
                const around = f.lines.slice(Math.max(0, i - 2), i + 1).join('\n');
                if (!MARKED.test(around)) unmarked[f.rel] = (unmarked[f.rel] ?? 0) + 1;
            });
        }
        expect(unmarked).toEqual(ALLOWED);
    });

    it('keeps ↗ for the web in a new window', () => {
        const ALLOWED: Record<string, number> = {
            'ui/research-promo-ui.ts': 1, // externalButton: the research's website in a new window
            'ui/research-install-ui.ts': 1, // the browser notice's Chrome download page (web)
            'ui/context-menu.ts': 1, // a jump to the person in another tree (the menu's meta, not the research)
            'ui/history-card-ui.ts': 1, // a history event's source on the web (its <a target="_blank"> a line above)
        };
        const found: Record<string, number> = {};
        for (const f of UI) {
            f.lines.forEach(line => {
                if (!line.includes('↗')) return;
                if (/target="_blank"/.test(line)) return;
                found[f.rel] = (found[f.rel] ?? 0) + 1;
            });
        }
        expect(found).toEqual(ALLOWED);
    });

    it('gives the research tools the AI badge by the map', () => {
        for (const t of RESEARCH_TOOL_ACTIONS) expect(t.ai).toBe(researchLinkMark(t.action) === 'agent');
    });
});
