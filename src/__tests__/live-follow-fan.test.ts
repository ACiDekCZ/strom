/**
 * Following the research agent in the fan: the people worked on per session,
 * the signal only on a change, the fan's centre rule, the trail memory, the
 * anchor of a person outside the fan, and the follow settings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildFanModel } from '../fan-chart.js';
import { findFanAnchor } from '../fan-follow-anchor.js';
import {
    followTargets, sessionNumbers, changedTargets, fanCenter, pushTrail, trailOpacity, sessionTone, TrailEntry,
} from '../live-follow-targets.js';
import {
    getFollowView, setFollowView, getFanCenterSetting, setFanCenterSetting, getFanPerson, setFanPerson,
    fanPersonOtherTree, getFollowTrail, setFollowTrail, hasFollowPrefs, resetFollowPrefs, restoreFollowPrefs,
} from '../live-follow-prefs.js';
import { StromData, Person, PersonId, Gender, Partnership, PartnershipId } from '../types.js';

const P = (s: string) => s as PersonId;

describe('followTargets', () => {
    const tree: Record<string, PersonId> = { P1: P('josef'), P2: P('anna'), P3: P('jan') };
    const personOf = (r: string) => tree[r] ?? null;

    it('one target per running row with a person of the tree, numbered by its place among running rows', () => {
        const t = followTargets([
            { who: 'a', task: 'T1', person: 'P1' },
            { who: 'b', task: 'T2', person: 'P2', paused: { until: '', reason: 'limit' } },
            { who: 'c', task: 'T3' },
            { who: 'd', task: 'T4', person: 'P9' },
            { who: 'e', task: 'T5', person: 'P3' },
        ], personOf);
        expect(t.map(x => [x.row, x.session, x.personId])).toEqual([[0, 1, 'josef'], [4, 4, 'jan']]);
        expect(t[0].task).toBe('T1');
    });

    it('numbers show only with two or more running rows; paused rows have none', () => {
        expect(sessionNumbers([{ who: 'a', task: '' }]).numbered).toBe(false);
        const two = sessionNumbers([{ who: 'a', task: '' }, { who: 'b', task: '', paused: {} }, { who: 'c', task: '' }]);
        expect(two.numbers).toEqual([1, null, 2]);
        expect(two.numbered).toBe(true);
        expect(sessionTone(1)).toBe('primary');
        expect(sessionTone(2)).toBe('accent');
    });

    it('signals only the rows whose person changed', () => {
        const first = changedTargets(new Map(), followTargets([{ who: 'a', task: '', person: 'P1' }, { who: 'b', task: '', person: 'P2' }], personOf));
        expect([...first.changed]).toEqual([0, 1]);
        const same = changedTargets(first.next, followTargets([{ who: 'a', task: '', person: 'P1' }, { who: 'b', task: '', person: 'P3' }], personOf));
        expect([...same.changed]).toEqual([1]);
        const again = changedTargets(same.next, followTargets([{ who: 'a', task: '', person: 'P1' }, { who: 'b', task: '', person: 'P3' }], personOf));
        expect(again.changed.size).toBe(0);
    });
});

describe('fanCenter', () => {
    const base = { pinned: null, setting: 'focus' as const, chosen: null, defaultPerson: P('root'), focusBefore: P('petr'), exists: () => true };

    it('pinned wins, then the chosen person, the default person, the focus before following', () => {
        expect(fanCenter({ ...base, pinned: P('anna') })).toBe('anna');
        expect(fanCenter({ ...base, setting: 'person', chosen: P('eva') })).toBe('eva');
        expect(fanCenter({ ...base, setting: 'root' })).toBe('root');
        expect(fanCenter(base)).toBe('petr');
        expect(fanCenter({ ...base, focusBefore: null })).toBe('root');
    });

    it('a chosen person no longer in the tree falls back to the focus before', () => {
        expect(fanCenter({ ...base, setting: 'person', chosen: P('gone'), exists: id => id !== 'gone' })).toBe('petr');
        expect(fanCenter({ ...base, setting: 'person', chosen: null })).toBe('petr');
    });
});

describe('the session trail', () => {
    const e = (id: string, at: number): TrailEntry => ({ personId: P(id), placeKey: null, session: 1, at });

    it('keeps the 8 newest and none older than 60 min', () => {
        let trail: TrailEntry[] = [];
        for (let i = 0; i < 10; i++) trail = pushTrail(trail, e(`p${i}`, i * 1000), 10_000);
        expect(trail).toHaveLength(8);
        expect(trail[0].personId).toBe('p9');
        const later = pushTrail(trail, e('new', 10_000 + 3_600_000 + 5000), 10_000 + 3_600_000 + 5000);
        expect(later.map(x => x.personId)).toEqual(['new']);
        expect(trailOpacity(0)).toBe(0.85);
        expect(trailOpacity(7)).toBe(0.25);
        expect(trailOpacity(20)).toBe(0.25);
    });
});

// ------------------------------------------------------------ the anchor

function person(id: string, gender: Gender, parentIds: string[] = []): Person {
    return { id: P(id), firstName: id, lastName: 'Vlk', gender, isPlaceholder: false, parentIds: parentIds as PersonId[], childIds: [], partnerships: [] };
}

/**
 * Petr (centre) ← Josef + Anna; Josef ← František + Marie; František ← Karel;
 * Karel ← Kateřina (4 generations above Petr's grandfather line);
 * Antonín: Josef's brother; Eva: Antonín's wife; Jan: Petr's son;
 * Lída: Petr's wife; Ota: Lída's brother (no tie to the fan but by marriage).
 */
function family(): StromData {
    const ps = [
        person('petr', 'male', ['josef', 'anna']), person('josef', 'male', ['frantisek', 'marie']), person('anna', 'female'),
        person('frantisek', 'male', ['karel']), person('marie', 'female'), person('karel', 'male', ['katerina']),
        person('katerina', 'female'), person('antonin', 'male', ['frantisek', 'marie']), person('eva', 'female'),
        person('jan', 'male', ['petr', 'lida']), person('lida', 'female', ['lp']), person('lp', 'male'), person('ota', 'male', ['lp']),
        person('cizi', 'male'),
    ];
    const data: StromData = { persons: Object.fromEntries(ps.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
    for (const p of ps) for (const par of p.parentIds) data.persons[par].childIds.push(p.id);
    const marry = (id: string, a: string, b: string, kids: string[] = []) => {
        const u = { id: id as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: kids as PersonId[], status: 'married' } as Partnership;
        data.partnerships[u.id] = u;
        data.persons[P(a)].partnerships.push(u.id);
        data.persons[P(b)].partnerships.push(u.id);
    };
    marry('u1', 'josef', 'anna', ['petr']);
    marry('u2', 'antonin', 'eva');
    marry('u3', 'petr', 'lida', ['jan']);
    return data;
}

describe('findFanAnchor', () => {
    const data = family();
    const model = (gens: number, shape: 'half' | 'two' = 'half') => buildFanModel(data, P('petr'), { generations: gens, shape, descGenerations: 2 })!;

    it('a person drawn in the fan needs no label', () => {
        expect(findFanAnchor(data, P('josef'), model(3)).kind).toBe('in');
    });

    it('a spouse of someone in the fan: at that person, named as the spouse', () => {
        const a = findFanAnchor(data, P('eva'), model(3));
        // Eva's husband Antonín is not drawn; Eva is no spouse of a drawn person → a sibling? no — her tie is by marriage only.
        expect(a.kind).not.toBe('in');
        const lida = findFanAnchor(data, P('lida'), model(3));
        expect(lida).toMatchObject({ kind: 'spouse', anchorId: 'petr' });
        expect(lida.term?.cs).toBe('manželka');
    });

    it('a sibling of someone in the fan: at that sibling', () => {
        const a = findFanAnchor(data, P('antonin'), model(3));
        expect(a).toMatchObject({ kind: 'sibling', anchorId: 'josef' });
        expect(a.term?.cs).toBe('bratr');
    });

    it('an ancestor beyond the rings: the outermost one of that line, with the generation', () => {
        const a = findFanAnchor(data, P('katerina'), model(2));
        expect(a).toMatchObject({ kind: 'beyond', anchorId: 'frantisek', generation: 4 });
        expect(a.term?.cs).toBe('babička');
    });

    it('a descendant of the centre while descendants are not drawn: at the centre', () => {
        const a = findFanAnchor(data, P('jan'), model(3));
        expect(a).toMatchObject({ kind: 'descendant', anchorId: 'petr' });
        expect(a.term?.cs).toBe('syn');
        // Drawn in the two-way fan.
        expect(findFanAnchor(data, P('jan'), model(3, 'two')).kind).toBe('in');
    });

    it('otherwise the first ancestor in the fan; none when there is no tie', () => {
        // Ota's father is not drawn, nor any ancestor of his: no blood tie upward into the fan.
        expect(findFanAnchor(data, P('ota'), model(3)).kind).toBe('none');
        expect(findFanAnchor(data, P('cizi'), model(3))).toEqual({ kind: 'none', anchorId: null, term: null });
    });
});

// ------------------------------------------------------------ settings

function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

describe('follow settings', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('defaults: the family view, the focused person, the trail on, nothing to reset', () => {
        expect(getFollowView()).toBe('family');
        expect(getFanCenterSetting()).toBe('focus');
        expect(getFollowTrail()).toBe(true);
        expect(hasFollowPrefs()).toBe(false);
    });

    it('stored under their keys; a value not known reads as the default', () => {
        setFollowView('fan');
        setFanCenterSetting('person');
        setFanPerson('t1', P('anna'));
        setFollowTrail(false);
        expect(localStorage.getItem('strom-live-follow-view')).toBe('fan');
        expect(localStorage.getItem('strom-live-follow-fan-center')).toBe('person');
        expect(localStorage.getItem('strom-live-follow-fan-person:t1')).toBe('anna');
        expect(localStorage.getItem('strom-live-follow-trail')).toBe('0');
        expect(getFanPerson('t1')).toBe('anna');
        expect(getFanPerson('t2')).toBeNull();
        expect(fanPersonOtherTree('t2')).toBe('t1');
        expect(fanPersonOtherTree('t1')).toBeNull();
        localStorage.setItem('strom-live-follow-view', 'timeline');
        expect(getFollowView()).toBe('family');
    });

    it('reset clears all of them (every tree\'s person too) and the snapshot brings them back', () => {
        setFollowView('map');
        setFanPerson('t1', P('anna'));
        setFanPerson('t2', P('josef'));
        localStorage.setItem('strom-other', 'x');
        expect(hasFollowPrefs()).toBe(true);
        const snap = resetFollowPrefs();
        expect(hasFollowPrefs()).toBe(false);
        expect(getFollowView()).toBe('family');
        expect(localStorage.getItem('strom-other')).toBe('x');
        restoreFollowPrefs(snap);
        expect(getFollowView()).toBe('map');
        expect(getFanPerson('t2')).toBe('josef');
    });
});
