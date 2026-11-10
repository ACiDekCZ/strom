/**
 * The research in the Table view, its data layer (spec 073 §16): the
 * research's lines, side branches, waits and added dates read from its
 * GEDCOM, never sent back; the live places of `/directions/people`; the
 * values of every research column, the chips and the line roles.
 * Invented data only (e2e/fixtures/research-table.ged).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { applyContentOptions } from '../privacy.js';
import { migrateData } from '../data.js';
import { diffByPerson } from '../research-changes.js';
import { sanitizeLiveStatus } from '../research-link.js';
import { directionPlacesOf, directionPlacesKept, fetchDirectionPeople, forgetDirectionPeople, onDirectionPlaces } from '../research-directions-write.js';
import { setLanguage, strings } from '../strings.js';
import type { LiveWaiting } from '../research-link.js';
import type { Person, PersonId, StromData } from '../types.js';
import {
    researchTableEnv, researchCell, researchColumns, researchChips, researchLinesOf, personLineRole, researchLineCounts,
    researchColumnLiveOff, unionLineRole, unionResearchIdCell, sourceResearchIdCell, type ResearchTableInput,
    researchOffer, unionResearchCell, sourceImageCell, applyResearch, RESEARCH_DEFAULT_COLUMNS,
} from '../ui/table-view/table-research.js';
import { cellOf, columnById, columnOffered, setResearchOffer } from '../ui/table-view/table-columns.js';
import { catalogColumns, defaultTypeState, groupAllColumns, setGroupShown, shownColumns, showColumn } from '../ui/table-view/table-state.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import type { Partnership, Source } from '../types.js';

const GED = readFileSync(join(__dirname, '../../e2e/fixtures/research-table.ged'), 'utf8');
const LIVE = JSON.parse(readFileSync(join(__dirname, '../../e2e/fixtures/research-table-directions.json'), 'utf8')) as Record<string, unknown>;
const NOW = Date.parse('2026-11-10T12:00:00Z');

const load = (ged = GED): StromData => convertToStrom(parseGedcom(ged)).data;
const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;
const asPlain = (ged: string) => ged.replace('1 SOUR STROM_RESEARCH\n', '1 SOUR OTHER\n');

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setLanguage('cs');
});
afterAll(() => {
    vi.useRealTimers();
    setLanguage('en');
});

describe('GEDCOM: the research lines, branches, waits and added dates', () => {
    it('reads the header lines and side branches in the file order, unknown tags skipped', () => {
        expect(load().researchDirections).toEqual({
            complete: true,
            lines: [
                { id: 'G0001', name: 'Předci Karla Pivoňkovského', kind: 'ancestors', focus: 'P0001', state: 'active' },
                { id: 'G0002', name: 'Klikvové z Rebarborova', kind: 'descendants', focus: 'P0002', state: 'paused' },
            ],
            branches: [
                { id: 'B-P0006', person: 'P0006', via: { person: 'P0003', rel: 'sibling' }, nearest: 'G0001', mode: 'occasional' },
                { id: 'B-P0009', person: 'P0009', via: { person: 'P0004', rel: 'sibling' }, nearest: 'G0001', line: 'G0001', mode: 'last' },
            ],
        });
    });

    it('reads every person place, waits and the added instant', () => {
        const data = load();
        expect(byRefn(data, 'P0004').research?.places).toEqual([{ role: 'partner', line: 'G0001' }]);
        expect(byRefn(data, 'P0007').research?.places).toEqual([{ role: 'branch', branch: 'B-P0006' }]);
        expect(byRefn(data, 'P0009').research?.places).toEqual([{ role: 'branch', line: 'G0001', branch: 'B-P0009' }]);
        expect(byRefn(data, 'P0010').research?.places).toEqual([{ role: 'island' }]);
        expect(byRefn(data, 'P0011').research?.places).toBeUndefined();
        expect(byRefn(data, 'P0001').research?.waits).toEqual([{
            id: 'T0101', type: 'letter', title: 'Dopis faře o křtu Karla', on: 'P0001',
            group: { name: 'Farní úřad Lipová Stráň', type: 'office', key: 'fu-lipova-stran' },
            stat: 'sent', sent: '2026-10-03', prio: 2,
        }]);
        expect(byRefn(data, 'P0003').research?.waits?.map(w => [w.id, w.group?.url, w.prio])).toEqual([
            ['T0102', 'https://example.org/soa', 1], ['T0103', undefined, 3],
        ]);
        expect(byRefn(data, 'P0001').research?.added).toBe('2026-11-09T14:20:00.000Z');
    });

    it('several places per person, the narrowest first; invalid ones go', () => {
        const ged = GED.replace('0 @I1@ INDI\n', '0 @I1@ INDI\n1 _STROM_DIRECTION G0002\n2 TYPE partner\n1 _STROM_DIRECTION G0003\n2 TYPE nonsense\n1 _STROM_DIRECTION\n2 TYPE line\n');
        expect(byRefn(load(ged), 'P0001').research?.places).toEqual([{ role: 'partner', line: 'G0002' }, { role: 'line', line: 'G0001' }]);
    });

    it('a file not written by the research keeps none of it', () => {
        const data = load(asPlain(GED));
        expect(data.researchDirections).toBeUndefined();
        expect(Object.values(data.persons).some(p => p.research)).toBe(false);
    });

    it('a tree loads with it unchanged (migrateData keeps it)', () => {
        const data = load();
        const again = migrateData(JSON.parse(JSON.stringify(data)));
        expect(again.researchDirections).toEqual(data.researchDirections);
        expect(byRefn(again, 'P0001').research).toEqual(byRefn(data, 'P0001').research);
    });
});

describe('never sent back', () => {
    it('the GEDCOM to the research has none of the tags; sent back unchanged it brings nothing', () => {
        const data = load();
        const ged = exportToGedcom(data, 'Test', { research: { id: '7d3f2a10-5c4b-4e8a-9b61-1f0e2d3c4b5a' } }).content;
        expect(ged).not.toMatch(/_STROM_DIRECTIONS|_STROM_DIRECTION|_STROM_BRANCH|_STROM_WAIT|_STROM_ADDED/);
        // Not a change of the app's either: the same tree with other places, waits and dates sends nothing.
        const other: StromData = JSON.parse(JSON.stringify(data));
        for (const p of Object.values(other.persons)) {
            if (!p.research) continue;
            p.research.places = [{ role: 'island' }];
            delete p.research.waits;
            delete p.research.added;
        }
        delete other.researchDirections;
        expect(diffByPerson(data, other)).toEqual([]);
        // Read back, the sent file carries none of it.
        const back = load(ged.replace(/1 SOUR STROM\b.*\n/, '1 SOUR STROM_RESEARCH\n'));
        expect(back.researchDirections).toBeUndefined();
        expect(Object.values(back.persons).some(p => p.research?.places || p.research?.waits || p.research?.added)).toBe(false);
    });

    it('a copy that leaves the app drops them', () => {
        const out = applyContentOptions(load(), false);
        expect(out.researchDirections).toBeUndefined();
        for (const p of Object.values(out.persons)) {
            expect(p.research?.places).toBeUndefined();
            expect(p.research?.waits).toBeUndefined();
            expect(p.research?.added).toBeUndefined();
        }
        // What the records say stays.
        expect(byRefn(out, 'P0006').research?.conflicts).toHaveLength(1);
    });
});

describe('live: /directions/people with places', () => {
    const BASE = 'http://127.0.0.1:5996/tok';
    const realFetch = globalThis.fetch;
    let calls = 0;
    const reply = (body: unknown) => {
        globalThis.fetch = vi.fn(async () => { calls++; return new Response(JSON.stringify(body), { status: 200 }); }) as typeof fetch;
    };
    afterEach(() => { globalThis.fetch = realFetch; calls = 0; forgetDirectionPeople(); });

    it('reads places, lines, branches and rev, checked', () => {
        const live = directionPlacesOf({ ...LIVE, places: { ...(LIVE.places as object), bad: [{ role: 'line', line: 'G0001' }], P0099: [{ role: 'line' }, { role: 'what' }] } })!;
        expect(live.places.get('P0004')).toEqual([{ role: 'partner', line: 'G0001' }]);
        expect(live.places.has('P0099')).toBe(false);
        expect(live.lines.map(l => [l.id, l.kind, l.state])).toEqual([['G0001', 'ancestors', 'active'], ['G0002', 'descendants', 'active']]);
        expect(live.branches[1]).toEqual({ id: 'B-P0009', person: 'P0009', via: { person: 'P0004', rel: 'sibling' }, nearest: 'G0001', line: 'G0001', mode: 'last' });
        expect(live.rev).toBe('d1r-0007');
        expect(directionPlacesOf({ people: {} })).toBeNull();
    });

    it('/status.directions.rev only with the directions.places feature', () => {
        const base = { ok: true, treeId: '7d3f2a10-5c4b-4e8a-9b61-1f0e2d3c4b5a', directions: { rev: 'd1r-0008' } };
        expect(sanitizeLiveStatus({ ...base, features: ['directions.places'] })?.directionsRev).toBe('d1r-0008');
        expect(sanitizeLiveStatus({ ...base, features: [] })?.directionsRev).toBeUndefined();
    });

    it('read again when the rev changes, kept otherwise; listeners told', async () => {
        const told: string[] = [];
        const stop = onDirectionPlaces(b => told.push(b));
        reply(LIVE);
        await fetchDirectionPeople(BASE, 'abcdef7', 'd1r-0007');
        expect(directionPlacesKept(BASE)?.rev).toBe('d1r-0007');
        await fetchDirectionPeople(BASE, 'abcdef7', 'd1r-0007');
        expect(calls).toBe(1);
        await fetchDirectionPeople(BASE, 'abcdef7', 'd1r-0008');
        expect(calls).toBe(2);
        // Without a rev the head decides, as before.
        await fetchDirectionPeople(BASE, 'abcdef7');
        expect(calls).toBe(2);
        expect(told).toEqual([BASE, BASE]);
        stop();
    });
});

describe('lines and line roles (§16.9)', () => {
    const data = load();
    const file = researchLinesOf(data);
    const role = (refn: string, model = file) => personLineRole(model, byRefn(data, refn));

    it('from the file: line, partner, side branch, branch in a line, island, off the lines', () => {
        expect(file.source).toBe('file');
        expect(role('P0001')).toMatchObject({ kind: 'line', partner: false, index: 0 });
        expect(role('P0004')).toMatchObject({ kind: 'line', partner: true });
        expect(role('P0006')).toMatchObject({ kind: 'branch', branchId: 'B-P0006' });
        expect(role('P0009')).toMatchObject({ kind: 'line', line: { id: 'G0001' }, branch: { id: 'B-P0009' } });
        expect(role('P0010')).toEqual({ kind: 'island' });
        expect(role('P0011')).toEqual({ kind: 'off' });
    });

    it('live places win over the file', () => {
        const live = researchLinesOf(data, directionPlacesOf(LIVE));
        expect(live.source).toBe('live');
        expect(role('P0010', live)).toMatchObject({ kind: 'line', line: { id: 'G0002' } });
        expect(live.lines[1].state).toBe('active');
    });

    it('without _STROM_DIRECTIONS Y a person without a place is not known', () => {
        const partial = load(GED.replace('1 _STROM_DIRECTIONS Y\n', ''));
        expect(personLineRole(researchLinesOf(partial), byRefn(partial, 'P0011'))).toBeNull();
    });

    it('a tree without lines has none', () => {
        expect(researchLinesOf(load(GED.replace(/1 _STROM_DIRECTIONS Y\n/, '').replace(/1 _STROM_DIRECTION G000[12]\n(2 .*\n)+/g, ''))).source).toBe('none');
    });
});

describe('research cells', () => {
    const data = load();
    const P = (refn: string) => byRefn(data, refn);
    const waiting: LiveWaiting[] = [
        { id: 'T0201', what: 'Rozhodnout otce Matěje', on: '', at: '2026-11-10T10:00:00Z', person: 'P0005' },
        { id: 'T0202', what: 'Doplnit křest', on: '', at: '2026-11-10T10:00:00Z', person: 'P0005' },
        { id: 'S0001', what: '', on: '', at: '2026-11-10T10:00:00Z', person: 'P0004', kind: 'story' },
        { id: 'T0101', what: 'Dopis faře', on: '', at: '2026-10-03T10:00:00Z', person: 'P0001', kind: 'letter', phase: 'sent', sentAt: '2026-10-03',
            group: { key: 'fu-lipova-stran', name: 'Farní úřad Lipová Stráň', kind: 'office' } },
    ];
    const input = (more: Partial<ResearchTableInput> = {}): ResearchTableInput => ({
        kind: 'research', live: true, now: NOW, waiting,
        working: [{ person: 'P0003', task: 'Křest Josefa', who: 'agent' }],
        queue: [{ state: 'next', person: 'P0005', text: 'a' }, { state: 'parked', person: 'P0001', text: 'b' }, { state: 'next', person: 'P0003', text: 'c' }, { state: 'next', person: 'P0005', text: 'd' }],
        done: new Map([['P0013', NOW - 1000], ['P0012', NOW - 10_000]]),
        unsent: new Map<PersonId, ('birth' | 'name')[]>([[P('P0013').id, ['birth', 'name']]]),
        materialsOf: p => p.refn === 'P0001' ? 3 : p.refn === 'P0002' ? 0 : null,
        generationOf: id => ({ P0001: 0, P0003: -1, P0005: -2 } as Record<string, number>)[data.persons[id]?.refn ?? ''],
        lastOpened: Date.parse('2026-11-09T00:00:00Z'),
        ...more,
    });
    const env = researchTableEnv(data, input());
    const text = (refn: string, col: Parameters<typeof researchCell>[2], e = env) => researchCell(e, P(refn), col).text;

    it('columns per kind of tree (§16.1)', () => {
        expect(researchColumns(env)).toContain('rWait');
        expect(researchColumns(env)).toContain('rLine');
        const archive = researchTableEnv(data, input({ kind: 'archive', live: false }));
        expect(researchColumns(archive)).not.toContain('rWait');
        expect(researchColumns(archive)).not.toContain('rTasks');
        expect(researchColumns(archive)).not.toContain('rAgent');
        expect(researchColumns(archive)).toContain('rLine');
        expect(researchColumns(researchTableEnv(data, input({ kind: 'none' })))).toEqual([]);
        expect(researchColumns(researchTableEnv(data, input({ readOnly: true })))).not.toContain('rWait');
        const noLines = load(GED.replace(/1 _STROM_DIRECTIONS Y\n/, '').replace(/1 _STROM_DIRECTION G000[12]\n(2 .*\n)+/g, ''));
        expect(researchColumns(researchTableEnv(noLines, input()))).not.toContain('rLine');
    });

    it('rSum: the most urgent kind and "+n"; data only in an archive', () => {
        const c = researchCell(env, P('P0005'), 'rSum');
        expect(c.research).toMatchObject({ signal: 'wait', more: 1, export: 'čeká; ve frontě' });
        expect(c.sortKey).toBe(5);
        expect(researchCell(env, P('P0006'), 'rSum').research).toMatchObject({ signal: 'conf', export: 'rozpor (1)' });
        expect(researchCell(env, P('P0013'), 'rSum').research?.signal).toBe('q');
        expect(researchCell(env, P('P0003'), 'rSum').research).toMatchObject({ signal: 'agent', more: 1 });
        const archive = researchTableEnv(data, input({ kind: 'archive', live: false }));
        expect(researchCell(archive, P('P0005'), 'rSum').empty).toBe(true);
        expect(researchCell(env, P('P0002'), 'rSum').sortKey).toBeNull();
    });

    it('rWait: count and first item; a story; waiting outside', () => {
        expect(researchCell(env, P('P0005'), 'rWait').research).toMatchObject({ signal: 'wait', count: 2, export: '2: Rozhodnout otce Matěje' });
        expect(text('P0004', 'rWait')).toBe(`1 ${strings.story.nvWaitingItem}`);
        const ext = researchCell(env, P('P0001'), 'rWait');
        expect(ext.research?.signal).toBe('ext');
        expect(ext.text).toBe('zvenku: dopis odeslán 3. 10. 2026 · Farní úřad Lipová Stráň');
        // Without the bridge the file's sent wait says the same.
        const off = researchTableEnv(data, input({ live: false, waiting: [] }));
        expect(text('P0001', 'rWait', off)).toBe('zvenku: dopis odeslán 3. 10. 2026 · Farní úřad Lipová Stráň');
    });

    it('rConf: count, facts and decidable here (not read-only)', () => {
        expect(text('P0006', 'rConf')).toBe('1 · narození · lze rozhodnout v aplikaci');
        expect(researchCell(env, P('P0006'), 'rConf').research?.export).toBe('1: narození');
        expect(text('P0006', 'rConf', researchTableEnv(data, input({ readOnly: true })))).toBe('1 · narození');
        const provided = researchTableEnv(data, input({ conflictsOf: () => [] }));
        expect(researchCell(provided, P('P0006'), 'rConf').empty).toBe(true);
    });

    it('rHyp: open count, else decided by the agent', () => {
        expect(researchCell(env, P('P0013'), 'rHyp')).toMatchObject({ text: '1', sortKey: 1 });
        expect(text('P0011', 'rHyp')).toBe('rozhodl agent');
    });

    it('rTasks and rAgent: live only', () => {
        expect(text('P0005', 'rTasks')).toBe('2 · nejbližší 1. ve frontě');
        expect(researchCell(env, P('P0005'), 'rTasks').research?.export).toBe('2: nejbližší 1. ve frontě');
        expect(text('P0003', 'rTasks')).toBe('2 · právě běží');
        expect(text('P0003', 'rAgent')).toBe('pracuje: Křest Josefa');
        expect(text('P0005', 'rAgent')).toBe('ve frontě');
        expect(researchCell(env, P('P0013'), 'rAgent').research?.signal).toBe('done');
        expect(researchCell(env, P('P0012'), 'rAgent').empty).toBe(true);
        const off = researchTableEnv(data, input({ live: false }));
        expect(researchColumnLiveOff(off, 'rAgent')).toBe(true);
        expect(researchCell(off, P('P0003'), 'rAgent')).toMatchObject({ text: '–', ghost: true, research: { liveOff: true, export: '' } });
    });

    it('rMat: the materials count', () => {
        expect(researchCell(env, P('P0001'), 'rMat')).toMatchObject({ text: '3', sortKey: 3 });
        expect(researchCell(env, P('P0002'), 'rMat')).toMatchObject({ text: '0', ghost: true });
        expect(researchCell(env, P('P0003'), 'rMat').empty).toBe(true);
    });

    it('rLine: line, partner, side branch, island, off the lines; sorted by line then generation', () => {
        expect(text('P0001', 'rLine')).toBe('G0001 Předci Karla Pivoňkovského');
        expect(text('P0004', 'rLine')).toBe('G0001 Předci Karla Pivoňkovského · partner');
        expect(researchCell(env, P('P0004'), 'rLine').research?.export).toBe('G0001 Předci Karla Pivoňkovského (partner)');
        expect(text('P0007', 'rLine')).toBe('vedlejší větev: Marie Pivoňkovská');
        expect(text('P0009', 'rLine')).toBe('G0001 Předci Karla Pivoňkovského · vedlejší větev: Vojtěch Brčál');
        expect(text('P0010', 'rLine')).toBe('ostrov');
        expect(text('P0011', 'rLine')).toBe('mimo linie');
        const keys = ['P0001', 'P0003', 'P0005', 'P0013', 'P0006', 'P0010', 'P0011'].map(r => researchCell(env, P(r), 'rLine').sortKey as string);
        expect([...keys].sort()).toEqual([keys[2], keys[1], keys[0], keys[3], keys[4], keys[5], keys[6]]);
    });

    it('§16.8: the tree ends here, searched with nothing found', () => {
        // Live: the waiting item beats the snapshot's queue; without the bridge the snapshot says.
        expect(text('P0005', 'rEdge')).toBe('chybí rodiče · zatím nehledáno · čeká na odpověď');
        expect(text('P0005', 'rEdge', researchTableEnv(data, input({ live: false, waiting: [] })))).toBe('chybí rodiče · zatím nehledáno · ve frontě');
        expect(text('P0013', 'rSearched')).toBe('2 knihy (Matrika N Zelený Brod 1840–1850, Matrika N Rebarborov 1840–1850), nic');
    });

    it('§16.10: exchange, original value, story, where, new, availability, parish, estimate', () => {
        expect(text('P0013', 'rSync')).toBe('neodesláno: narození, jméno');
        expect(text('P0005', 'rOrig')).toBe('narození: 1822 → nyní 1821 (S0014)');
        expect(text('P0004', 'rStory')).toBe('hotový · nová verze 9. 11. 2026');
        expect(text('P0003', 'rWhere')).toBe('SOA Zelený Brod (archiv) · 2 úkoly · priorita 1');
        expect(researchCell(env, P('P0001'), 'rNew').research).toMatchObject({ signal: 'new', export: 'nové: přidáno 9. 11. 2026' });
        expect(researchCell(env, P('P0002'), 'rNew').research?.signal).toBeUndefined();
        expect(text('P0005', 'rAvail')).toBe('jen badatelna: Matrika N Lipová Stráň 1784–1830 · online: Matrika O Lipová Stráň 1800–1850');
        expect(text('P0013', 'rParish')).toBe('fara Lipová Stráň od 1784');
        expect(researchCell(env, P('P0005'), 'rParish').research?.parts[0]).toMatchObject({ text: 'Horní Ouhrabka – neurčeno; pomůže: farnost', italic: true, tone: 'accent' });
        expect(text('P0005', 'rEst')).toMatch(/1821/);
    });

    it('the research ids of unions and sources', () => {
        const u = Object.values(data.partnerships).find(x => x.researchId === 'F0004')!;
        expect(unionResearchIdCell(u).text).toBe('F0004');
        expect(unionLineRole(env, u)).toMatchObject({ kind: 'line', line: { id: 'G0002' }, partner: false });
        expect(sourceResearchIdCell(Object.values(data.sources ?? {})[0]).text).toBe('S0014');
    });
});

describe('research chips', () => {
    const data = load();
    const P = (refn: string) => byRefn(data, refn);
    const env = researchTableEnv(data, { kind: 'research', live: false, now: NOW, lastOpened: Date.parse('2026-11-09T00:00:00Z') });

    it('each person matches what the data say', () => {
        expect([...researchChips(env, P('P0006'))].sort()).toEqual(['offLine', 'rConf', 'xDecideHere'].sort());
        expect(researchChips(env, P('P0001'))).toEqual(new Set(['line:G0001', 'xExternal', 'xNew']));
        expect(researchChips(env, P('P0005'))).toEqual(new Set(['line:G0001', 'xChanged', 'xReadingRoom', 'xPlaceOpen', 'rEdge']));
        expect(researchChips(env, P('P0011'))).toEqual(new Set(['offLine', 'xAgentDecided', 'xNew']));
        expect(researchChips(env, P('P0009'))).toEqual(new Set(['line:G0001', 'xPaused']));
        expect(researchChips(env, P('P0013'))).toEqual(new Set(['rQ', 'line:G0002', 'xPaused']));
    });

    it('new from research by window', () => {
        expect(researchChips(env, P('P0011'), 'day').has('xNew')).toBe(false);
        expect(researchChips(env, P('P0001'), 'day').has('xNew')).toBe(true);
        expect(researchChips(env, P('P0011'), 'lastOpen').has('xNew')).toBe(false);
        expect(researchChips(env, P('P0002'), 'week').has('xNew')).toBe(false);
    });

    it('line counts with partners, and off the lines', () => {
        const counts = researchLineCounts(env, Object.values(data.persons));
        expect(counts.lines.map(l => [l.line.id, l.count])).toEqual([['G0001', 5], ['G0002', 3]]);
        expect(counts.offLine).toBe(5);
    });
});

describe('research columns in the table (§16.1, §16.2, 16zg, 16zm)', () => {
    const data = load();
    const P = (refn: string) => byRefn(data, refn);
    const U = (ref: string): Partnership => Object.values(data.partnerships).find(x => x.researchId === ref)!;
    const base: ResearchTableInput = { kind: 'research', live: true, now: NOW, working: [{ person: 'P0002', family: 'F0004', task: 'Sňatek 1850', who: 'agent' }] };
    const env = researchTableEnv(data, base);
    afterEach(() => setResearchOffer({}));

    it('researchOffer: per kind of tree; none without research', () => {
        const all = researchOffer(env);
        expect(all.persons).toEqual(researchColumns(env));
        expect(all.unions).toEqual(['uResearchId', 'rLine', 'rAgent', 'rConf']);
        expect(all.sources).toEqual(['srcResearchId', 'srcImage']);
        const archive = researchOffer(researchTableEnv(data, { ...base, kind: 'archive', live: false }));
        expect(archive.unions).toEqual(['uResearchId', 'rLine', 'rConf']);
        expect(archive.persons).not.toContain('rAgent');
        expect(researchOffer(researchTableEnv(data, { ...base, readOnly: true })).unions).not.toContain('rAgent');
        const noLines = load(GED.replace(/1 _STROM_DIRECTIONS Y\n/, '').replace(/1 _STROM_DIRECTION G000[12]\n(2 .*\n)+/g, ''));
        expect(researchOffer(researchTableEnv(noLines, base)).unions).toEqual(['uResearchId', 'rAgent', 'rConf']);
        expect(researchOffer(researchTableEnv(data, { ...base, kind: 'none' }))).toEqual({ persons: [], unions: [], sources: [] });
    });

    it('union cells: the line of the line person, the agent on the couple, the couple\'s conflicts', () => {
        expect(unionResearchCell(env, U('F0001'), 'rLine').text).toBe('G0001 Předci Karla Pivoňkovského');
        expect(unionResearchCell(env, U('F0004'), 'rLine').text).toBe(researchCell(env, P('P0002'), 'rLine').text);
        expect(unionResearchCell(env, U('F0004'), 'rAgent')).toMatchObject({ text: 'pracuje na páru: Sňatek 1850', research: { signal: 'agent' } });
        expect(unionResearchCell(env, U('F0001'), 'rAgent').empty).toBe(true);
        const off = researchTableEnv(data, { ...base, live: false });
        expect(unionResearchCell(off, U('F0004'), 'rAgent')).toMatchObject({ text: '–', ghost: true });
        // A birth conflict is the person's, not the couple's.
        expect(unionResearchCell(env, U('F0003'), 'rConf').empty).toBe(true);
        const marr = load(GED.replace('2 TYPE BIRT\n2 TITL Rok narození Marie', '2 TYPE MARR\n2 TITL Rok sňatku Marie'));
        const menv = researchTableEnv(marr, base);
        const u = Object.values(marr.partnerships).find(x => x.researchId === 'F0003')!;
        const c = unionResearchCell(menv, u, 'rConf');
        expect(c.research).toMatchObject({ signal: 'conf', count: 1 });
        expect(c.research?.export).toMatch(/^1: /);
    });

    it('source image: missing, on the research\'s computer, online, unknown', () => {
        const s = (more: Partial<Source>): Source => ({ id: 'S1', title: 'Matrika', ...more } as Source);
        expect(sourceImageCell(s({ imageHeld: 'missing' }))).toMatchObject({ text: 'sken chybí v počítači výzkumu', sortKey: 0 });
        expect(sourceImageCell(s({ originalInResearch: true })).text).toBe('v počítači výzkumu');
        expect(sourceImageCell(s({ imageHeld: 'limit' })).text).toBe('v počítači výzkumu');
        expect(sourceImageCell(s({ imageHeld: 'other', url: 'https://example.org/scan' })).text).toBe('online (archiv)');
        expect(sourceImageCell(s({})).empty).toBe(true);
    });

    it('the catalog offers the research columns only when the tree does', () => {
        expect(catalogColumns('persons').some(c => c.group === 'research')).toBe(false);
        expect(catalogColumns('unions').map(c => c.id)).not.toContain('uResearchId');
        expect(catalogColumns('sources').map(c => c.id)).not.toContain('srcImage');
        // Not research columns: offered in every tree, hidden by default.
        for (const id of ['question', 'crossTree', 'personStatus']) expect(catalogColumns('persons').map(c => c.id)).toContain(id);
        const st = defaultTypeState('persons');
        expect(showColumn('persons', st, 'rSum')).toBe(false);
        setResearchOffer(researchOffer(env));
        expect(columnOffered(columnById('persons', 'rSum')!)).toBe(true);
        const groups = [...new Set(catalogColumns('persons').map(c => c.group))];
        expect(groups.slice(groups.indexOf('rel'), groups.indexOf('rel') + 3)).toEqual(['rel', 'research', 'checks']);
        expect(catalogColumns('unions').map(c => c.id)).toContain('uResearchId');
        // An archive: no waiting, tasks or agent.
        setResearchOffer(researchOffer(researchTableEnv(data, { ...base, kind: 'archive', live: false })));
        const ids = catalogColumns('persons').map(c => c.id);
        for (const id of ['rWait', 'rTasks', 'rAgent']) expect(ids).not.toContain(id);
        expect(ids).toContain('rSum');
    });

    it('the default state shows no research column, offered or not', () => {
        setResearchOffer(researchOffer(env));
        for (const type of ['persons', 'unions', 'events', 'sources'] as const) {
            const st = defaultTypeState(type);
            expect(shownColumns(type, st, false).columns.some(c => c.fromResearch || ['question', 'crossTree', 'personStatus'].includes(c.id))).toBe(false);
        }
    });

    it('"all" in the research group shows its default set; hiding takes every column', () => {
        setResearchOffer(researchOffer(env));
        expect(groupAllColumns('persons', 'research').map(c => c.id)).toEqual([...RESEARCH_DEFAULT_COLUMNS]);
        expect(groupAllColumns('persons', 'birth').length).toBe(catalogColumns('persons').filter(c => c.group === 'birth').length);
        const st = defaultTypeState('persons');
        expect(setGroupShown('persons', st, 'research', true)).toBe(true);
        expect(st.columns.filter(id => columnById('persons', id)?.group === 'research')).toEqual([...RESEARCH_DEFAULT_COLUMNS]);
        // After the relations group, before the checks.
        expect(st.columns.indexOf('rSum')).toBeLessThan(st.columns.indexOf('nFind'));
        showColumn('persons', st, 'rLine');
        expect(setGroupShown('persons', st, 'research', false)).toBe(true);
        expect(st.columns.some(id => columnById('persons', id)?.group === 'research')).toBe(false);
        // A state with research columns read in a tree without research keeps none of them.
        setGroupShown('persons', st, 'research', true);
        setResearchOffer({});
        expect(shownColumns('persons', st, false).columns.some(c => c.group === 'research')).toBe(false);
    });

    it('the model reads the research through applyResearch; a change drops the cached cells', () => {
        setResearchOffer(researchOffer(env));
        const m = buildTableModel(data, { rev: 1, homeId: null, lang: 'cs', year: 2026 });
        const row = m.persons.find(r => r.person.refn === 'P0001')!;
        const col = columnById('persons', 'rLine')!;
        expect(cellOf(m, row, col).empty).toBe(true);
        expect(applyResearch(m, env)).toBe(true);
        expect(applyResearch(m, env)).toBe(false);
        expect(cellOf(m, row, col).text).toBe('G0001 Předci Karla Pivoňkovského');
        const urow = m.unions.find(r => r.union.researchId === 'F0004')!;
        expect(cellOf(m, urow, columnById('unions', 'uResearchId')!).text).toBe('F0004');
        const srow = m.sources[0];
        expect(cellOf(m, srow, columnById('sources', 'srcResearchId')!).text).toBe('S0014');
        applyResearch(m, null);
        expect(cellOf(m, row, col).empty).toBe(true);
        expect(cellOf(m, srow, columnById('sources', 'srcResearchId')!).empty).toBe(true);
    });
});
