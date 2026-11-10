/**
 * The research bubble of the Table view drawn (spec 073 §16.4): the head
 * (name and research id) on a computer, none in a phone's sheet (its title
 * says them); the sections in their order; each action by how it runs — a
 * research link with the mark of its group from the map, an action in the
 * app or through the bridge without one, a website with ↗ in a new window, a
 * waiting item's answer as a slot for the waiting panel's own control; the
 * actions that cannot run here left out; a read-only copy without actions.
 * Invented data only (e2e/fixtures/research-table.ged).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import type { LiveWaiting } from '../research-link.js';
import { setLanguage } from '../strings.js';
import type { Person, StromData } from '../types.js';
import { researchTableEnv, type ResearchTableInput } from '../ui/table-view/table-research.js';
import { researchBubble, researchBubbleActions, researchConflictBubble } from '../ui/table-view/table-research-bubble.js';
import { researchBubbleHtml, researchBubbleTitle } from '../ui/table-view/table-bubble.js';

const GED = readFileSync(join(__dirname, '../../e2e/fixtures/research-table.ged'), 'utf8');
const NOW = Date.parse('2026-11-10T12:00:00Z');

const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setLanguage('en');
});
afterAll(() => {
    vi.useRealTimers();
});

const waiting: LiveWaiting[] = [
    { id: 'T0201', what: 'Decide the father of Matěj', on: '', at: '2026-11-10T10:00:00Z', person: 'P0005' },
];

function setup(more: Partial<ResearchTableInput> = {}) {
    const data = convertToStrom(parseGedcom(GED)).data;
    byRefn(data, 'P0005').research!.waits = [{ id: 'T0900', group: { name: 'SOA Zelený Brod', type: 'archive', url: 'https://example.org/soa' } }];
    const env = researchTableEnv(data, {
        kind: 'research', live: true, now: NOW, waiting,
        working: [], queue: [{ id: 'T0301', state: 'next', person: 'P0005', text: 'Find the father' }],
        materialsOf: p => p.refn === 'P0005' ? 2 : null,
        ...more,
    });
    return { env, P: (refn: string) => byRefn(data, refn) };
}

/** The HTML as a list of its tags with a given attribute. */
const tags = (html: string, attr: string): string[] => html.match(new RegExp(`<[a-z]+ [^>]*${attr}[^>]*>`, 'g')) ?? [];

describe('research bubble drawn (§16.4)', () => {
    it('heads it with the name and research id on a computer, not in a phone sheet', () => {
        const { env, P } = setup();
        const b = researchBubble(env, P('P0005'), 'rSum')!;
        const desk = researchBubbleHtml(b, false);
        expect(desk).toMatch(/^<div class="tv-rbub-head"><span class="tv-rbub-name">Matěj Pivoňkovský<\/span><span class="tv-rbub-refn">P0005<\/span><\/div>/);
        expect(researchBubbleHtml(b, true)).not.toContain('tv-rbub-head');
        expect(researchBubbleTitle(b)).toBe('Matěj Pivoňkovský · P0005');
    });

    it('draws the sections in the bubble’s order, each with its mark', () => {
        const { env, P } = setup();
        const b = researchBubble(env, P('P0005'), 'rSum')!;
        const html = researchBubbleHtml(b, false);
        const drawn = [...html.matchAll(/data-sec="(\w+)"/g)].map(m => m[1]);
        expect(drawn).toEqual(b.sections.map(s => s.id));
        expect(drawn[0]).toBe('wait');
        expect(drawn[drawn.length - 1]).toBe('mat');
        expect(html).toContain('<span class="tv-rmark tv-rmark--wait" aria-hidden="true">');
    });

    it('marks a research link’s action by its group, none in the app or through the bridge; ↗ only for the web', () => {
        const { env, P } = setup();
        const b = researchBubble(env, P('P0005'), 'rSum')!;
        const all = researchBubbleActions(b);
        const html = researchBubbleHtml(b, false);
        const button = (id: string): string => {
            const i = all.findIndex(a => a.id === id);
            const at = html.indexOf(`data-i="${i}"`);
            return html.slice(at, html.indexOf('</button>', at));
        };
        // A queued task: the research's terminal.
        expect(button('openTask')).toContain('research-open-mark');
        expect(button('openTask')).not.toContain('research-ai-badge');
        // In the app: no mark.
        for (const id of ['waitingPanel', 'materials', 'showLine', 'changeInResearch', 'source']) {
            expect(all.some(a => a.id === id)).toBe(true);
            expect(button(id)).not.toContain('research-open');
        }
        // The waiting item's answer is the panel's own control: a slot.
        const wait = all.findIndex(a => a.id === 'waitAnswer');
        expect(html).toContain(`<span class="tv-rbub-slot" data-witem="${wait}"></span>`);
        // The archive: a link in a new window with ↗, the only ↗ of the bubble.
        const web = tags(html, 'data-web=');
        expect(web).toEqual([expect.stringContaining('href="https://example.org/soa" target="_blank" rel="noopener noreferrer"')]);
        expect(html.split('↗').length - 1).toBe(1);
    });

    it('leaves out the actions that cannot run here, with no empty row', () => {
        const { env, P } = setup();
        const b = researchBubble(env, P('P0005'), 'rTasks')!;
        const html = researchBubbleHtml(b, false, a => a.via !== 'link');
        expect(html).not.toContain('data-rid="openTask"');
        expect(html).not.toContain('data-rid="follow"');
        expect(html).not.toContain('class="tv-rbub-acts');
    });

    it('a ≠’s bubble: the conflict, its values and Decide ›', () => {
        const { env, P } = setup();
        const b = researchConflictBubble(env, P('P0006'), [{ personId: P('P0006').id, conflictId: 'X0001' }])!;
        const html = researchBubbleHtml(b, false);
        expect([...html.matchAll(/data-sec="(\w+)"/g)].map(m => m[1])).toEqual(['conf']);
        expect(tags(html, 'data-act="r"')).toEqual([expect.stringContaining('data-rid="decide"')]);
        expect(html).toContain('>Decide ›</button>');
    });

    it('read-only: no action, the sentence at the end', () => {
        const { env, P } = setup({ readOnly: true });
        const b = researchConflictBubble(env, P('P0006'), [{ personId: P('P0006').id, conflictId: 'X0001' }])!;
        const html = researchBubbleHtml(b, false);
        expect(html).not.toContain('<button');
        expect(html).not.toContain('data-witem');
        expect(html).toMatch(/<div class="tv-rbub-note">Read-only: conflicts cannot be decided here\.<\/div>$/);
    });
});
