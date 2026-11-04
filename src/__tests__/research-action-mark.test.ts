/**
 * The marks of the research's actions (Milan, 2 Nov 2026): nothing for what
 * stays in the app or goes through the bridge, the terminal mark for what
 * opens the research's terminal, AI and the terminal mark where an agent
 * works there. One map by the link's action; no ◆ and no ↗ on these actions.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    RESEARCH_LINK_ACTIONS, RESEARCH_LINK_MARKS, RESEARCH_ACTION_MARKS, researchLinkMark, researchUrlMark, researchSchemeUrl,
} from '../research-link.js';
import { researchActionLabel, researchLinkFlags } from '../ui/research-open-mark.js';
import { syncActionMark } from '../ui/research-sync-ui.js';
import { strings, setLanguage, type Language } from '../strings.js';

const TREE = '0b9e1c2a-4f3d-4c5e-8a7b-1d2e3f4a5b6c';

describe('the map of research actions to their marks', () => {
    it('gives every action of the scheme one of the three groups', () => {
        for (const a of RESEARCH_LINK_ACTIONS) expect(RESEARCH_ACTION_MARKS).toContain(RESEARCH_LINK_MARKS[a]);
        expect(Object.keys(RESEARCH_LINK_MARKS).sort()).toEqual([...RESEARCH_LINK_ACTIONS].sort());
    });

    it('sorts the actions by what their link does in the research', () => {
        // Without a terminal: the system's viewer, the app's window.
        for (const a of ['excerpt', 'media', 'app', 'live'] as const) expect(researchLinkMark(a)).toBe('none');
        // The terminal asks or writes tasks: nothing paid on the click (a kind of history added, its alignment,
        // a review, a new direction or its restart).
        for (const a of ['open', 'history-kinds', 'history-align', 'review', 'research', 'direction', 'task', 'conflict', 'experiment'] as const) {
            expect(researchLinkMark(a)).toBe('terminal');
        }
        // An agent at work: a conversation, a place's history or the places' identification started there.
        for (const a of ['chat', 'history', 'places'] as const) expect(researchLinkMark(a)).toBe('agent');
    });

    it('refines a task, a conflict and an experiment by what is asked of it', () => {
        expect(researchLinkMark('task', { taskDo: 'chat' })).toBe('agent');
        expect(researchLinkMark('task', { taskDo: 'park' })).toBe('terminal');
        expect(researchLinkMark('conflict', { conflictDo: 'agent' })).toBe('agent');
        expect(researchLinkMark('conflict', { conflictDo: 'decide' })).toBe('terminal');
        expect(researchLinkMark('experiment', { experimentDo: 'on' })).toBe('terminal');
        expect(researchLinkMark('experiment', { experimentDo: 'off' })).toBe('none');
        // A fix whose agent reads again (paid) starts its work on a yes; a fix without it and any undo only ask.
        expect(researchLinkMark('fixes')).toBe('terminal');
        expect(researchLinkMark('fixes', { fixPaid: true })).toBe('agent');
        expect(researchLinkMark('fixes', { fixPaid: true, fixDo: 'undo' })).toBe('terminal');
    });

    it('marks the state block\'s actions by the link they launch', () => {
        expect(syncActionMark('openResearch')).toBe('terminal');
        expect(syncActionMark('sealTakeOver')).toBe('terminal');
        expect(syncActionMark('decideInResearch')).toBe('terminal');
        expect(syncActionMark('loadVersion')).toBe('none');
        // "Start the research" by its link now: the research's terminal, or only the app followed live.
        expect(syncActionMark('startResearch', researchSchemeUrl('open', { tree: TREE }))).toBe('terminal');
        expect(syncActionMark('startResearch', researchSchemeUrl('live', { tree: TREE }))).toBe('none');
    });

    it('reads the mark of a ready link from its action and do=', () => {
        const url = (action: Parameters<typeof researchSchemeUrl>[0], p: Omit<Parameters<typeof researchSchemeUrl>[1], 'tree'>, scheme?: string) =>
            researchSchemeUrl(action, { tree: TREE, ...p }, scheme)!;
        expect(researchUrlMark(url('places', { placesDo: 'run' }))).toBe('agent');
        expect(researchUrlMark(url('history-kinds', { kinds: 'all', kindsScope: 'tree' }))).toBe('terminal');
        expect(researchUrlMark(url('history-align', {}))).toBe('terminal');
        expect(researchUrlMark(url('experiment', { experiment: 'regions', experimentDo: 'off' }))).toBe('none');
        expect(researchUrlMark(url('task', { task: 'T0001', taskDo: 'chat' }))).toBe('agent');
        expect(researchUrlMark(url('conflict', { conflict: 'X0007', conflictDo: 'agent' }, 'strom-research-beta'))).toBe('agent');
        expect(researchUrlMark('https://example.org/places')).toBeNull();
        expect(researchUrlMark('strom-research://unknown?tree=x')).toBeNull();
        expect(researchLinkFlags(url('places', { placesDo: 'run' }))).toEqual({ research: true, ai: true });
        expect(researchLinkFlags(url('experiment', { experiment: 'history', experimentDo: 'off' }))).toEqual({ research: false, ai: false });
        // A link the app does not know: the research opens, its terminal shows.
        expect(researchLinkFlags('strom-research://later?tree=x')).toEqual({ research: true, ai: false });
    });

    it('draws a label by its group: plain, the terminal mark, or AI and the terminal mark', () => {
        const none = researchActionLabel('Run now', 'none');
        expect(none).toBe('Run now');
        const terminal = researchActionLabel('Continue in the research', 'terminal');
        expect(terminal).toContain('research-open-mark');
        expect(terminal).not.toContain('research-ai-badge');
        const agent = researchActionLabel('Run now ↗', 'agent');
        expect(agent).toContain('research-open-mark');
        expect(agent).toContain('research-ai-badge');
        expect(agent).not.toContain('↗');
    });
});

describe('texts of the research actions', () => {
    afterEach(() => setLanguage('en'));

    /** Every text leaf of a section, functions called with plausible arguments. */
    function leaves(node: unknown, path: string, out: { path: string; text: string }[]): void {
        if (typeof node === 'string') out.push({ path, text: node });
        else if (typeof node === 'function') {
            for (const args of [[3], ['Horní Lhota'], [3, 3], ['Horní Lhota', 3]]) {
                try {
                    const v = (node as (...a: unknown[]) => unknown)(...args);
                    if (typeof v === 'string') out.push({ path, text: v });
                } catch { /* another signature */ }
            }
        } else if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) leaves(v, `${path}.${k}`, out);
        }
    }

    it('carry no ↗ at their end and no ◆ at their start, in any language', () => {
        const sections = ['research', 'places', 'history', 'live', 'sync', 'read'] as const;
        // The web in a new window keeps its ↗ (an archive's site, the research's changes on the web, the browser extension's page).
        const web = /\.(waitingOpenWeb|openWeb|archiveWeb|researchFullChangelog|fullChangelog|web|openPdf|extLink)$/;
        for (const lang of ['en', 'cs', 'de'] as Language[]) {
            setLanguage(lang);
            const all: { path: string; text: string }[] = [];
            for (const s of sections) leaves((strings as unknown as Record<string, unknown>)[s], s, all);
            expect(all.length).toBeGreaterThan(500);
            const marked = all.filter(l => (/↗\s*$/.test(l.text) && !web.test(l.path)) || /^\s*◆/.test(l.text));
            expect(marked.map(l => `${lang} ${l.path}: ${l.text}`)).toEqual([]);
            expect(strings.places.research.runNow).not.toMatch(/↗|◆/);
        }
    });
});
