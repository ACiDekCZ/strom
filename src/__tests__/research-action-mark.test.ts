/**
 * The marks of the research's actions (Milan, 2 Nov 2026): nothing for what
 * stays in the app or goes through the bridge, the terminal mark for what
 * opens the research's terminal, AI and the terminal mark where an agent
 * works there. One map by the link's action; no ◆ and no ↗ on these actions.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    RESEARCH_LINK_ACTIONS, RESEARCH_LINK_MARKS, RESEARCH_ACTION_MARKS, researchLinkMark, researchUrlMark, researchSchemeUrl,
    RESEARCH_BRIDGE_ACTIONS, RESEARCH_BRIDGE_MARKS, researchBridgeMark, setResearchDeviceState, researchDeviceAllows,
    researchDeviceMark, deviceAllows, deviceActionOfBridgeWrite, noteResearchDeviceRefused,
} from '../research-link.js';
import { researchActionLabel, researchBridgeActionLabel, researchBridgeAgentLabel, researchLinkFlags } from '../ui/research-open-mark.js';
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
        // A book's folder opened in the system's file manager (spec 105): no terminal, no agent.
        expect(researchLinkMark('book')).toBe('none');
        // The terminal asks or writes tasks: nothing paid on the click (a kind of history added, its alignment,
        // a review, a new direction or its restart).
        // A hypothesis decided or its decision changed there, who decides them confirmed there (spec 060).
        for (const a of ['open', 'history-kinds', 'history-align', 'review', 'research', 'direction', 'task', 'conflict', 'experiment',
            'hypothesis', 'hypotheses'] as const) {
            expect(researchLinkMark(a)).toBe('terminal');
        }
        // An agent at work: a conversation, a place's history, the places' identification or the queue's work started there.
        for (const a of ['chat', 'history', 'places', 'work'] as const) expect(researchLinkMark(a)).toBe('agent');
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
        // Work on the queue (spec 052 §5): automatically or a number of tasks, both the agent's.
        expect(researchUrlMark(url('work', { workDo: 'loop' }))).toBe('agent');
        expect(researchUrlMark(url('work', { workDo: 'tasks', n: 7 }))).toBe('agent');
        // "Process now" after a try of the verification (spec 065 K7.2): the agent's work on exactly those tasks.
        expect(researchUrlMark(url('work', { workDo: 'tasks', workTasks: ['T0412', 'T0413'] }))).toBe('agent');
        expect(researchLinkFlags(url('work', { workDo: 'tasks', workTasks: ['T0412'] }))).toEqual({ research: true, ai: true });
        expect(researchUrlMark(url('book', { book: 'B0003', bookDo: 'folder' }))).toBe('none');
        expect(url('book', { book: 'B0003', bookDo: 'folder' })).toBe(`strom-research://book?tree=${TREE}&id=B0003&do=folder`);
        expect(researchLinkFlags(url('book', { book: 'B0003', bookDo: 'folder' }))).toEqual({ research: false, ai: false });
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

    it('draws an agent\'s work asked through the bridge with the AI badge alone, no terminal mark (spec 058)', () => {
        const label = researchBridgeAgentLabel('In the research');
        expect(label).toContain('research-ai-badge');
        expect(label).not.toContain('research-open-mark');
        // The badge stays with the last word; the hidden words name it.
        expect(label).toContain('<span class="research-open-nowrap">research<span class="research-open-sr">, AI</span>');
    });

    it('gives every action asked through the bridge its group: verifying is the AI badge alone, the rest nothing (spec 065)', () => {
        expect(Object.keys(RESEARCH_BRIDGE_MARKS).sort()).toEqual([...RESEARCH_BRIDGE_ACTIONS].sort());
        expect(RESEARCH_BRIDGE_MARKS.verify).toBe('bridgeAgent');
        expect(RESEARCH_BRIDGE_MARKS['verify-bulk']).toBe('bridgeAgent');
        expect(RESEARCH_BRIDGE_MARKS['fact-confirm']).toBe('none');
        expect(RESEARCH_BRIDGE_MARKS['verify-stop']).toBe('none');
        // Splitting the older locations (spec 075 §5): the research's code, no agent, no terminal.
        expect(RESEARCH_BRIDGE_MARKS['sources-split']).toBe('none');
        // Sort with the agent (spec 102 §13): an agent through the bridge, the AI badge alone.
        expect(RESEARCH_BRIDGE_MARKS['material-sort']).toBe('bridgeAgent');
        // Stop one run and the most runs at once (spec 126 U10): through the bridge, no terminal, no new agent: nothing.
        expect(RESEARCH_BRIDGE_MARKS['run-stop']).toBe('none');
        expect(RESEARCH_BRIDGE_MARKS['run-limit']).toBe('none');
        expect(researchBridgeActionLabel(strings.materials.agentSort.sort, 'run-stop')).not.toContain('research-ai-badge');
        const sort = researchBridgeActionLabel(strings.materials.agentSort.sort, 'material-sort');
        expect(sort).toContain('research-ai-badge');
        expect(sort).not.toContain('research-open-mark');
        expect(researchBridgeActionLabel(strings.sources.split.go(3), 'sources-split')).toBe(strings.sources.split.go(3));
        const verify = researchBridgeActionLabel(strings.verify.start, 'verify');
        expect(verify).toContain('research-ai-badge');
        expect(verify).not.toContain('research-open-mark');
        const bulk = researchBridgeActionLabel(strings.verify.tryN(5), 'verify-bulk');
        expect(bulk).toContain('research-ai-badge');
        expect(bulk).not.toContain('research-open-mark');
        expect(researchBridgeActionLabel(strings.verify.scan, 'fact-confirm')).toBe(strings.verify.scan);
        expect(researchBridgeActionLabel(strings.verify.stop, 'verify-stop')).toBe(strings.verify.stop);
    });
});

describe('on a device of the home network (spec 094 §6)', () => {
    afterEach(() => setResearchDeviceState(null));
    const device = (actions: string[] = []) => setResearchDeviceState({ origin: 'http://192.168.1.20:47800', trees: [TREE], computer: 'Pracovna', actions });

    it('draws what it does through the bridge with no mark, and nothing that opens a terminal or starts an agent', () => {
        device(['conflict.decide', 'hypothesis.decide', 'sync.undo']);
        for (const a of RESEARCH_LINK_ACTIONS) {
            expect(researchLinkMark(a)).toBe('none');
            expect(researchDeviceMark(a)).toBe(researchDeviceAllows(a) ? 'none' : 'hidden');
        }
        for (const a of RESEARCH_BRIDGE_ACTIONS) expect(researchBridgeMark(a)).toBe('none');
        expect(researchUrlMark(researchSchemeUrl('chat', { tree: TREE })!)).toBe('none');
        expect(researchLinkFlags(researchSchemeUrl('open', { tree: TREE })!)).toEqual({ research: false, ai: false });
        expect(researchBridgeActionLabel(strings.verify.start, 'verify')).toBe(strings.verify.start);
    });

    it('allows only the actions of the table: the tree\'s own through the bridge, decisions the gateway announced', () => {
        device([]);
        for (const a of ['send', 'excerpt', 'media', 'app', 'live', 'book', 'direction', 'fact-confirm', 'verify-stop',
            'sources-split', 'run-stop', 'waiting-answer'] as const) expect(researchDeviceAllows(a)).toBe(true);
        for (const a of ['open', 'chat', 'work', 'places', 'history', 'story', 'review', 'sessions', 'experiment', 'setup',
            'update', 'fixes', 'doctor', 'seal', 'archive', 'finish', 'task', 'new', 'research', 'sync-undo', 'verify',
            'verify-bulk', 'material-sort', 'run-limit', 'read-document', 'devices', 'research-tools', 'tree-settings',
            'load-version', 'direction-new', 'direction-work', 'conflict-agent'] as const) expect(researchDeviceAllows(a)).toBe(false);
        // A decision only once the gateway announces it in status.device.actions.
        for (const a of ['conflict', 'hypothesis', 'hypotheses', 'sync-undo-this'] as const) expect(researchDeviceAllows(a)).toBe(false);
        expect(deviceAllows('conflict', ['conflict.decide'])).toBe(true);
        expect(deviceAllows('hypothesis', ['hypothesis.decide'])).toBe(true);
        expect(deviceAllows('sync-undo-this', ['sync.undo'])).toBe(true);
        expect(deviceAllows('sync-undo', ['sync.undo'])).toBe(false);
    });

    it('hides an action the gateway refused as the computer\'s only (403 device.computer-only), until the mode is left', () => {
        expect(deviceActionOfBridgeWrite('POST', 'runs/stop')).toBe('run-stop');
        expect(deviceActionOfBridgeWrite('POST', 'waiting/T0001')).toBe('waiting-answer');
        expect(deviceActionOfBridgeWrite('PUT', 'media/ab12', true)).toBe('waiting-answer');
        expect(deviceActionOfBridgeWrite('PUT', 'media/ab12')).toBe('media');
        expect(deviceActionOfBridgeWrite('POST', 'directions/G0001/state')).toBe('direction');
        // The gateway's own decisions (spec 094 §2.7).
        expect(deviceActionOfBridgeWrite('POST', 'device/conflict/X0003')).toBe('conflict');
        expect(deviceActionOfBridgeWrite('POST', 'device/hypothesis/H0002')).toBe('hypothesis');
        expect(deviceActionOfBridgeWrite('POST', 'device/sync/I0007/undo')).toBe('sync-undo-this');
        expect(deviceActionOfBridgeWrite('GET', 'waiting/T0001/fix')).toBeNull();
        expect(deviceActionOfBridgeWrite('POST', 'status')).toBeNull();
        device();
        expect(researchDeviceAllows('run-stop')).toBe(true);
        noteResearchDeviceRefused('run-stop');
        expect(researchDeviceAllows('run-stop')).toBe(false);
        expect(researchDeviceAllows('waiting-answer')).toBe(true);
        setResearchDeviceState(null);
        expect(researchDeviceAllows('run-stop')).toBe(true);
        device();
        expect(researchDeviceAllows('run-stop')).toBe(true);
        // Outside the device mode nothing is noted.
        setResearchDeviceState(null);
        noteResearchDeviceRefused('waiting-answer');
        expect(researchDeviceAllows('waiting-answer')).toBe(true);
    });

    it('outside the device mode changes nothing: every action allowed, every mark its own', () => {
        for (const a of RESEARCH_LINK_ACTIONS) {
            expect(researchDeviceAllows(a)).toBe(true);
            expect(researchDeviceMark(a)).toBe(RESEARCH_LINK_MARKS[a]);
        }
        for (const a of RESEARCH_BRIDGE_ACTIONS) expect(researchBridgeMark(a)).toBe(RESEARCH_BRIDGE_MARKS[a]);
        expect(researchLinkFlags(researchSchemeUrl('chat', { tree: TREE })!)).toEqual({ research: true, ai: true });
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
        const sections = ['research', 'places', 'history', 'live', 'sync', 'read', 'verify'] as const;
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
