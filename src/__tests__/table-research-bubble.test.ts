/**
 * The content of the Table view's research bubbles (spec 073 §16.4): the
 * section of each research column, the summary's order, the conflicts of a
 * ≠, the actions' marks from the research links' map, a read-only copy
 * without actions and an archive without the live sections.
 * Invented data only (e2e/fixtures/research-table.ged).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { researchLinkMark, type LiveWaiting } from '../research-link.js';
import { setLanguage, strings } from '../strings.js';
import type { Person, StromData } from '../types.js';
import { researchTableEnv, RESEARCH_COLUMNS, type ResearchTableInput } from '../ui/table-view/table-research.js';
import {
    researchBubble, researchBubbleActions, researchConflictBubble, RESEARCH_BUBBLE_ORDER, type ResearchBubble,
} from '../ui/table-view/table-research-bubble.js';

const GED = readFileSync(join(__dirname, '../../e2e/fixtures/research-table.ged'), 'utf8');
const NOW = Date.parse('2026-11-10T12:00:00Z');

const load = (): StromData => convertToStrom(parseGedcom(GED)).data;
const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setLanguage('cs');
});
afterAll(() => {
    vi.useRealTimers();
    setLanguage('en');
});

const waiting: LiveWaiting[] = [
    { id: 'T0201', what: 'Rozhodnout otce Matěje', on: '', at: '2026-11-10T10:00:00Z', person: 'P0005' },
    { id: 'T0202', what: 'Doplnit křest', on: '', at: '2026-11-09T10:00:00Z', person: 'P0005' },
    { id: 'S0001', what: '', on: '', at: '2026-11-09T10:00:00Z', person: 'P0004', kind: 'story' },
    { id: 'T0101', what: 'Dopis faře', on: '', at: '2026-10-03T10:00:00Z', person: 'P0001', kind: 'letter', phase: 'sent', sentAt: '2026-10-03',
        group: { key: 'fu-lipova-stran', name: 'Farní úřad Lipová Stráň', kind: 'office' } },
];

function setup(more: Partial<ResearchTableInput> = {}, edit?: (data: StromData) => void) {
    const data = load();
    edit?.(data);
    const input: ResearchTableInput = {
        kind: 'research', live: true, now: NOW, waiting,
        working: [{ person: 'P0003', task: 'Křest Josefa', who: 'agent', since: '2026-11-10T09:00:00Z' }],
        queue: [
            { id: 'T0301', state: 'next', person: 'P0005', text: 'Hledat otce' }, { id: 'T0302', state: 'parked', person: 'P0001', text: 'b' },
            { id: 'T0303', state: 'next', person: 'P0003', text: 'c' }, { state: 'next', person: 'P0005', text: 'Bez id' },
        ],
        materialsOf: p => p.refn === 'P0005' ? 2 : null,
        ...more,
    };
    const env = researchTableEnv(data, input);
    return { data, env, P: (refn: string) => byRefn(data, refn) };
}

const ids = (b: ResearchBubble | null) => b?.sections.map(s => s.id) ?? [];
const actionIds = (b: ResearchBubble | null) => b ? researchBubbleActions(b).map(a => a.id) : [];

describe('research bubble sections (§16.4)', () => {
    const { env, P } = setup();

    it('heads the bubble with the name and research id', () => {
        const b = researchBubble(env, P('P0005'), 'rWait')!;
        expect(b.name).toContain('Matěj');
        expect(b.refn).toBe('P0005');
        expect(b.readOnly).toBe(false);
        expect(b.note).toBeUndefined();
    });

    it('Awaiting decision: each item with its answer, the panel under them', () => {
        const b = researchBubble(env, P('P0005'), 'rWait')!;
        expect(ids(b)).toEqual(['wait']);
        const s = b.sections[0];
        expect(s.title).toBe('Čeká na rozhodnutí · 2');
        expect(s.signal).toBe('wait');
        expect(s.items.map(i => [i.title, i.ref, i.lines[0]])).toEqual([
            ['Rozhodnout otce Matěje', 'T0201', 'od 10. 11. 2026'], ['Doplnit křest', 'T0202', 'od 9. 11. 2026'],
        ]);
        expect(s.items[0].actions).toEqual([expect.objectContaining({ id: 'waitAnswer', via: 'item', waitId: 'T0201', mark: null })]);
        expect(s.actions.map(a => [a.id, a.label])).toEqual([['waitingPanel', 'Čeká na vyřízení ›']]);
    });

    it('Awaiting decision: a new version of the story compares versions', () => {
        const b = researchBubble(env, P('P0004'), 'rWait')!;
        expect(b.sections[0].items.map(i => i.title)).toEqual(['Nová verze příběhu']);
        expect(b.sections[0].items[0].actions.map(a => [a.id, a.label, a.via])).toEqual([['storyCompare', 'Porovnat verze ›', 'app']]);
    });

    it('Awaiting decision: waiting on others is information only', () => {
        const b = researchBubble(env, P('P0001'), 'rWait')!;
        const s = b.sections[0];
        expect(s.title).toBe('Čeká zvenku');
        expect(s.signal).toBe('ext');
        expect(s.items).toEqual([expect.objectContaining({ fromOutside: true, actions: [] })]);
        expect(s.items[0].title).toContain('Farní úřad Lipová Stráň');
        expect(s.actions).toEqual([]);
    });

    it('Conflicts: the fact, both values with whose they are, Decide', () => {
        const b = researchBubble(env, P('P0006'), 'rConf')!;
        const s = b.sections[0];
        expect(s.title).toBe('Rozpory pramenů · 1');
        expect(s.items[0].title).toBe('Rok narození Marie');
        expect(s.items[0].ref).toBe('X0001');
        expect(s.items[0].lines).toEqual(['1853 · úprava v aplikaci', '1854 · S0014 Matrika N Lipová Stráň 1784–1830']);
        expect(s.items[0].actions).toEqual([expect.objectContaining({ id: 'decide', via: 'app', conflictId: 'X0001', mark: null })]);
    });

    it('Hypotheses: open ones and those decided by agent with the review in the research', () => {
        const open = researchBubble(env, P('P0013'), 'rHyp')!;
        expect(open.sections[0].title).toBe('Hypotézy · 1 otevřená');
        expect(open.sections[0].signal).toBe('q');
        expect(open.sections[0].items.map(i => [i.title, i.ref])).toEqual([['Je Václav synem Vendelína?', 'H0003']]);
        expect(open.sections[0].actions.map(a => [a.id, a.label])).toEqual([['knows', 'Co ví výzkum ›']]);
        const agent = researchBubble(env, P('P0011'), 'rHyp')!;
        const s = agent.sections[0];
        expect(s.title).toBe('Hypotézy · 0 otevřených');
        expect(s.items[0].lines).toEqual(['Rozhodl agent 8. 11. 2026: varianta B: Křest neodpovídá.']);
        expect(s.items[0].actions).toEqual([expect.objectContaining({
            id: 'reviewHypothesis', via: 'link', hypothesisId: 'H0002',
            link: { action: 'hypothesis', params: { hypothesis: 'H0002', hypothesisDo: 'decide' } },
        })]);
    });

    it('Hypotheses: an open question of the person', () => {
        const { env: e, P: Q } = setup({}, d => { byRefn(d, 'P0007').question = 'Odkud přišel?'; });
        const s = researchBubble(e, Q('P0007'), 'rHyp')!.sections[0];
        expect(s.title).toBe('Otevřená otázka');
        expect(s.items.map(i => i.title)).toEqual(['Odkud přišel?']);
    });

    it('Agent: the task, since when and the line, Follow the research', () => {
        const s = researchBubble(env, P('P0003'), 'rAgent')!.sections[0];
        expect(s.title).toBe('Agent pracuje');
        expect(s.items[0].title).toBe('Křest Josefa');
        expect(s.items[0].lines[0]).toBe('od 10. 11. 2026 · linie G0001 Předci Karla Pivoňkovského');
        expect(s.actions).toEqual([expect.objectContaining({ id: 'follow', via: 'link', link: { action: 'live', params: {} } })]);
    });

    it('Research tasks: each queued task with its place and its link, none without an id', () => {
        const s = researchBubble(env, P('P0005'), 'rTasks')!.sections[0];
        expect(s.title).toBe('Úkoly výzkumu ve frontě · 2');
        expect(s.items.map(i => i.title)).toEqual(['1. ve frontě · Hledat otce', '3. ve frontě · Bez id']);
        expect(s.items[0].actions).toEqual([expect.objectContaining({ id: 'openTask', taskId: 'T0301', link: { action: 'task', params: { task: 'T0301' } } })]);
        expect(s.items[1].actions).toEqual([]);
        expect(s.actions.map(a => a.id)).toEqual(['follow']);
    });

    it('Materials: the count and its action', () => {
        const s = researchBubble(env, P('P0005'), 'rMat')!.sections[0];
        expect(s.title).toBe('Materiály · 2');
        expect(s.actions.map(a => [a.id, a.label])).toEqual([['materials', 'Materiály ›']]);
        expect(researchBubble(env, P('P0003'), 'rMat')).toBeNull();
    });

    it('Line: the line, starting person, kind, count and why a partner is in it', () => {
        const s = researchBubble(env, P('P0004'), 'rLine')!.sections[0];
        expect(s.title).toBe('Linie');
        expect(s.items[0].title).toBe('G0001 Předci Karla Pivoňkovského');
        expect(s.items[0].lines[0]).toMatch(/^Výchozí osoba: Karel .* · předci · \d+ (lidí|lidé) i s partnery$/);
        expect(s.items[0].lines[1]).toMatch(/^Rozálie .* je v linii jako partnerka \(Josef .*\)\.$/);
        expect(s.actions.map(a => [a.id, a.lineId])).toEqual([['showLine', 'G0001'], ['changeInResearch', 'G0001']]);
        const paused = researchBubble(env, P('P0013'), 'rLine')!.sections[0];
        expect(paused.items[0].lines).toContain('Linie je pozastavená.');
    });

    it('Line: a side branch with its person, where it comes from and how the work off the lines goes', () => {
        const s = researchBubble(env, P('P0007'), 'rLine')!.sections[0];
        expect(s.title).toBe('Mimo linie');
        expect(s.items[0].title).toMatch(/^Vedlejší větev: Marie /);
        expect(s.items[0].lines[0]).toMatch(/^\d+ (lidé|lidí|člověk) · větev vychází z linie G0001 \(Josef .*\)$/);
        expect(s.items[0].lines[1]).toBe('Práce mimo linie: občas');
        expect(s.actions.map(a => [a.id, a.label, a.branchId, a.lineId])).toEqual([
            ['showLine', 'Ukázat větev ve stromu', 'B-P0006', 'G0001'], ['changeInResearch', 'Změnit ve výzkumu', undefined, 'G0001'],
        ]);
        const island = researchBubble(env, P('P0010'), 'rLine')!.sections[0];
        expect(island.items[0].title).toBe('Ostrov');
        expect(island.actions).toEqual([]);
    });

    it('Originally in the family tree: the change, its source; Restore only with the bridge here on a computer', () => {
        const s = researchBubble(env, P('P0005'), 'rOrig')!.sections[0];
        expect(s.title).toBe('Původně v rodokmenu');
        expect(s.items[0].title).toBe('Narození: 1822 → nyní 1821');
        expect(s.items[0].lines).toEqual(['Změnil výzkum podle S0014 Matrika N Lipová Stráň 1784–1830.']);
        // The fixture's change has no key of the fact: no Restore.
        expect(s.items[0].actions.map(a => [a.id, a.label])).toEqual([['source', 'Pramen S0014 ›']]);
        const withRef = setup({}, d => { byRefn(d, 'P0005').researchOrigins!.birth.was!.ref = 'BIRT-1'; });
        const on = (caps: Parameters<typeof researchBubble>[3]) => actionIds(researchBubble(withRef.env, withRef.P('P0005'), 'rOrig', caps));
        expect(on({ onComputer: true, bridgeLive: true })).toEqual(['revert', 'source']);
        expect(on({ onComputer: true, bridgeLive: false })).toEqual(['source']);
        expect(on({ onComputer: false, bridgeLive: true })).toEqual(['source']);
        const revert = researchBubbleActions(researchBubble(withRef.env, withRef.P('P0005'), 'rOrig', { onComputer: true, bridgeLive: true })!)[0];
        expect(revert).toEqual(expect.objectContaining({ via: 'bridge', fact: 'birth', mark: null, label: 'Vrátit hodnotu z rodokmenu' }));
    });

    it('Source availability: where each book is; the archive on the web only with its address', () => {
        const s = researchBubble(env, P('P0005'), 'rAvail')!.sections[0];
        expect(s.title).toBe('Dostupnost pramenů');
        expect(s.items.map(i => i.title)).toEqual(['Matrika N Lipová Stráň 1784–1830', 'Matrika O Lipová Stráň 1800–1850']);
        expect(s.actions).toEqual([]);
        const web = setup({}, d => {
            byRefn(d, 'P0005').research!.waits = [{ id: 'T0900', group: { name: 'SOA Zelený Brod', type: 'archive', url: 'https://example.org/soa' } }];
        });
        const a = researchBubble(web.env, web.P('P0005'), 'rAvail')!.sections[0].actions;
        expect(a).toEqual([expect.objectContaining({ id: 'archive', via: 'web', url: 'https://example.org/soa', mark: null })]);
    });

    it('a column without its own section shows its cell in words, no actions', () => {
        const b = researchBubble(env, P('P0013'), 'rSearched')!;
        expect(ids(b)).toEqual(['info']);
        expect(b.sections[0].title).toBe(strings.table.col.rSearched);
        expect(actionIds(b)).toEqual([]);
    });

    it('an empty cell has no bubble; a tree without research none at all', () => {
        expect(researchBubble(env, P('P0010'), 'rConf')).toBeNull();
        const none = setup({ kind: 'none' });
        expect(researchBubble(none.env, none.P('P0005'), 'rSum')).toBeNull();
    });

    it('every column gives a bubble or none without throwing', () => {
        for (const col of RESEARCH_COLUMNS) {
            for (const p of ['P0001', 'P0003', 'P0005', 'P0006', 'P0011', 'P0013']) expect(() => researchBubble(env, P(p), col)).not.toThrow();
        }
    });
});

describe('the summary bubble (rSum)', () => {
    const { env, P } = setup();

    it('has every section with content, the most urgent first and materials last', () => {
        const b = researchBubble(env, P('P0005'), 'rSum')!;
        expect(ids(b)).toEqual(['wait', 'tasks', 'line', 'orig', 'avail', 'mat']);
        const order = ids(b).map(id => RESEARCH_BUBBLE_ORDER.indexOf(id));
        expect(order).toEqual([...order].sort((a, c) => a - c));
        expect(RESEARCH_BUBBLE_ORDER[RESEARCH_BUBBLE_ORDER.length - 1]).toBe('mat');
        expect(RESEARCH_BUBBLE_ORDER.slice(0, 5)).toEqual(['wait', 'conf', 'hyp', 'agent', 'tasks']);
    });

    it('a person with an agent, tasks and a line', () => {
        expect(ids(researchBubble(env, P('P0003'), 'rSum'))).toEqual(['agent', 'tasks', 'line']);
        expect(ids(researchBubble(env, P('P0006'), 'rSum'))).toEqual(['conf', 'line']);
    });
});

describe('the bubble of a ≠ (Conflicts)', () => {
    const { env, P } = setup();

    it('shows only the conflicts named, a partner’s with the partner’s name and Decide', () => {
        const b = researchConflictBubble(env, P('P0007'), [{ personId: P('P0006').id, conflictId: 'X0001' }])!;
        expect(b.personId).toBe(P('P0007').id);
        expect(ids(b)).toEqual(['conf']);
        expect(b.sections[0].items[0].title).toMatch(/^Rok narození Marie \(Marie .*\)$/);
        expect(b.sections[0].items[0].actions[0]).toEqual(expect.objectContaining({ id: 'decide', personId: P('P0006').id, conflictId: 'X0001' }));
        const own = researchConflictBubble(env, P('P0006'), [{ personId: P('P0006').id, conflictId: 'X0001' }])!;
        expect(own.sections[0].items[0].title).toBe('Rok narození Marie');
    });

    it('leaves out unknown and decided conflicts', () => {
        expect(researchConflictBubble(env, P('P0006'), [{ personId: P('P0006').id, conflictId: 'X9999' }])).toBeNull();
        const decided = setup({ conflictsOf: () => [{ id: 'X0001', fact: 'BIRT', status: 'decided', values: [] }] });
        expect(researchConflictBubble(decided.env, decided.P('P0006'), [{ personId: decided.P('P0006').id, conflictId: 'X0001' }])).toBeNull();
    });
});

describe('the actions’ marks come from the research links’ map', () => {
    const { env, P } = setup();

    it('a research link’s action has the map’s mark, any other none', () => {
        const all = ['P0001', 'P0003', 'P0004', 'P0005', 'P0006', 'P0007', 'P0011', 'P0013']
            .flatMap(r => researchBubbleActions(researchBubble(env, P(r), 'rSum', { onComputer: true, bridgeLive: true })!));
        expect(new Set(all.map(a => a.id))).toEqual(new Set([
            'waitAnswer', 'storyCompare', 'waitingPanel', 'decide', 'knows', 'reviewHypothesis', 'follow', 'openTask', 'materials',
            'showLine', 'changeInResearch', 'source',
        ]));
        for (const a of all) {
            if (a.via === 'link') expect(a.mark).toBe(researchLinkMark(a.link!.action));
            else expect(a.mark).toBeNull();
        }
        const markOf = (id: string) => all.find(a => a.id === id)!.mark;
        // §16.4: a queued task and a hypothesis' review open the research's terminal; following the research does not.
        expect(markOf('openTask')).toBe(researchLinkMark('task'));
        expect(markOf('openTask')).toBe('terminal');
        expect(markOf('reviewHypothesis')).toBe('terminal');
        expect(markOf('follow')).toBe(researchLinkMark('live'));
        expect(markOf('follow')).toBe('none');
    });
});

describe('a read-only copy and an archive', () => {
    it('read-only: no actions anywhere, the note says why, no live sections', () => {
        const { env, P } = setup({ readOnly: true });
        for (const r of ['P0005', 'P0006', 'P0011', 'P0004']) {
            const b = researchBubble(env, P(r), 'rSum');
            if (!b) continue;
            expect(b.readOnly).toBe(true);
            expect(b.note).toBe('Jen ke čtení: rozpory tu nejde rozhodnout.');
            expect(actionIds(b)).toEqual([]);
            expect(ids(b)).not.toContain('wait');
            expect(ids(b)).not.toContain('agent');
            expect(ids(b)).not.toContain('tasks');
        }
        const conf = researchConflictBubble(env, P('P0006'), [{ personId: P('P0006').id, conflictId: 'X0001' }])!;
        expect(conf.note).toBe(strings.table.res.roNote);
        expect(actionIds(conf)).toEqual([]);
    });

    it('archive: the data sections only, no research link actions that need it live', () => {
        const { env, P } = setup({ kind: 'archive', live: false });
        const b = researchBubble(env, P('P0005'), 'rSum')!;
        expect(ids(b)).toEqual(['line', 'orig', 'avail', 'mat']);
        expect(b.readOnly).toBe(false);
        expect(actionIds(b)).not.toContain('changeInResearch');
        expect(actionIds(b)).not.toContain('follow');
        expect(actionIds(researchBubble(env, P('P0011'), 'rHyp'))).toEqual(['knows']);
        expect(researchBubble(env, P('P0005'), 'rWait')).toBeNull();
        expect(researchBubble(env, P('P0003'), 'rAgent')).toBeNull();
    });
});

describe('texts in every language', () => {
    it('en, de and pl give the same sections', () => {
        for (const lang of ['en', 'de', 'pl'] as const) {
            setLanguage(lang);
            const { env, P } = setup();
            const b = researchBubble(env, P('P0005'), 'rSum')!;
            expect(ids(b)).toEqual(['wait', 'tasks', 'line', 'orig', 'avail', 'mat']);
            expect(b.sections.every(s => s.title.length > 0)).toBe(true);
        }
        setLanguage('cs');
    });
});
