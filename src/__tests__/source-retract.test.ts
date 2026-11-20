/**
 * Deleting a source of a followed tree in its research (spec 117 U4 §0, §8):
 * the research's list of impacts read defensively, what the dialog shows of
 * it (the bare facts not counted again among the less certain ones, conflicts
 * staying unchanged left out, rows limited), the bridge's calls and their
 * refusals, where deleting is offered, the dialog's state, the memory of
 * sources deleted in edit mode, and the marks of review of a conflict read
 * from the research's file. Invented data.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    parseSourceImpacts, retractSummary, retractSourceDry, retractSource, restoreSource, keepConflict,
    retractErrorOf, retractErrorAction, sourceRetractOfferedIn, sourceRetractOffered, setSourceRetractLookup,
    sourceRetractTaken, materialTreesTaken, retractStart, retractListed, retractChanged, retractExpired, retractSending,
    retractNotSent, retractFailed, retractCanGo, deletedSourcesOf, withDeletedSource, withoutDeletedSources,
    rememberDeletedSource, forgetDeletedSources, SOURCE_RETRACT_FEATURE, MATERIAL_TREES_FEATURE,
    type SourceImpact, type SourceRetractEnv,
} from '../source-retract.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { CONFLICT_REVIEW_SOURCE_RETRACTED, type Partnership, type PartnershipId, type Person, type PersonId, type StromData, type TreeId, type TreeMetadata } from '../types.js';

const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';

function fakeFetch(answers: [number, unknown, Record<string, string>?][]) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
        const next = answers.shift();
        if (!next) throw new TypeError('connection refused');
        const [status, body, headers] = next;
        return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: headers ?? {} });
    };
    return { impl, calls };
}

function impact(over: Partial<SourceImpact> = {}): SourceImpact {
    return {
        id: 'S0042', title: 'Pracovní rodokmen Talvanen (export)',
        counts: { names: 0, events: 0, families: 0, stories: 0 },
        cites: [], stories: [], bare: [], lowered: [], conflicts: [], tasks: [], files: [], images: 0,
        more: { cites: 0, stories: 0, bare: 0, lowered: 0, conflicts: 0, tasks: 0, files: 0 },
        ...over,
    };
}

function person(id: string, firstName: string, lastName: string, refn?: string): Person {
    return { id: id as PersonId, firstName, lastName, gender: 'male', partnerships: [], parentIds: [], ...(refn ? { refn } : {}) } as unknown as Person;
}

function tree(): Pick<StromData, 'persons' | 'partnerships'> {
    const oskar = person('p1', 'Oskar', 'Talvanen', 'P0012');
    const ilse = person('p2', 'Ilse', 'Mörkholm', 'P0013');
    oskar.research = { conflicts: [{ id: 'X0005', fact: 'BIRT', status: 'open', values: [{ value: '1851' }] }] };
    const couple = { id: 'u1' as PartnershipId, person1Id: oskar.id, person2Id: ilse.id, childIds: [], status: 'married', researchId: 'F0004' } as unknown as Partnership;
    return { persons: { [oskar.id]: oskar, [ilse.id]: ilse } as Record<PersonId, Person>, partnerships: { [couple.id]: couple } as Record<PartnershipId, Partnership> };
}

afterEach(() => {
    vi.restoreAllMocks();
    setSourceRetractLookup(() => null);
});

describe('parseSourceImpacts', () => {
    it('reads the research\'s impacts as U3 sends them, leaving out what it does not understand', () => {
        const [i, ...rest] = parseSourceImpacts([
            {
                id: 'S0042', title: 'Pracovní rodokmen Talvanen (export)', input: 'I0007',
                counts: { persons: 3, names: 2, events: 25, families: 5, stories: 16 },
                cites: [
                    { owner: 'P0012', fact: 'birt', event: 'E0311', others: 0, locator: 'fol. 7', main: true },
                    { owner: 'P0012', name: 'N1', others: 1 },
                    { owner: 'Q1', fact: 'BIRT', others: 0 },
                    { owner: 'F0004', fact: 'MARR', event: 'bad', others: -2 },
                ],
                stories: [{ owner: 'P0012', inText: true }, { owner: 'F0004' }, { owner: 'nope' }],
                bare: [{ owner: 'P0012', fact: 'BIRT', event: 'E0311' }, { fact: 'DEAT' }],
                lowered: [{ owner: 'P0012', fact: 'DEAT', from: 'proven', to: 'probable' }, { owner: 'P0012', fact: 'BURI', from: 'proven' }],
                conflicts: [
                    { id: 'X0005', status: 'open', becomes: 'review' },
                    { id: 'X0004', status: 'resolved', becomes: 'unchanged' },
                    { id: 'X0004', status: 'open', becomes: 'review' },
                    { id: 'Y1', status: 'open', becomes: 'review' },
                ],
                tasks: [
                    { id: 'T0120', state: 'doing', becomes: 'dropped', heldBy: 'agent\u0007 1' },
                    { id: 'T0121', status: 'open', becomes: 'narrowed' },
                    { id: 'T0122', state: 'open', becomes: 'kept' },
                ],
                files: ['I0007', 'I0007', 'M0001'],
                images: 3,
                more: { cites: 2, bare: 'x', lowered: 1 },
            },
            { id: 'S0042', title: 'twice' },
            { id: 'bad' },
            null,
        ]);
        expect(rest).toEqual([]);
        expect(i.id).toBe('S0042');
        expect(i.input).toBe('I0007');
        // persons is never read (J8: always 0 in the research).
        expect(i.counts).toEqual({ names: 2, events: 25, families: 5, stories: 16 });
        expect(i.cites).toEqual([
            { owner: 'P0012', fact: 'BIRT', event: 'E0311', others: 0, locator: 'fol. 7', main: true },
            { owner: 'P0012', fact: 'NAME', others: 1 },
            { owner: 'F0004', fact: 'MARR', others: 0 },
        ]);
        expect(i.stories).toEqual([{ owner: 'P0012', inText: true }, { owner: 'F0004', inText: false }]);
        expect(i.bare).toEqual([{ owner: 'P0012', fact: 'BIRT', event: 'E0311' }]);
        expect(i.lowered).toEqual([{ owner: 'P0012', fact: 'DEAT', from: 'proven', to: 'probable' }]);
        expect(i.conflicts).toEqual([
            { id: 'X0005', status: 'open', becomes: 'review' },
            { id: 'X0004', status: 'decided', becomes: 'unchanged' },
        ]);
        expect(i.tasks).toEqual([
            { id: 'T0120', state: 'doing', becomes: 'dropped', heldBy: 'agent 1' },
            { id: 'T0121', state: 'open', becomes: 'narrowed' },
        ]);
        expect(i.files).toEqual(['I0007']);
        expect(i.images).toBe(3);
        expect(i.more).toEqual({ cites: 2, stories: 0, bare: 0, lowered: 1, conflicts: 0, tasks: 0, files: 0 });
    });

    it('anything but a list is no list; a source without a title is named by its id', () => {
        expect(parseSourceImpacts(null)).toEqual([]);
        expect(parseSourceImpacts({ id: 'S1' })).toEqual([]);
        expect(parseSourceImpacts([{ id: 'S7' }])[0]).toEqual(impact({ id: 'S7', title: 'S7' }));
    });

    it('lists stop at 200 items (the rest is the research\'s count in more)', () => {
        const cites = Array.from({ length: 250 }, (_, n) => ({ owner: `P${n + 1}`, fact: 'BIRT', others: 0 }));
        expect(parseSourceImpacts([{ id: 'S1', cites }])[0].cites).toHaveLength(200);
    });
});

describe('what the dialog shows (retractSummary)', () => {
    it('counts as the research says them, kinds with none left out, names from the tree', () => {
        const s = retractSummary(impact({
            counts: { names: 2, events: 25, families: 5, stories: 16 },
            cites: [
                { owner: 'P0013', fact: 'NAME', others: 1 },
                { owner: 'F0004', fact: 'MARR', event: 'E0402', others: 3 },
                { owner: 'P0012', fact: 'DEAT', others: 0 },
                { owner: 'P0099', fact: 'BIRT', others: 2 },
                { owner: 'P0012', fact: 'BIRT', event: 'E0311', others: 0, main: true, locator: 'fol. 7' },
            ],
            stories: [{ owner: 'P0012', inText: false }, { owner: 'P0013', inText: true }],
        }), tree());
        expect(s.citations).toBe(32);
        expect(s.stories).toBe(16);
        expect(s.parts).toEqual([{ kind: 'names', n: 2 }, { kind: 'events', n: 25 }, { kind: 'families', n: 5 }, { kind: 'stories', n: 16 }]);
        expect(s.noCites).toBe(false);
        // Four rows: the main citation first, then those left without a source, then the research's order.
        expect(s.cites.map(c => `${c.owner.ref}:${c.fact}`)).toEqual(['P0012:BIRT', 'P0012:DEAT', 'P0013:NAME', 'F0004:MARR']);
        expect(s.cites[0]).toMatchObject({ main: true, locator: 'fol. 7', hasOther: false, event: 'E0311' });
        expect(s.cites[0].owner).toEqual({ ref: 'P0012', name: 'Oskar Talvanen', personId: 'p1' });
        expect(s.cites[2]).toMatchObject({ hasOther: true });
        expect(s.cites[3].owner).toEqual({ ref: 'F0004', name: 'Oskar Talvanen & Ilse Mörkholm', partnershipId: 'u1' });
        // The rest from the counts, not from the list's length.
        expect(s.citesMore).toBe(28);
        expect(s.storyInText).toBe(true);
    });

    it('a person missing from the tree is shown by its research id', () => {
        const s = retractSummary(impact({ counts: { names: 0, events: 1, families: 0, stories: 0 }, cites: [{ owner: 'P0099', fact: 'BIRT', others: 0 }] }), tree());
        expect(s.cites[0].owner).toEqual({ ref: 'P0099', name: 'P0099' });
        expect(s.parts).toEqual([{ kind: 'events', n: 1 }]);
    });

    it('bare facts are not counted again among the less certain ones (owner + fact + event)', () => {
        const s = retractSummary(impact({
            bare: [
                { owner: 'P0012', fact: 'BIRT', event: 'E0311' },
                { owner: 'P0012', fact: 'NAME' },
                { owner: 'P0013', fact: 'DEAT' },
                { owner: 'P0013', fact: 'BURI' },
            ],
            lowered: [
                { owner: 'P0012', fact: 'BIRT', event: 'E0311', from: 'proven', to: 'lead' },
                { owner: 'P0012', fact: 'BIRT', event: 'E0399', from: 'proven', to: 'probable' },
                { owner: 'P0012', fact: 'NAME', from: 'probable', to: 'lead' },
                { owner: 'P0013', fact: 'MARR', from: 'proven', to: 'probable' },
            ],
            more: { cites: 0, stories: 0, bare: 5, lowered: 0, conflicts: 0, tasks: 0, files: 0 },
        }), tree());
        expect(s.bare).toBe(9);
        expect(s.bareRows.map(r => `${r.owner.ref}:${r.fact}`)).toEqual(['P0012:BIRT', 'P0012:NAME', 'P0013:DEAT']);
        expect(s.bareMore).toBe(6);
        expect(s.lowered).toBe(2);
        expect(s.loweredRows).toEqual([
            { owner: { ref: 'P0012', name: 'Oskar Talvanen', personId: 'p1' }, fact: 'BIRT', event: 'E0399', from: 'proven', to: 'probable' },
            { owner: { ref: 'P0013', name: 'Ilse Mörkholm', personId: 'p2' }, fact: 'MARR', from: 'proven', to: 'probable' },
        ]);
        expect(s.loweredMore).toBe(0);
    });

    it('less certain: three rows, the rest counted', () => {
        const lowered = Array.from({ length: 5 }, (_, n) => ({ owner: `P00${20 + n}`, fact: 'BIRT', from: 'proven', to: 'probable' }));
        const s = retractSummary(impact({ lowered, more: { cites: 0, stories: 0, bare: 0, lowered: 2, conflicts: 0, tasks: 0, files: 0 } }), tree());
        expect(s.lowered).toBe(7);
        expect(s.loweredRows).toHaveLength(3);
        expect(s.loweredMore).toBe(4);
    });

    it('conflicts staying unchanged are left out; those marked come with the tree\'s conflict; tasks and files all', () => {
        const s = retractSummary(impact({
            conflicts: [
                { id: 'X0005', status: 'open', becomes: 'review' },
                { id: 'X0004', status: 'decided', becomes: 'unchanged' },
                { id: 'X0006', status: 'decided', becomes: 'review' },
            ],
            tasks: [{ id: 'T0120', state: 'doing', becomes: 'dropped', heldBy: 'agent' }, { id: 'T0121', state: 'open', becomes: 'narrowed' }],
            files: ['I0007'], images: 3, input: 'I0007',
        }), tree());
        expect(s.conflicts.map(c => [c.id, c.status, c.conflict?.fact ?? null])).toEqual([['X0005', 'open', 'BIRT'], ['X0006', 'decided', null]]);
        expect(s.tasks).toHaveLength(2);
        expect(s.files).toEqual(['I0007']);
        expect(s.images).toBe(3);
        expect(s.input).toBe('I0007');
    });

    it('a source nothing cites', () => {
        const s = retractSummary(impact({ files: ['I0003'] }), tree());
        expect(s.noCites).toBe(true);
        expect(s.parts).toEqual([]);
        expect(s.cites).toEqual([]);
        expect(s.bare).toBe(0);
        expect(s.lowered).toBe(0);
    });
});

describe('the bridge', () => {
    it('the preview: a dry run with the source, the list and the confirmation', async () => {
        const f = fakeFetch([[200, { sources: ['S0042'], dryRun: true, impacts: [{ id: 'S0042', title: 'Matrika Ostrovid' }], confirm: 'signed-1' }]]);
        const res = await retractSourceDry(BASE, ['S0042'], { fetchImpl: f.impl });
        expect(f.calls[0].url).toMatch(/\/source\/retract(\?|$)/);
        expect(f.calls[0].body).toEqual({ sources: ['S0042'], dryRun: true });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.value.confirm).toBe('signed-1');
        expect(res.value.impacts.map(i => i.title)).toEqual(['Matrika Ostrovid']);
    });

    it('a preview without a confirmation, or a source that is not the research\'s id, is nothing to delete by', async () => {
        const f = fakeFetch([[200, { sources: ['S0042'], dryRun: true, impacts: [] }]]);
        expect((await retractSourceDry(BASE, ['S0042'], { fetchImpl: f.impl })).ok).toBe(false);
        const g = fakeFetch([]);
        expect((await retractSourceDry(BASE, ['src_17'], { fetchImpl: g.impl })).ok).toBe(false);
        expect(g.calls).toHaveLength(0);
    });

    it('the deletion: the confirmation sent, what was retracted and the heads', async () => {
        const f = fakeFetch([[200, { sources: ['S0042'], retracted: ['S0042'], impacts: [], head: 'c0ffee000002', parent: 'c0ffee000001' }]]);
        const res = await retractSource(BASE, ['S0042'], 'signed-1', { fetchImpl: f.impl });
        expect(f.calls[0].body).toEqual({ sources: ['S0042'], confirm: 'signed-1' });
        expect(res).toEqual({ ok: true, value: { sources: ['S0042'], retracted: ['S0042'], impacts: [], head: 'c0ffee000002', parent: 'c0ffee000001' } });
    });

    it('409 source.retract-changed: the new list at once, never tried again quietly', async () => {
        const f = fakeFetch([
            [409, { error: 'changed', code: 'source.retract-changed', impacts: [{ id: 'S0042', title: 'Matrika', counts: { events: 3 } }] }],
            [200, { retracted: ['S0042'] }],
        ]);
        const waits: number[] = [];
        const res = await retractSource(BASE, ['S0042'], 'signed-1', { fetchImpl: f.impl, sleep: async ms => { waits.push(ms); } });
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.kind).toBe('changed');
        expect(res.changed?.[0].counts.events).toBe(3);
        expect(f.calls).toHaveLength(1);
        expect(waits).toEqual([]);
        expect(retractErrorAction(res.error)).toBe('preview');
    });

    it('source.busy is waited out (its Retry-After, else 2 s); a confirmation that ran out is expired', async () => {
        const f = fakeFetch([
            [409, { error: 'busy', code: 'source.busy' }, { 'retry-after': '1' }],
            [409, { error: 'busy', code: 'source.busy' }],
            [400, { error: 'confirm: none that holds', code: 'source.body' }],
        ]);
        const waits: number[] = [];
        const res = await retractSource(BASE, ['S0042'], 'old', { fetchImpl: f.impl, sleep: async ms => { waits.push(ms); } });
        expect(waits).toEqual([1000, 2000]);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error).toMatchObject({ kind: 'expired', status: 400, code: 'source.body' });
        expect(retractErrorAction(res.error)).toBe('preview');
    });

    it('busy three times over: busy, sent again by the person', async () => {
        const busy: [number, unknown] = [409, { code: 'source.busy' }];
        const f = fakeFetch([busy, busy, busy, busy]);
        const res = await retractSource(BASE, ['S0042'], 'c', { fetchImpl: f.impl, sleep: async () => {} });
        expect(f.calls).toHaveLength(4);
        expect(!res.ok && res.error.kind).toBe('busy');
        expect(!res.ok && retractErrorAction(res.error)).toBe('retry');
    });

    it('no answer: down, to be tried again', async () => {
        const res = await retractSourceDry(BASE, ['S0042'], { fetchImpl: fakeFetch([]).impl });
        expect(!res.ok && res.error).toEqual({ kind: 'down', status: 0 });
    });

    it('Undo: the source put back, the citations that could not be', async () => {
        const f = fakeFetch([[200, {
            restored: ['S0042'], citations: 30,
            skipped: [{ source: 'S0042', owner: 'P0012', fact: 'BIRT', event: 'E0311', why: 'gone' }, { owner: 'P0013', fact: 'NAME', why: 'odd' }, { why: 'gone' }],
            raised: 2, tasks: ['T0120'], conflicts: ['X0005'], head: 'c0ffee000003', parent: 'c0ffee000002',
        }]]);
        const res = await restoreSource(BASE, ['S0042'], { fetchImpl: f.impl });
        expect(f.calls[0].url).toMatch(/\/source\/restore(\?|$)/);
        expect(f.calls[0].body).toEqual({ sources: ['S0042'] });
        expect(res).toEqual({ ok: true, value: {
            restored: ['S0042'], citations: 30,
            skipped: [{ source: 'S0042', owner: 'P0012', fact: 'BIRT', event: 'E0311', why: 'gone' }, { owner: 'P0013', fact: 'NAME', why: 'other' }],
            head: 'c0ffee000003', parent: 'c0ffee000002',
        } });
    });

    it('Undo refused: not restorable (merged), not retracted', async () => {
        const f = fakeFetch([
            [409, { error: 'merged', code: 'source.notRestorable', params: { id: 'S0042', why: 'merged' } }],
            [409, { error: 'not retracted', code: 'source.notRetracted', params: { id: 'S0042' } }],
        ]);
        const a = await restoreSource(BASE, ['S0042'], { fetchImpl: f.impl, sleep: async () => {} });
        expect(!a.ok && a.error).toEqual({ kind: 'notRestorable', status: 409, code: 'source.notRestorable', id: 'S0042', why: 'merged' });
        const b = await restoreSource(BASE, ['S0042'], { fetchImpl: f.impl, sleep: async () => {} });
        expect(!b.ok && b.error.kind).toBe('notRetracted');
        expect(f.calls).toHaveLength(2);
    });

    it('"Decision stands": the conflict sent, the heads back', async () => {
        const f = fakeFetch([[200, { conflict: 'X0006', head: 'c0ffee000004', parent: 'c0ffee000003' }]]);
        const res = await keepConflict(BASE, 'X0006', { fetchImpl: f.impl });
        expect(f.calls[0].url).toMatch(/\/conflict\/keep(\?|$)/);
        expect(f.calls[0].body).toEqual({ conflict: 'X0006' });
        expect(res).toEqual({ ok: true, value: { conflict: 'X0006', head: 'c0ffee000004', parent: 'c0ffee000003' } });
        expect((await keepConflict(BASE, 'P0012', { fetchImpl: f.impl })).ok).toBe(false);
    });

    it('every refusal of the research as the app\'s kind', () => {
        const kinds: [number, string, string][] = [
            [400, 'source.body', 'body'],
            [404, 'source.unknown', 'gone'],
            [409, 'source.retracted', 'already'],
            [409, 'source.notRetracted', 'notRetracted'],
            [409, 'source.notRestorable', 'notRestorable'],
            [409, 'source.retract-changed', 'changed'],
            [409, 'source.busy', 'busy'],
            [403, 'source.readonly', 'readonly'],
            [500, 'source.failed', 'failed'],
            [404, 'conflict.unknown', 'conflictGone'],
            [409, 'conflict.notMarked', 'notMarked'],
            [500, 'material.failed', 'unknown'],
            [409, 'something.new', 'unknown'],
        ];
        for (const [status, code, kind] of kinds) expect(retractErrorOf(status, { error: 'x', code }).kind, code).toBe(kind);
        // No code: a bridge without the route (404), refused (403), busy (503); anything else unknown.
        expect(retractErrorOf(404, null).kind).toBe('missing');
        expect(retractErrorOf(403, {}).kind).toBe('readonly');
        expect(retractErrorOf(503, {}).kind).toBe('busy');
        expect(retractErrorOf(500, 'oops').kind).toBe('unknown');
        // Sealed on another computer: held, with the research's sentence.
        expect(retractErrorOf(409, { error: 'Sealed on another computer.', code: 'seal.foreign' })).toMatchObject({ kind: 'held', held: { kind: 'seal', said: 'Sealed on another computer.' } });
        expect(retractErrorOf(404, { code: 'source.unknown', params: { id: 'S0042' } }).id).toBe('S0042');
        expect(retractErrorOf(409, { code: 'source.notRestorable', params: { id: 'S0042', why: 'whatever' } }).why).toBe('other');
        expect(retractErrorOf(409, { code: 'source.busy' }, '3').retry).toBe(3);
    });

    it('what each error asks of the dialog', () => {
        const act = (kind: string) => retractErrorAction({ kind: kind as never, status: 0 });
        expect(['gone', 'already', 'notRetracted', 'conflictGone', 'notMarked'].map(act)).toEqual(Array(5).fill('reload'));
        expect(['busy', 'failed', 'down'].map(act)).toEqual(Array(3).fill('retry'));
        expect(['readonly', 'notRestorable', 'held', 'missing', 'unknown', 'body', 'aborted'].map(act)).toEqual(Array(7).fill(null));
    });
});

describe('where deleting a source is offered', () => {
    const env = (over: Partial<SourceRetractEnv> = {}): SourceRetractEnv => ({
        following: true, appReadOnly: false, readOnly: false, bridgeUp: true, features: [SOURCE_RETRACT_FEATURE], ...over,
    });

    it('on with the gate and the bridge; at rest without the bridge; not offered otherwise', () => {
        expect(sourceRetractOfferedIn(env())).toBe('on');
        expect(sourceRetractOfferedIn(env({ bridgeUp: false }))).toBe('off');
        expect(sourceRetractOfferedIn(env({ following: false }))).toBeNull();
        expect(sourceRetractOfferedIn(env({ features: ['material.delete'] }))).toBeNull();
        expect(sourceRetractOfferedIn(env({ features: null }))).toBeNull();
        expect(sourceRetractOfferedIn(env({ readOnly: true }))).toBeNull();
        expect(sourceRetractOfferedIn(env({ appReadOnly: true }))).toBeNull();
    });

    it('the gates read from the features', () => {
        expect(sourceRetractTaken([SOURCE_RETRACT_FEATURE])).toBe(true);
        expect(sourceRetractTaken(undefined)).toBe(false);
        expect(materialTreesTaken([SOURCE_RETRACT_FEATURE, 'material.delete', MATERIAL_TREES_FEATURE])).toBe(true);
        expect(materialTreesTaken([SOURCE_RETRACT_FEATURE, 'material.delete'])).toBe(false);
    });

    it('for the open tree: its research\'s bridge, the tree followed, the app not read-only', () => {
        const meta = { id: 't1', research: { id: 'abc-1', fingerprint: '', syncedAt: '' } } as unknown as TreeMetadata;
        vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue(meta);
        const following = vi.spyOn(DataManager, 'isLiveFollowing').mockReturnValue(true);
        vi.spyOn(DataManager, 'isReadOnly').mockReturnValue(false);
        const asked: string[] = [];
        let up = true;
        setSourceRetractLookup(id => { asked.push(id); return { features: [SOURCE_RETRACT_FEATURE], bridgeUp: up, readOnly: false }; });
        expect(sourceRetractOffered()).toBe('on');
        expect(asked).toEqual(['abc-1']);
        up = false;
        expect(sourceRetractOffered()).toBe('off');
        following.mockReturnValue(false);
        expect(sourceRetractOffered()).toBeNull();
        following.mockReturnValue(true);
        // A copy of the research, or a research whose bridge is not known: not offered.
        vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue({ ...meta, research: { ...meta.research!, copy: true } });
        expect(sourceRetractOffered()).toBeNull();
        vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue(meta);
        setSourceRetractLookup(() => null);
        expect(sourceRetractOffered()).toBeNull();
    });
});

describe('the dialog\'s state', () => {
    const list = [impact()];

    it('the button only with the list\'s confirmation; a changed list or one run out asks again', () => {
        let s = retractStart();
        expect(s).toEqual({ phase: 'loading', impacts: [], confirm: null, note: null });
        expect(retractCanGo(s)).toBe(false);
        s = retractListed(s, list, 'signed-1');
        expect(retractCanGo(s)).toBe(true);
        s = retractSending(s);
        expect(retractCanGo(s)).toBe(false);
        s = retractNotSent(s);
        expect(retractCanGo(s)).toBe(true);
        const changed = retractChanged(s, [impact({ title: 'new' })]);
        expect(changed).toMatchObject({ phase: 'ready', confirm: null, note: 'changed' });
        expect(changed.impacts[0].title).toBe('new');
        expect(retractCanGo(changed)).toBe(false);
        // No new list said: the one shown stays until the new preview answers.
        expect(retractChanged(s).impacts).toBe(list);
        const expired = retractExpired(s);
        expect(expired).toMatchObject({ phase: 'ready', confirm: null, note: 'expired', impacts: list });
        const again = retractListed(expired, list, 'signed-2');
        expect(again.note).toBe('expired');
        expect(retractCanGo(again)).toBe(true);
        expect(retractCanGo(retractFailed(again))).toBe(false);
        expect(retractCanGo(retractListed(retractStart(), [], 'signed-3'))).toBe(false);
    });
});

describe('sources deleted in edit mode (ResearchLink.deletedSources)', () => {
    it('kept once, only research ids, taken out when retracted', () => {
        expect(deletedSourcesOf(undefined)).toEqual([]);
        expect(deletedSourcesOf({ deletedSources: ['S0042', 'x', 'S0042', 'S0007'] })).toEqual(['S0042', 'S0007']);
        expect(withDeletedSource(['S0042'], 'S0007')).toEqual(['S0042', 'S0007']);
        expect(withDeletedSource(['S0042'], 'S0042')).toEqual(['S0042']);
        expect(withDeletedSource(['S0042'], 'src_1')).toEqual(['S0042']);
        expect(withoutDeletedSources(['S0042', 'S0007'], ['S0042', 'S0099'])).toEqual(['S0007']);
    });

    it('remembered on the tree\'s link and forgotten (the last one: the field goes)', () => {
        let research: Record<string, unknown> | undefined = { id: 'abc-1', fingerprint: '', syncedAt: '' };
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => ({ id: 't1', research } as unknown as TreeMetadata));
        const patch = vi.spyOn(TreeManager, 'patchResearchLink').mockImplementation((_t, p) => {
            research = { ...research, ...p };
            for (const [k, v] of Object.entries(p)) if (v === undefined) delete research[k];
        });
        const t = 't1' as TreeId;
        rememberDeletedSource(t, 'S0042');
        rememberDeletedSource(t, 'S0042');
        rememberDeletedSource(t, 'bad');
        rememberDeletedSource(t, 'S0007');
        expect(research.deletedSources).toEqual(['S0042', 'S0007']);
        expect(patch).toHaveBeenCalledTimes(2);
        forgetDeletedSources(t, ['S0042']);
        expect(research.deletedSources).toEqual(['S0007']);
        forgetDeletedSources(t, ['S0007']);
        expect('deletedSources' in research).toBe(false);
        forgetDeletedSources(t, ['S0007']);
        expect(patch).toHaveBeenCalledTimes(4);
        research = undefined;
        rememberDeletedSource(t, 'S0042');
        expect(patch).toHaveBeenCalledTimes(4);
    });

    it('kept across a load of the same research (until it says it retracted them)', () => {
        const tm = TreeManager as unknown as { index: { trees: TreeMetadata[] }; saveIndex: () => void };
        const saved = tm.index;
        vi.spyOn(tm, 'saveIndex').mockImplementation(() => {});
        try {
            tm.index = { ...saved, trees: [{ id: 't1', research: { id: 'abc-1', fingerprint: 'a', syncedAt: '', deletedSources: ['S0042'] } } as unknown as TreeMetadata] };
            TreeManager.setResearchLink('t1' as TreeId, { id: 'abc-1', fingerprint: 'b', syncedAt: '' });
            expect(tm.index.trees[0].research?.deletedSources).toEqual(['S0042']);
            // Another research: nothing of the old one.
            TreeManager.setResearchLink('t1' as TreeId, { id: 'abc-2', fingerprint: 'c', syncedAt: '' });
            expect(tm.index.trees[0].research?.deletedSources).toBeUndefined();
        } finally {
            tm.index = saved;
        }
    });
});

describe('a conflict\'s marks of review in the research\'s file (spec 117 §8)', () => {
    const GED = `0 HEAD
1 CHAR UTF-8
1 SOUR STROM_RESEARCH
1 _STROM_TREE 0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10
0 @S107@ SOUR
1 TITL Sčítání lidu Ostrovid 1921
1 REFN S0107
0 @I1@ INDI
1 NAME Oskar /Talvanen/
1 SEX M
1 REFN P0012
1 BIRT
2 DATE 1851
1 _STROM_CONFLICT X0005
2 TYPE BIRT
2 STAT open
2 _STROM_REVIEW source.retracted
2 VAL 3 MAR 1851, Talvany
3 _STROM_RETRACTED S0042
2 VAL 1852
3 SOUR @S107@
3 _STROM_RETRACTED S0043
3 _STROM_RETRACTED not-an-id
1 _STROM_CONFLICT X0006
2 TYPE DEAT
2 STAT decided
2 _STROM_REVIEW source.somethingNew
2 VAL 1920
3 SOUR @S107@
2 VAL 1921
3 _STROM_RETRACTED S0042
2 DECI 1921 (S0042)
3 _STROM_RETRACTED S0042
3 _STROM_RETRACTED S0042
1 _STROM_CONFLICT X0007
2 TYPE BURI
2 STAT open
2 _STROM_REVIEW two words
2 VAL 1921
0 TRLR
`;

    it('reads _STROM_REVIEW on the conflict and _STROM_RETRACTED under a value and the decision', () => {
        const data = convertToStrom(parseGedcom(GED)).data;
        const oskar = Object.values(data.persons).find(p => p.refn === 'P0012')!;
        const [x5, x6, x7] = oskar.research!.conflicts!;
        expect(x5.review).toBe(CONFLICT_REVIEW_SOURCE_RETRACTED);
        expect(x5.status).toBe('open');
        expect(x5.values[0]).toEqual({ value: '3 MAR 1851, Talvany', retracted: ['S0042'] });
        expect(x5.values[1].retracted).toEqual(['S0043']);
        expect(x5.values[1].sourceIds).toHaveLength(1);
        // A word the app does not know is kept (read as a plain "to review").
        expect(x6.review).toBe('source.somethingNew');
        expect(x6.status).toBe('decided');
        expect(x6.values[0].retracted).toBeUndefined();
        expect(x6.values[1].retracted).toEqual(['S0042']);
        expect(x6.decision).toEqual({ value: '1921 (S0042)', retracted: ['S0042'] });
        // Not one word: nothing said.
        expect(x7.review).toBeUndefined();
    });

    it('a file without the marks reads as before', () => {
        const plain = GED.replace(/^\d _STROM_(REVIEW|RETRACTED).*\n/gm, '');
        const data = convertToStrom(parseGedcom(plain)).data;
        const oskar = Object.values(data.persons).find(p => p.refn === 'P0012')!;
        for (const c of oskar.research!.conflicts!) {
            expect(c.review).toBeUndefined();
            for (const v of [...c.values, ...(c.decision ? [c.decision] : [])]) expect(v.retracted).toBeUndefined();
        }
    });
});
