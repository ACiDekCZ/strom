/**
 * The person menu's research rows in a satellite window (spec 079 §2, 2g):
 * the main window's rows with their marks unchanged, under their heading;
 * greyed while the main window is closed; a click is run by the main window,
 * and only a row its own menu offers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PersonMenuAction } from '../../ui/context-menu.js';
import { strings, setLanguage } from '../../strings.js';
import {
    SatelliteResearchMenu, satelliteResearchRows, readResearchRows, runSatelliteResearchRow,
    WIN_RESEARCH_PREFIX, RESEARCH_MENU_WAIT_MS, PERSON_MENU_ACTION, type ResearchMenuClient,
} from '../window-research-menu.js';

const MAIN_ROWS: PersonMenuAction[] = [
    { action: 'research-in-line:0', label: 'Linie Tykvových', glyph: '◇', header: 'In direction' },
    { action: 'research-knows', label: 'What the research knows', tag: '1 conflict', divider: true },
    { action: 'research-read', label: 'Read a document', note: 'An agent reads it', badge: 'ai' },
    { action: 'research-review', label: 'Review the person', external: true },
    { action: 'research-ask', label: 'Ask the agent', external: true, badge: 'ai', ariaLabel: 'Ask the agent, AI, terminal' },
];

/** The marks a row draws (CLAUDE.md "Marks of research actions"). */
const marks = (a: PersonMenuAction) => ({ external: !!a.external, badge: a.badge ?? null, ariaLabel: a.ariaLabel ?? null });

function client(over: Partial<ResearchMenuClient> = {}): ResearchMenuClient & { calls: unknown[][]; focus: number } {
    const c = {
        connection: 'connected',
        calls: [] as unknown[][],
        focus: 0,
        requestResearchMenu: vi.fn(async () => JSON.parse(JSON.stringify(MAIN_ROWS)) as unknown[]),
        researchAction(action: string, args?: unknown) { c.calls.push([action, args]); },
        requestMainFocus() { c.focus++; return Promise.resolve(true); },
        ...over,
    };
    return c;
}

beforeEach(() => setLanguage('en'));
afterEach(() => vi.restoreAllMocks());

describe('the rows a satellite shows', () => {
    it('keep the main window\'s marks, stand under "runs in the main window", and are its own actions', () => {
        const rows = satelliteResearchRows(readResearchRows(JSON.parse(JSON.stringify(MAIN_ROWS))), true);
        expect(rows.map(marks)).toEqual(MAIN_ROWS.map(marks));
        expect(rows.map(r => r.label)).toEqual(MAIN_ROWS.map(r => r.label));
        expect(rows[0]).toMatchObject({ section: strings.win.researchInMain, divider: true, header: 'In direction', glyph: '◇' });
        expect(rows.slice(1).every(r => r.section === undefined)).toBe(true);
        expect(rows.map(r => r.action)).toEqual(MAIN_ROWS.map(r => WIN_RESEARCH_PREFIX + r.action));
        expect(rows.some(r => r.disabled || r.dim)).toBe(false);
    });

    it('the main window closed: greyed and faded, "main window only"', () => {
        const rows = satelliteResearchRows(MAIN_ROWS, false);
        expect(rows[0].section).toBe(strings.win.researchMainOnly);
        expect(rows.every(r => r.disabled && r.dim)).toBe(true);
        expect(rows.map(marks)).toEqual(MAIN_ROWS.map(marks));
    });

    it('only the fields of a menu row cross windows', () => {
        const rows = readResearchRows([{ action: 'a', label: 'A', onclick: 'x', badge: 'paid', external: 'yes' }, { label: 'no action' }, null]);
        expect(rows).toEqual([{ action: 'a', label: 'A' }]);
    });
});

describe('a satellite\'s menu', () => {
    it('asks the main window when it opens (then not again for a moment), and shows its rows', async () => {
        let now = 1000;
        const c = client();
        const menu = new SatelliteResearchMenu(c, () => now);
        expect(menu.needsFetch('p1')).toBe(true);
        await menu.fetch('p1');
        expect(c.requestResearchMenu).toHaveBeenCalledWith('p1', RESEARCH_MENU_WAIT_MS);
        expect(menu.needsFetch('p1')).toBe(false);
        expect(menu.rows('p1').map(r => r.label)).toEqual(MAIN_ROWS.map(r => r.label));
        now += 5000;
        expect(menu.needsFetch('p1')).toBe(true);
    });

    it('the main window silent: the last rows stay; closed: they are greyed and nothing is asked or sent', async () => {
        const c = client();
        const menu = new SatelliteResearchMenu(c, () => 0);
        await menu.fetch('p1');
        c.requestResearchMenu = vi.fn(async () => null);
        await menu.fetch('p1');
        expect(menu.rows('p1')).toHaveLength(MAIN_ROWS.length);
        (c as { connection: string }).connection = 'main-closed';
        expect(menu.needsFetch('p1')).toBe(false);
        expect(menu.rows('p1').every(r => r.disabled)).toBe(true);
        menu.run('p1', 'research-review');
        expect(c.calls).toEqual([]);
    });

    it('a row is run by the main window; one that opens the terminal leaves the main window where it is', async () => {
        const c = client();
        const menu = new SatelliteResearchMenu(c, () => 0);
        await menu.fetch('p1');
        menu.run('p1', 'research-knows');
        expect(c.calls).toEqual([[PERSON_MENU_ACTION, { personId: 'p1', action: 'research-knows' }]]);
        expect(c.focus).toBe(1);
        menu.run('p1', 'research-review');
        expect(c.calls[1]).toEqual([PERSON_MENU_ACTION, { personId: 'p1', action: 'research-review' }]);
        expect(c.focus).toBe(1);
    });
});

describe('the main window runs a satellite\'s row', () => {
    it('only what its own menu offers now, as its menu runs it', () => {
        const run = vi.fn();
        const items = (id: string) => (id === 'p1' ? MAIN_ROWS : null);
        expect(runSatelliteResearchRow({ personId: 'p1', action: 'research-review' }, { items, run })).toBe(true);
        expect(run).toHaveBeenCalledWith('p1', 'research-review');
        expect(runSatelliteResearchRow({ personId: 'p1', action: 'delete' }, { items, run })).toBe(false);
        expect(runSatelliteResearchRow({ personId: 'p9', action: 'research-review' }, { items, run })).toBe(false);
        expect(runSatelliteResearchRow('research-review', { items, run })).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
    });
});
