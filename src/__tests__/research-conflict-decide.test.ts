/**
 * Deciding a research conflict from the app (package R1): what the research
 * says about it (2 _STROM_TAKE Y, 3 _STROM_SIDE user|research, 3 _STROM_RAW
 * M|F|U under a SEX conflict's values; `take: true` in the bridge's JSON),
 * kept where conflicts are kept, when the app offers the choice
 * (canDecideInApp), how (conflictDecideMode), the shared request to the
 * bridge (postBridgeDecide) and the link with a side. Invented data only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { sanitizeSyncReply, researchSchemeUrl } from '../research-link.js';
import { researchAutoState, patchResearchAutoState } from '../research-device.js';
import { heldConflicts } from '../research-sync.js';
import {
    canDecideInApp, conflictDecideMode, conflictFactDecidable, conflictSides, decideReply, decideRequestBody,
    postBridgeDecide, CONFLICT_DECIDE_FEATURE, DecideResult,
} from '../research-decide.js';
import { Person, ResearchConflict, StromData } from '../types.js';

const FIXTURE = readFileSync(new URL('../../e2e/fixtures/research-conflict-decide.ged', import.meta.url), 'utf8');

const HEAD = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.14.0
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
1 _STROM_TREE 2c8e4f61-9a3b-4d7e-8f10-6b5a4c3d2e19
0 @S0001@ SOUR
1 TITL Křestní matrika Lipno
1 REFN S0001
0 @P0001@ INDI
1 NAME Eva /Málková/
1 SEX F
1 REFN P0001
2 TYPE strom-research
`;

/** The conflicts of the one person of a file made of HEAD and `body` (her _STROM_CONFLICT lines). */
function conflictsOf(body: string): ResearchConflict[] {
    const data = convertToStrom(parseGedcom(`${HEAD}${body}0 TRLR\n`)).data;
    return Object.values(data.persons)[0].research?.conflicts ?? [];
}

const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

describe('the research file: what makes a conflict decidable by a side', () => {
    it('reads _STROM_TAKE, each value\'s side and the raw sex of the fixture', () => {
        const data = convertToStrom(parseGedcom(FIXTURE)).data;
        const anna = byRefn(data, 'P0001').research!.conflicts!;
        const tomas = byRefn(data, 'P0002').research!.conflicts!;
        expect(anna.map(c => [c.id, c.take])).toEqual([['X0007', true], ['X0009', true]]);
        expect(anna[0].values.map(v => [v.value, v.side, v.raw])).toEqual([['12. 3. 1851', 'research', undefined], ['1852', 'user', undefined]]);
        expect(anna[0].values[0].sourceIds).toHaveLength(1);
        const sex = tomas.find(c => c.id === 'X0008')!;
        expect(sex.take).toBe(true);
        expect(sex.values.map(v => [v.value, v.side, v.raw])).toEqual([['muž', 'research', 'M'], ['žena', 'user', 'F']]);
        // the couple's conflict, the same at both partners
        expect(tomas.find(c => c.id === 'X0009')).toEqual(anna[1]);
        // one of the sources alone: none of it
        const sources = tomas.find(c => c.id === 'X0010')!;
        expect('take' in sources).toBe(false);
        expect(sources.values.every(v => !('side' in v) && !('raw' in v))).toBe(true);
    });

    it('_STROM_TAKE is only Y (any case, spaces around); anything else, or empty, is no take', () => {
        const one = (take: string) => conflictsOf(`1 _STROM_CONFLICT X0001\n2 TYPE BIRT\n2 STAT open\n${take}2 VAL 1850\n2 VAL 1851\n`)[0];
        expect(one('2 _STROM_TAKE Y\n').take).toBe(true);
        expect(one('2 _STROM_TAKE y \n').take).toBe(true);
        for (const bad of ['2 _STROM_TAKE N\n', '2 _STROM_TAKE YES\n', '2 _STROM_TAKE\n', '2 _STROM_TAKE 1\n', '']) {
            expect('take' in one(bad)).toBe(false);
        }
        // a take under a value is no take of the conflict
        expect('take' in one('2 VAL 1849\n3 _STROM_TAKE Y\n')).toBe(false);
    });

    it('_STROM_SIDE is user or research (any case); an unknown word, an empty one, or one under the decision goes', () => {
        const sides = (a: string, b: string) => conflictsOf(`1 _STROM_CONFLICT X0001\n2 TYPE BIRT\n2 STAT open\n2 _STROM_TAKE Y\n2 VAL 1850\n${a}2 VAL 1851\n${b}`)[0].values.map(v => v.side);
        expect(sides('3 _STROM_SIDE research\n', '3 _STROM_SIDE user\n')).toEqual(['research', 'user']);
        expect(sides('3 _STROM_SIDE Research \n', '3 _STROM_SIDE USER\n')).toEqual(['research', 'user']);
        expect(sides('3 _STROM_SIDE agent\n', '3 _STROM_SIDE\n')).toEqual([undefined, undefined]);
        expect(sides('', '3 _STROM_SIDE both\n')).toEqual([undefined, undefined]);
        // a side said at the conflict (level 2), not under a value: none
        expect(sides('', '2 _STROM_SIDE user\n')).toEqual([undefined, undefined]);
        const decided = conflictsOf('1 _STROM_CONFLICT X0001\n2 TYPE BIRT\n2 STAT decided\n2 VAL 1850\n2 VAL 1851\n2 DECI 1851\n3 _STROM_SIDE user\n3 _STROM_RAW M\n')[0];
        expect(decided.decision).toEqual({ value: '1851' });
        // the CONC of a value still glues on after its side
        expect(conflictsOf('1 _STROM_CONFLICT X0001\n2 TYPE NAME\n2 STAT open\n2 VAL Jan\n3 _STROM_SIDE user\n3 CONC a\n2 VAL Jan\n')[0].values[0])
            .toEqual({ value: 'Jana', side: 'user' });
    });

    it('_STROM_RAW: M, F or U under a SEX conflict\'s values only; anything else goes', () => {
        const raws = (fact: string, a: string, b: string) => conflictsOf(`1 _STROM_CONFLICT X0001\n2 TYPE ${fact}\n2 STAT open\n2 VAL muž\n3 _STROM_RAW ${a}\n2 VAL žena\n3 _STROM_RAW ${b}\n`)[0].values.map(v => v.raw);
        expect(raws('SEX', 'M', 'F')).toEqual(['M', 'F']);
        expect(raws('SEX', 'u', ' f ')).toEqual(['U', 'F']);
        expect(raws('SEX', 'X', 'male')).toEqual([undefined, undefined]);
        expect(raws('sex', 'M', 'U')).toEqual(['M', 'U']);
        // under any other fact: not read
        expect(raws('BIRT', 'M', 'F')).toEqual([undefined, undefined]);
        expect(raws('NAME', 'M', 'F')).toEqual([undefined, undefined]);
    });

    it('the standard GEDCOM writes none of it', () => {
        const data = convertToStrom(parseGedcom(FIXTURE)).data;
        expect(exportToGedcom(data, 'Dvořákovi').content).not.toMatch(/_STROM_TAKE|_STROM_SIDE|_STROM_RAW|_STROM_CONFLICT/);
    });
});

describe('the bridge\'s JSON and what the app keeps', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('/sync: the conflicts decidable by a side are those with take: true (nothing else counts)', () => {
        const reply = sanitizeSyncReply({
            ok: true, changes: 3,
            conflicts: [
                { id: 'X0007', person: 'P0001', fact: 'BIRT', take: true },
                { id: 'X0009', person: 'P0002', family: 'F0001', fact: 'MARR', take: true },
                { id: 'X0010', person: 'P0002', fact: 'DEAT' },
                { id: 'X0011', person: 'P0002', fact: 'NAME', take: 'yes' },
                { id: 'X0012', fact: 'SEX', take: 1 },
                { id: 'bad', take: true },
                { conflict: 'X0013', take: true },
            ],
        });
        expect(reply.conflictIds).toEqual(['X0007', 'X0009', 'X0010', 'X0011', 'X0012', 'X0013']);
        expect(reply.conflictTakeIds).toEqual(['X0007', 'X0009', 'X0013']);
        expect(sanitizeSyncReply({ ok: true, conflicts: 2 }).conflictTakeIds).toEqual([]);
        expect(sanitizeSyncReply(null).conflictTakeIds).toEqual([]);
    });

    it('held: the conflicts of a version not loaded keep take and the sides through storage', () => {
        const here = convertToStrom(parseGedcom(FIXTURE.split('\n').filter(l => !/_STROM_(TAKE|SIDE|RAW)/.test(l)).join('\n'))).data;
        const there = convertToStrom(parseGedcom(FIXTURE)).data;
        // the same records: ids by REFN (as stabilizeIds would)
        const ids = new Map(Object.values(here.persons).map(p => [p.refn, p.id]));
        const theirs: StromData = { ...there, persons: Object.fromEntries(Object.values(there.persons).map(p => [ids.get(p.refn)!, { ...p, id: ids.get(p.refn)! }])) };
        const held = heldConflicts(here, theirs, 'base', 'head');
        const anna = ids.get('P0001')!;
        // they differ only by what the new lines say: read as the research's list
        expect(held.persons[anna].map(c => c.take)).toEqual([true, true]);
        patchResearchAutoState('t1', { held });
        const back = researchAutoState('t1').held!;
        expect(back).toEqual(held);
        expect(back.persons[ids.get('P0002')!].find(c => c.id === 'X0008')!.values.map(v => [v.side, v.raw])).toEqual([['research', 'M'], ['user', 'F']]);
        // ... and only what the parser itself would read
        expect(canDecideInApp(back.persons[anna][0], { refn: 'P0001' })).toBe(true);
    });

    it('held: a stored take, side or raw sex that is not what the parser reads goes', () => {
        const conflict = {
            id: 'X0007', fact: 'BIRT', status: 'open', take: 'Y',
            values: [{ value: '1851', side: 'Research', raw: 'M' }, { value: '1852', side: 'user' }],
        };
        const sex = {
            id: 'X0008', fact: 'SEX', status: 'open', take: true,
            values: [{ value: 'muž', side: 'research', raw: 'M' }, { value: 'žena', side: 'user', raw: 'female' }],
        };
        localStorage.setItem('strom-research-auto:t1', JSON.stringify({ held: { base: 'a', head: 'b', persons: { p1: [conflict, sex] }, takeovers: [] } }));
        const [first, second] = researchAutoState('t1').held!.persons.p1;
        expect(first).toEqual({ id: 'X0007', fact: 'BIRT', status: 'open', values: [{ value: '1851' }, { value: '1852', side: 'user' }] });
        expect(second).toEqual({ ...sex, values: [{ value: 'muž', side: 'research', raw: 'M' }, { value: 'žena', side: 'user' }] });
        expect(canDecideInApp(first, { refn: 'P0001' })).toBe(false);
        expect(canDecideInApp(second, { refn: 'P0001' })).toBe(true);
    });
});

describe('canDecideInApp: when the app offers to keep or take a value', () => {
    const base: ResearchConflict = {
        id: 'X0007', fact: 'BIRT', title: 'Rok narození', status: 'open', take: true,
        values: [{ value: '12. 3. 1851', sourceIds: ['s1'], side: 'research' }, { value: '1852', side: 'user' }],
    };
    const person = { refn: 'P0001' };
    const withFact = (fact: string): ResearchConflict => ({ ...base, fact });

    it('an open conflict made by an edit, both sides said, a fact of phase 1, a person of the research: yes', () => {
        expect(canDecideInApp(base, person)).toBe(true);
        // the order of the values is no contract
        expect(canDecideInApp({ ...base, values: [...base.values].reverse() }, person)).toBe(true);
    });

    it('without the research\'s take (a conflict of the sources, fact.detail, fact.part, an agent\'s): no', () => {
        const { take: _take, ...noTake } = base;
        expect(canDecideInApp(noTake, person)).toBe(false);
        expect(canDecideInApp({ ...base, take: false as unknown as true }, person)).toBe(false);
    });

    it('decided already: no', () => {
        expect(canDecideInApp({ ...base, status: 'decided' }, person)).toBe(false);
    });

    it('a side missing, the same side twice, one value, three values: no', () => {
        expect(canDecideInApp({ ...base, values: [{ value: '1851', side: 'research' }, { value: '1852' }] }, person)).toBe(false);
        expect(canDecideInApp({ ...base, values: [{ value: '1851' }, { value: '1852' }] }, person)).toBe(false);
        expect(canDecideInApp({ ...base, values: [{ value: '1851', side: 'user' }, { value: '1852', side: 'user' }] }, person)).toBe(false);
        expect(canDecideInApp({ ...base, values: [{ value: '1851', side: 'research' }] }, person)).toBe(false);
        expect(canDecideInApp({ ...base, values: [...base.values, { value: '1853', side: 'research' }] }, person)).toBe(false);
    });

    it('the facts of phase 1: an event\'s value (a person\'s or a couple\'s), the name, its titles, the sex', () => {
        for (const fact of ['BIRT', 'DEAT', 'CHR', 'BAPM', 'BURI', 'OCCU', 'RESI', 'MARR', 'DIV', 'NAME', 'NPFX', 'NSFX', 'SEX', 'birt', ' MARR ']) {
            expect(canDecideInApp(withFact(fact), person), fact).toBe(true);
        }
    });

    it('never the parents (FAMC), EVEN (also "not known which"), nor anything else', () => {
        for (const fact of ['FAMC', 'FAMS', 'EVEN', 'NOTE', 'SOUR', 'fact.detail', 'fact.part', '']) {
            expect(canDecideInApp(withFact(fact), person), fact).toBe(false);
            expect(conflictFactDecidable(fact)).toBe(false);
        }
    });

    it('a person who is not the research\'s (no number, another kind of number), or none: no', () => {
        expect(canDecideInApp(base, {})).toBe(false);
        expect(canDecideInApp(base, { refn: '' })).toBe(false);
        expect(canDecideInApp(base, { refn: '12345' })).toBe(false);
        expect(canDecideInApp(base, { refn: 'S0001' })).toBe(false);
        expect(canDecideInApp(base, null)).toBe(false);
        expect(canDecideInApp(base, undefined)).toBe(false);
        expect(canDecideInApp(null, person)).toBe(false);
    });

    it('a conflict without the research\'s id: no', () => {
        expect(canDecideInApp({ ...base, id: 'C0010' }, person)).toBe(false);
    });

    it('the fixture: Anna\'s birth, the couple\'s marriage (at both partners) and Tomáš\'s sex yes; the sources\' death no', () => {
        const data = convertToStrom(parseGedcom(FIXTURE)).data;
        const anna = byRefn(data, 'P0001');
        const tomas = byRefn(data, 'P0002');
        expect(anna.research!.conflicts!.map(c => canDecideInApp(c, anna))).toEqual([true, true]);
        expect(tomas.research!.conflicts!.map(c => [c.id, canDecideInApp(c, tomas)])).toEqual([['X0008', true], ['X0009', true], ['X0010', false]]);
    });

    it('the sides of a decidable conflict, by whose they are', () => {
        expect(conflictSides(base)).toEqual({ user: base.values[1], research: base.values[0] });
        expect(conflictSides({ ...base, values: [{ value: '1851' }, { value: '1852', side: 'user' }] })).toBeNull();
    });
});

describe('conflictDecideMode: the bridge, a link, or not on this device', () => {
    it('the bridge answers and says conflict.decide: through it (links or not)', () => {
        expect(conflictDecideMode({ bridge: { features: ['sync.since', CONFLICT_DECIDE_FEATURE] }, linkAvailable: true })).toBe('bridge');
        expect(conflictDecideMode({ bridge: { features: [CONFLICT_DECIDE_FEATURE] }, linkAvailable: false })).toBe('bridge');
    });

    it('a bridge without it (an older research), or none answering, with links: the link', () => {
        expect(conflictDecideMode({ bridge: { features: ['sync.since', 'hypothesis.links'] }, linkAvailable: true })).toBe('link');
        expect(conflictDecideMode({ bridge: { features: null }, linkAvailable: true })).toBe('link');
        expect(conflictDecideMode({ bridge: null, linkAvailable: true })).toBe('link');
    });

    it('neither (a phone, a tablet, a browser away from the research): none', () => {
        expect(conflictDecideMode({ bridge: null, linkAvailable: false })).toBe('none');
        expect(conflictDecideMode({ bridge: undefined, linkAvailable: false })).toBe('none');
        expect(conflictDecideMode({ bridge: { features: ['sync.since'] }, linkAvailable: false })).toBe('none');
    });
});

describe('the link into the research with a side', () => {
    const tree = '2c8e4f61-9a3b-4d7e-8f10-6b5a4c3d2e19';

    it('do=decide&take=user|research; without a side as before', () => {
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', conflictDo: 'decide', take: 'user' }))
            .toBe(`strom-research://conflict?tree=${tree}&id=X0007&do=decide&take=user`);
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', take: 'research' }))
            .toBe(`strom-research://conflict?tree=${tree}&id=X0007&do=decide&take=research`);
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', conflictDo: 'decide' }))
            .toBe(`strom-research://conflict?tree=${tree}&id=X0007&do=decide`);
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', conflictDo: 'agent' }))
            .toBe(`strom-research://conflict?tree=${tree}&id=X0007&do=agent`);
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', conflictDo: 'decide', take: 'user' }, 'strom-research-beta'))
            .toBe(`strom-research-beta://conflict?tree=${tree}&id=X0007&do=decide&take=user`);
    });

    it('a side for the agent, or an unknown side: no link', () => {
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', conflictDo: 'agent', take: 'user' })).toBeNull();
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', take: 'both' as never })).toBeNull();
        expect(researchSchemeUrl('conflict', { tree, conflict: 'X0007', take: 'user&x=1' as never })).toBeNull();
    });
});

describe('postBridgeDecide: the shared request and its answers', () => {
    const BASE = 'http://127.0.0.1:47321/tok123';
    let calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => {
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(body === undefined ? 'not json' : JSON.stringify(body), { status });
        }));
    };
    afterEach(() => vi.unstubAllGlobals());

    it('sends {"do":"decide","take":…} to <token>/conflict/<X…>, a simple request without cookies, with the app\'s version', async () => {
        answer(200, { decided: 'X0007', take: 'user', head: 'a'.repeat(40), written: 'E0102 BIRT 1852', person: 'P0012' });
        const r = await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:47321\/tok123\/conflict\/X0007\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store' });
        expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'decide', take: 'user' });
        expect(r).toEqual({ ok: true, decided: 'X0007', take: 'user', head: 'a'.repeat(40), written: 'E0102 BIRT 1852', person: 'P0012' });
    });

    it('200 of a couple\'s conflict: the family', async () => {
        answer(200, { decided: 'X0009', take: 'research', head: 'b'.repeat(40), written: 'F0003 MARR', family: 'F0003' });
        const r = await postBridgeDecide(BASE, 'conflict', 'X0009', { do: 'decide', take: 'research' });
        expect(r).toEqual({ ok: true, decided: 'X0009', take: 'research', head: 'b'.repeat(40), written: 'F0003 MARR', family: 'F0003' });
    });

    it('200 with both, with nothing but the id, with garbage beside it', async () => {
        answer(200, { decided: 'X0009', take: 'user', head: 'c'.repeat(40), written: '', person: 'P0002', family: 'F0001' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0009', { do: 'decide', take: 'user' }))
            .toMatchObject({ ok: true, person: 'P0002', family: 'F0001' });
        answer(200, {});
        expect(await postBridgeDecide(BASE, 'conflict', 'X0009', { do: 'decide', take: 'user' }))
            .toEqual({ ok: true, decided: 'X0009', head: '', written: '' });
        answer(200, { decided: 'X0009', take: 'both', head: 'not a head', person: 'Jan', family: 'X1' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0009', { do: 'decide', take: 'user' }))
            .toEqual({ ok: true, decided: 'X0009', head: '', written: '' });
    });

    it('200 naming another conflict, or no JSON: unknown, never taken for decided', async () => {
        answer(200, { decided: 'X0010', take: 'user' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0009', { do: 'decide', take: 'user' })).toMatchObject({ ok: false, code: 'unknown', status: 200 });
        answer(200, undefined);
        expect(await postBridgeDecide(BASE, 'conflict', 'X0009', { do: 'decide', take: 'user' })).toMatchObject({ ok: false, code: 'unknown', status: 200 });
    });

    it('404 conflict.none', async () => {
        answer(404, { error: 'žádný rozpor X0007', code: 'conflict.none', text: 'no conflict X0007' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'conflict.none', status: 404, reason: 'no conflict X0007' });
    });

    it('404 without the code (an older bridge without the route): unknown, not "gone"', async () => {
        answer(404, { error: 'not found' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' })).toMatchObject({ ok: false, code: 'unknown', status: 404 });
        answer(404, undefined);
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' })).toMatchObject({ ok: false, code: 'unknown', status: 404 });
    });

    it('409 conflict.decided with the decision made elsewhere', async () => {
        answer(409, { error: 'už rozhodnuto', code: 'conflict.decided', text: 'decided already', resolution: '12. 3. 1851 (S0001)', take: 'research' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'conflict.decided', status: 409, resolution: '12. 3. 1851 (S0001)', take: 'research', reason: 'decided already' });
        // the resolution among the params, no side said
        answer(409, { code: 'conflict.decided', params: { resolution: '1852' } });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'conflict.decided', status: 409, resolution: '1852', reason: '' });
    });

    it('422 conflict.no-edit', async () => {
        answer(422, { code: 'conflict.no-edit', text: 'not made by an edit' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'conflict.no-edit', status: 422, reason: 'not made by an edit' });
        answer(422, { code: 'something.else' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' })).toMatchObject({ code: 'unknown', status: 422 });
    });

    it('409 busy (a send being written), and the research busy (503): busy', async () => {
        answer(409, { code: 'busy', text: 'a send is being written' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'busy', status: 409, reason: 'a send is being written' });
        answer(503, { code: 'research.busy', retry: 30 });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' })).toMatchObject({ ok: false, code: 'busy', status: 503 });
    });

    it('423 locked', async () => {
        answer(423, { code: 'locked', text: 'held by another session' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'research' }))
            .toEqual({ ok: false, code: 'locked', status: 423, reason: 'held by another session' });
    });

    it('any other answer: unknown', async () => {
        answer(500, { error: 'boom' });
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'unknown', status: 500, reason: 'boom' });
    });

    it('no answer (not running, refused, not in time): network, never a throw', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }))
            .toEqual({ ok: false, code: 'network', status: 0, reason: '' });
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })));
        expect(await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' }, { timeoutMs: 20 }))
            .toEqual({ ok: false, code: 'network', status: 0, reason: '' });
    });

    it('a second ask for the same conflict while the first runs: one request, the same answer', async () => {
        let release: (r: Response) => void = () => {};
        const fetchMock = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
        vi.stubGlobal('fetch', fetchMock);
        const first = postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' });
        const second = postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' });
        expect(second).toBe(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        release(new Response(JSON.stringify({ decided: 'X0007', take: 'user' }), { status: 200 }));
        const [a, b] = await Promise.all([first, second]);
        expect(a).toEqual(b);
        // done: a new ask goes again
        answer(409, { code: 'conflict.decided', resolution: '1852' });
        await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user' });
        expect(calls).toHaveLength(1);
    });

    it('a note goes trimmed and cut to 200 characters; an empty one not at all', async () => {
        answer(200, { decided: 'X0007', take: 'user' });
        await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user', note: `  ${'x'.repeat(250)}  ` });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'decide', take: 'user', note: 'x'.repeat(200) });
        answer(200, { decided: 'X0007', take: 'user' });
        await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'user', note: '   ' });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'decide', take: 'user' });
    });

    it('an id or a body the research does not take: nothing sent, invalid', async () => {
        answer(200, {});
        const bad: DecideResult[] = [
            await postBridgeDecide(BASE, 'conflict', 'H0001', { do: 'decide', take: 'user' }),
            await postBridgeDecide(BASE, 'conflict', 'X0007/../sync', { do: 'decide', take: 'user' }),
            await postBridgeDecide(BASE, 'conflict', ' X0007', { do: 'decide', take: 'user' }),
            await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'decide', take: 'both' as never }),
            await postBridgeDecide(BASE, 'conflict', 'X0007', { do: 'reopen' as never, take: 'user' }),
            await postBridgeDecide(BASE, 'hypothesis', 'H0022', { do: 'decide', variant: 'b' }),
        ];
        for (const r of bad) expect(r).toEqual({ ok: false, code: 'invalid', status: 0, reason: '' });
        expect(calls).toHaveLength(0);
    });

    it('a hypothesis (later): {"do":"decide","variant":…} to <token>/hypothesis/<H…>, its own codes', async () => {
        answer(200, { decided: 'H0022', variant: 'B', head: 'd'.repeat(40), written: 'P0010 FAMC F0042' });
        expect(await postBridgeDecide(BASE, 'hypothesis', 'H0022', { do: 'decide', variant: 'B' }))
            .toEqual({ ok: true, decided: 'H0022', variant: 'B', head: 'd'.repeat(40), written: 'P0010 FAMC F0042' });
        expect(calls[0].url).toMatch(/\/tok123\/hypothesis\/H0022\?app=/);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'decide', variant: 'B' });
        answer(409, { code: 'hypothesis.decided', resolution: 'A', variant: 'A' });
        expect(await postBridgeDecide(BASE, 'hypothesis', 'H0022', { do: 'decide', variant: 'B' }))
            .toEqual({ ok: false, code: 'hypothesis.decided', status: 409, resolution: 'A', variant: 'A', reason: '' });
        answer(404, { code: 'hypothesis.none' });
        expect(await postBridgeDecide(BASE, 'hypothesis', 'H0022', { do: 'decide', variant: 'B' })).toMatchObject({ code: 'hypothesis.none' });
        // a conflict's code is no hypothesis's
        answer(404, { code: 'conflict.none' });
        expect(await postBridgeDecide(BASE, 'hypothesis', 'H0022', { do: 'decide', variant: 'B' })).toMatchObject({ code: 'unknown' });
    });
});

describe('decideReply / decideRequestBody directly', () => {
    it('a non-object body is no answer of the research', () => {
        expect(decideReply('conflict', 'X0007', 200, ['X0007'])).toMatchObject({ ok: false, code: 'unknown' });
        expect(decideReply('conflict', 'X0007', 423, null)).toEqual({ ok: false, code: 'locked', status: 423, reason: '' });
    });

    it('the body of a conflict carries no variant, of a hypothesis no side', () => {
        expect(decideRequestBody('conflict', { do: 'decide', take: 'user', variant: 'B' } as never)).toEqual({ do: 'decide', take: 'user' });
        expect(decideRequestBody('hypothesis', { do: 'decide', variant: 'B', take: 'user' } as never)).toEqual({ do: 'decide', variant: 'B' });
    });
});
