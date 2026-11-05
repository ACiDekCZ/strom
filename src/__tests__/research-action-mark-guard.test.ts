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
 * 5. `↗` stays for the web in a new window, never on an action of the research;
 * 6. a button drawn in an HTML template whose click launches the research carries a mark: each click handler that
 *    calls a launcher is traced to what it dispatches on (`case 'x':` of a switch over `dataset.y`, `if (what ===
 *    'x')` with `what` read from `dataset.y`, a listener on `[data-y="x"]`, `.class` or `closest('.class')`, an
 *    inline `onclick` calling a launcher) and the element drawn with that `data-y="x"` / class must draw its label
 *    through the mark helpers. An action the map gives no mark (through the bridge, no terminal) needs none.
 *
 * Each exception names its file, how many times it may occur and why.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RESEARCH_TOOL_ACTIONS, researchLinkMark, type ResearchActionMark } from '../research-link.js';
import { syncActionMark } from '../ui/research-sync-ui.js';

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

/** The calls that launch the research (a link, or the action that sends one). */
const LAUNCHERS = [
    'launchResearchLink', 'handOverResearchLink', 'historyLaunchExperiment', 'historyEnableSearch', 'researchSyncAction',
    'researchSendTree', 'sendTreeToResearch', 'treeActionStartResearch', 'startResearchAdopt', 'runDirection',
    'runLiveTask', 'answerResearchTask',
];
/** A label drawn through the mark helpers (its group from the map), in a template or on a built element. */
const MARK_HELPER = /\b(?:researchActionLabel|researchActionMark|researchSyncActionLabel|researchOpenLabel|researchOpenMark|setResearchActionLabel|setResearchOpenLabel)\(/;

/**
 * What a click handler dispatches on: an element's `data-attr="value"` (any value when absent), a class or an id
 * of an element drawn in a template, or a control built in the DOM (`built`: the lines that make it).
 */
type Dispatch = { attr: string; value?: string } | { cls: string } | { id: string } | { built: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const datasetAttr = (key: string) => key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const SELECTOR = /\b(?:querySelector(?:All)?|closest)(?:<\w+>)?\('([^']+)'\)/;
/** A click listener: on a variable (`btn.onclick = `), or on what an expression found (`…)?.addEventListener('click'`). */
const LISTENER = /(?:\b(\w+)|\))\??\.(?:onclick = |addEventListener\('click')/;
function describeDispatch(d: Dispatch): string {
    if ('attr' in d) return d.value === undefined ? `[data-${d.attr}]` : `data-${d.attr}="${d.value}"`;
    if ('cls' in d) return `.${d.cls}`;
    if ('id' in d) return `#${d.id}`;
    return 'built';
}

/** The data-* attribute `expr` reads: `x.dataset.act`, `getAttribute('data-act')`, or a variable bound to one above. */
function readAttr(lines: string[], at: number, expr: string): string | null {
    const read = (e: string) => {
        const d = /\bdataset\.(\w+)/.exec(e);
        if (d) return datasetAttr(d[1]);
        return /getAttribute\('data-([\w-]+)'\)/.exec(e)?.[1] ?? null;
    };
    const direct = read(expr);
    if (direct || !/^\w+$/.test(expr)) return direct;
    for (let j = at; j >= Math.max(0, at - 40); j--) {
        const bound = new RegExp(`\\b(?:const|let) ${expr}\\b[^=]*= (.+)`).exec(lines[j]);
        if (bound) return read(bound[1]);
    }
    return null;
}

/** The element a selector picks: its data attribute, else its id, else its class (of the last compound). */
function selectorDispatch(selector: string): Dispatch | null {
    const last = selector.split(',')[0].trim().split(/\s+/).pop() ?? '';
    const data = /\[data-([\w-]+)(?:="([^"]+)")?\]/.exec(last);
    if (data) return data[2] === undefined ? { attr: data[1] } : { attr: data[1], value: data[2] };
    const id = /#([\w-]+)/.exec(last);
    if (id) return { id: id[1] };
    const cls = /\.([\w-]+)/.exec(last);
    return cls ? { cls: cls[1] } : null;
}

/**
 * What the click handler around a launcher call (line `i`, column `col`) dispatches on: the `case`s of a switch over
 * a data attribute, an `if (what === 'x')` over one, the selector of the listener (or of the element a `closest`
 * found), or the control the listener's variable holds; none when it is none of these (a method called from
 * elsewhere, a menu's action).
 */
function dispatchOf(lines: string[], i: number, col: number): Dispatch[] {
    for (let j = i; j >= Math.max(0, i - 8); j--) {
        const line = j === i ? lines[j].slice(0, col) : lines[j];
        if (j < i && /^\s*(?:break|return);\s*$/.test(line)) return [];
        const cases = [...line.matchAll(/\bcase '([^']+)':/g)].map(c => c[1]);
        if (cases.length) {
            for (let k = j; k >= Math.max(0, j - 80); k--) {
                const sw = /\bswitch \((.+)\) \{/.exec(lines[k]);
                if (!sw) continue;
                const attr = readAttr(lines, k, sw[1].trim());
                return attr ? cases.map(value => ({ attr, value })) : [];
            }
            return [];
        }
        const cond = /\bif \(([\w.?]+) === '([^']+)'/.exec(line);
        if (cond) {
            const attr = readAttr(lines, j, cond[1]);
            return attr ? [{ attr, value: cond[2] }] : [];
        }
        const sel = SELECTOR.exec(line);
        const listener = LISTENER.exec(line);
        const pick = (selector: string) => { const d = selectorDispatch(selector); return d ? [d] : []; };
        if (listener) {
            if (sel) return pick(sel[1]);
            // Each element a forEach a line above walks.
            const each = j > 0 && /\.forEach\(/.test(lines[j - 1]) ? SELECTOR.exec(lines[j - 1]) : null;
            if (each) return pick(each[1]);
            // A control built in the DOM: the lines that make it, from its variable's declaration.
            if (!listener[1]) return [];
            for (let k = j - 1; k >= Math.max(0, j - 12); k--) {
                if (!new RegExp(`\\b(?:const|let) ${listener[1]}\\b`).test(lines[k])) continue;
                return /\bquerySelector|getElementById/.test(lines[k]) ? [] : [{ built: lines.slice(k, j).join('\n') }];
            }
            return [];
        }
        // A delegated click: `if (target.closest('.x'))`, or the element a closest found.
        if (sel && /\bclosest\b/.test(line) && /\bif \(|\b(?:const|let) \w+ = /.test(line)) return pick(sel[1]);
    }
    return [];
}

/** Where `d` stands in a template (a value drawn by `${…}` when `dynamic`). */
function dispatchPattern(d: Exclude<Dispatch, { built: string }>, dynamic = false): RegExp {
    if ('attr' in d) {
        const value = dynamic ? '\\$\\{' : d.value === undefined ? '' : `${escapeRe(d.value)}"`;
        return new RegExp(`data-${escapeRe(d.attr)}="${value}`, 'g');
    }
    if ('cls' in d) return new RegExp(`class="[^"]*?(?<![\\w-])${escapeRe(d.cls)}(?![\\w-])`, 'g');
    return new RegExp(`(?<![\\w-])id="${escapeRe(d.id)}"`, 'g');
}

/** The element whose opening tag holds `at`, from its `<` to its closing tag; null when `at` is outside a tag. */
function elementAt(text: string, at: number): string | null {
    const start = text.lastIndexOf('<', at);
    const tag = /^<(\w+)/.exec(text.slice(start))?.[1];
    if (!tag || text.slice(start, at).includes('>')) return null;
    const end = text.indexOf(`</${tag}>`, at);
    return text.slice(start, end < 0 ? text.indexOf('\n', at) : end);
}

/**
 * The template elements in `text` that carry `d`. An attribute handed to a local helper that draws the element
 * (`approveBtn('id="x"')`) stands for that helper's element.
 */
function renderedWith(text: string, d: Dispatch, dynamic = false): string[] {
    if ('built' in d) return [];
    const re = dispatchPattern(d, dynamic);
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        if (text[m.index - 1] === '[') continue; // a selector, not a template
        const el = elementAt(text, m.index);
        if (el) { out.push(el); continue; }
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const helper = /\b(\w+)\(['`][^'`]*$/.exec(text.slice(lineStart, m.index));
        const def = helper ? new RegExp(`\\b(?:const|function) ${helper[1]}\\b[^\\n]*\\n?[^<]*`).exec(text) : null;
        const drawn = def ? elementAt(text, def.index + def[0].length + 1) : null;
        if (drawn) out.push(drawn);
    }
    return out;
}

/** The mark of a launcher call's action when the call names it (by the map); null when its link decides. */
function callMark(call: string): ResearchActionMark | null {
    const sync = /^researchSyncAction\('(\w+)'\)/.exec(call);
    if (sync) return syncActionMark(sync[1]);
    if (/^historyLaunchExperiment\('off'/.test(call)) return researchLinkMark('experiment', { experimentDo: 'off' });
    return null;
}

interface LauncherCall { rel: string; line: number; launcher: string; call: string; dispatch: Dispatch[] }

/** Every launcher call of the UI sources with what its click handler dispatches on. */
function launcherCalls(): LauncherCall[] {
    const re = new RegExp(`\\b(?:${LAUNCHERS.join('|')})\\(`, 'g');
    const out: LauncherCall[] = [];
    for (const f of UI) {
        f.lines.forEach((line, i) => {
            if (/\brun: /.test(line)) return; // a toast's, menu's or dialog's action: rule 4
            for (const m of line.matchAll(re)) {
                // The launcher's own definition dispatches nothing.
                if (new RegExp(`^\\s*(?:async )?${escapeRe(m[0])}`).test(line)) continue;
                out.push({
                    rel: f.rel, line: i + 1, launcher: m[0].slice(0, -1), call: line.slice(m.index),
                    dispatch: dispatchOf(f.lines, i, m.index),
                });
            }
        });
    }
    return out;
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
        const LAUNCH = new RegExp(`\\brun: [^}]*\\b(?:${LAUNCHERS.join('|')})\\(`);
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
            'ui/help-ui.ts': 1, // How Strom works: outLink, https only, target _blank (the web, the licence, the source)
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

    it('marks every button of a template whose click launches the research', () => {
        // Controls whose click launches the research yet carry no mark (`<file> <what it dispatches on> <launcher>`),
        // each with why. An action whose call names it (researchSyncAction('send'), historyLaunchExperiment('off'))
        // needs no entry: callMark reads its mark from the map.
        const NO_MARK: Record<string, string> = {
            'ui/research-tree-settings-ui.ts built researchSendTree':
                'the status line\'s "Send again": the bridge sends again (no terminal), as the toasts\' of rule 4',
            'ui/story-compare-ui.ts built answerResearchTask':
                'a waiting story\'s "Compare" opens the comparison in the app; only a story whose draft is not here yet goes on to the research',
        };
        // Every handler the trace has to reach (if one goes missing, the trace has gone blind there).
        const MUST_CHECK = [
            'ui/history-manage-ui.ts data-hm="enable" historyEnableSearch',
            'ui/history-manage-ui.ts data-hm="switchOn" historyLaunchExperiment',
            'ui/batch-ui.ts data-act="start" researchSyncAction',
            'ui/materials-window.ts data-mw="start" researchSyncAction',
            'ui/research-edge-ui.ts data-do="chat" launchResearchLink',
            'ui/history-card-ui.ts .pm-lifeline-henable historyEnableSearch',
            'ui/person-sources-ui.ts #person-story-approve launchResearchLink',
            'ui/person-research-ui.ts [data-conflict] launchResearchLink',
            'ui/research-overview-ui.ts built launchResearchLink',
            'ui/history-ui.ts onclick historySettingsAction',
        ];
        const texts = new Map(FILES.map(f => [f.rel, f.lines.join('\n')]));
        const checked = new Set<string>();
        const exempted = new Set<string>();
        const unmarked: string[] = [];
        const unrendered: string[] = [];
        for (const c of launcherCalls()) {
            // The map gives the action no mark: it stays in the app or goes through the bridge.
            if (callMark(c.call) === 'none') continue;
            for (const d of c.dispatch) {
                const where = `${c.rel} ${describeDispatch(d)} ${c.launcher}`;
                if (where in NO_MARK) { exempted.add(where); continue; }
                let els = 'built' in d ? [d.built] : renderedWith(texts.get(c.rel) ?? '', d);
                // A value drawn by `${…}` in the same file, else the element drawn by another file.
                if (!els.length) els = renderedWith(texts.get(c.rel) ?? '', d, true);
                if (!els.length) els = [...texts.values()].flatMap(t => renderedWith(t, d));
                if (!els.length) { unrendered.push(`${c.rel}:${c.line} ${describeDispatch(d)}`); continue; }
                checked.add(where);
                for (const el of els) {
                    if (!MARK_HELPER.test(el)) unmarked.push(`${c.rel}:${c.line} ${describeDispatch(d)}: ${el.replace(/\s+/g, ' ').slice(0, 160)}`);
                }
            }
        }
        // An inline onclick that launches: the element it sits on draws its label through the mark helpers.
        // historySettingsAction: the status row's links (linkOn, linkOff, errLink) launch by their action.
        const INLINE_LAUNCHERS = [...LAUNCHERS, 'historySettingsAction'];
        for (const f of UI) {
            const text = texts.get(f.rel) ?? '';
            // The attribute ends at the quote before a space or `>` (a `${…}` in it may hold quotes of its own).
            for (const m of text.matchAll(/\bonclick="(.*?)"(?=[\s>])/g)) {
                // `x.launcher('a')` or the app's `call('launcher', "'a'")`; a `${…}` action is decided when drawn.
                const launch = new RegExp(`\\b(${INLINE_LAUNCHERS.join('|')})\\b(?:', ["\`]|\\()?(?:'(\\w+)')?`).exec(m[1]);
                if (!launch) continue;
                if (launch[2] && callMark(`${launch[1]}('${launch[2]}')`) === 'none') continue;
                checked.add(`${f.rel} onclick ${launch[1]}`);
                const el = elementAt(text, m.index) ?? '';
                if (!MARK_HELPER.test(el)) unmarked.push(`${f.rel} onclick: ${el.replace(/\s+/g, ' ').slice(0, 160)}`);
            }
        }
        expect(unmarked).toEqual([]);
        expect(unrendered).toEqual([]);
        expect(Object.keys(NO_MARK).filter(k => !exempted.has(k))).toEqual([]);
        expect(MUST_CHECK.filter(w => !checked.has(w))).toEqual([]);
    });

    it('gives the research tools the AI badge by the map', () => {
        for (const t of RESEARCH_TOOL_ACTIONS) expect(t.ai).toBe(researchLinkMark(t.action) === 'agent');
    });
});
