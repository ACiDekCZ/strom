/**
 * A live load of the research's tree (spec 055): what changed between two
 * states, the scene's timing and geometry, the motion setting, the trail on
 * the cards and the screen reader's words. The DOM part (no empty frame,
 * cards kept, the scene) is covered by e2e/live-load.spec.ts. Fictional
 * names only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';
import { diffLive, changedFields, looksMerged, liveChangeCount, normalizeSurname } from '../live-diff.js';
import {
    LIVE, liveTime, liveMotionOn, childLightPath, polylineLength, pulseDash, lightFits, newCardDelays, edgeNotchSpot,
    cardTrailOpacity, simplifyPolyline, polylinePath,
} from '../live-transition.js';
import { getLiveMotion, setLiveMotion, hasFollowPrefs, resetFollowPrefs, restoreFollowPrefs } from '../live-follow-prefs.js';
import { pushCardTrail, CardTrailEntry, TRAIL_MAX, TRAIL_MAX_AGE_MS } from '../live-follow-targets.js';
import { liveAnnouncement } from '../ui/live-announce.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { stabilizeIds } from '../research-link.js';

type Sex = 'male' | 'female';
interface Spec { first: string; last: string; sex: Sex; born?: string; parents?: string[] }

function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: false,
            partnerships: [], parentIds: (s.parents ?? []) as PersonId[], childIds: [], birthDate: s.born,
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships } as StromData;
}

const P = (id: string): PersonId => id as PersonId;

// The Vrbovský family: a couple and two children.
const base = (): Record<string, Spec> => ({
    jaromir: { first: 'Jaromír', last: 'Vrbovský', sex: 'male', born: '1850' },
    ludmila: { first: 'Ludmila', last: 'Kapradinová', sex: 'female', born: '1853' },
    vojtech: { first: 'Vojtěch', last: 'Vrbovský', sex: 'male', born: '1878', parents: ['jaromir', 'ludmila'] },
    blazena: { first: 'Blažena', last: 'Vrbovská', sex: 'female', born: '1880', parents: ['jaromir', 'ludmila'] },
});
const baseUnions = (): [string, string, string, string[]][] => [['u1', 'jaromir', 'ludmila', ['vojtech', 'blazena']]];

describe('what a live load changed (diffLive)', () => {
    it('a new child, a new partner and a new parent come as added', () => {
        const before = tree(base(), baseUnions());
        const people: Record<string, Spec> = {
            ...base(),
            radka: { first: 'Radka', last: 'Vrbovská', sex: 'female' as Sex, born: '1883', parents: ['jaromir', 'ludmila'] },
            zbysek: { first: 'Zbyšek', last: 'Hlohovec', sex: 'male' as Sex, born: '1876' },
            kvido: { first: 'Kvido', last: 'Vrbovský', sex: 'male' as Sex, born: '1820' },
        };
        people.jaromir = { ...people.jaromir, parents: ['kvido'] };
        const after = tree(people, [['u1', 'jaromir', 'ludmila', ['vojtech', 'blazena', 'radka']], ['u2', 'zbysek', 'blazena', []]]);
        const diff = diffLive(before, after);
        expect(diff.added.sort()).toEqual(['kvido', 'radka', 'zbysek']);
        expect(diff.removed).toEqual([]);
        expect(diff.merged.size).toBe(0);
        // Only relations changed for the people who were there: no field change, no ring.
        expect(diff.changed.size).toBe(0);
        expect(liveChangeCount(diff)).toBe(3);
    });

    it('a field the card shows changed: the field is named', () => {
        const before = tree(base(), baseUnions());
        const people = base();
        people.vojtech = { ...people.vojtech, born: '1879' };
        const after = tree(people, baseUnions());
        const diff = diffLive(before, after);
        expect(diff.changed.get(P('vojtech'))).toEqual(['birthDate']);
        expect(diff.added).toEqual([]);
    });

    it('an empty value and a missing one are the same; relations and bookkeeping are no own fields', () => {
        const a = { id: P('a'), firstName: 'Ola', lastName: '', gender: 'female', partnerships: [], parentIds: [], childIds: [], isPlaceholder: false } as Person;
        const b = { ...a, lastName: undefined, parentIds: [P('x')], refn: 'I0001' } as unknown as Person;
        expect(changedFields(a, b)).toEqual([]);
        expect(changedFields(a, { ...a, deathDate: '1900' } as Person)).toEqual(['deathDate']);
    });

    it('a person gone while a close one changed reads as merged into that one', () => {
        const people = {
            ...base(),
            vojtech2: { first: 'Vojta', last: 'Vrbovsky', sex: 'male' as Sex, born: '1879', parents: ['jaromir', 'ludmila'] },
        };
        const before = tree(people, [['u1', 'jaromir', 'ludmila', ['vojtech', 'blazena', 'vojtech2']]]);
        const merged = base();
        merged.vojtech = { ...merged.vojtech, first: 'Vojtěch (Vojta)' };
        const after = tree(merged, baseUnions());
        const diff = diffLive(before, after);
        expect(diff.merged.get(P('vojtech2'))).toBe('vojtech');
        expect(diff.removed).toEqual([]);
        expect(looksMerged(before, after, P('vojtech2'), P('vojtech'))).toBe(true);
    });

    it('a person gone with no close one changed is removed (another surname or birth year: no merge)', () => {
        const people = {
            ...base(),
            ctibor: { first: 'Ctibor', last: 'Šafránek', sex: 'male' as Sex, born: '1879', parents: ['jaromir', 'ludmila'] },
        };
        const before = tree(people, [['u1', 'jaromir', 'ludmila', ['vojtech', 'blazena', 'ctibor']]]);
        const after = tree(base(), baseUnions());
        const diff = diffLive(before, after);
        expect(diff.removed).toEqual(['ctibor']);
        expect(diff.merged.size).toBe(0);
        expect(looksMerged(before, after, P('ctibor'), P('vojtech'))).toBe(false);
    });

    it('surnames compare without diacritics, case and spaces', () => {
        expect(normalizeSurname('Vrbovská ')).toBe(normalizeSurname('vrbovska'));
        expect(normalizeSurname(undefined)).toBe('');
    });
});

describe('the scene\'s timing and geometry (live-transition)', () => {
    it('a phone or tablet runs every time × 0.875; motion needs the setting on and no reduced motion', () => {
        expect(liveTime(320, false)).toBe(320);
        expect(liveTime(320, true)).toBe(280);
        expect(liveMotionOn(true, false)).toBe(true);
        expect(liveMotionOn(false, false)).toBe(false);
        expect(liveMotionOn(true, true)).toBe(false);
    });

    it('the light runs down the stem, along the connector and the bus, down the drop to the card', () => {
        const line = { stemX: 100, stemTopY: 40, connectorY: 70, connectorToX: 100, branchY: 70, drops: [{ personId: 'c1', x: 60, bottomY: 100 }, { personId: 'c2', x: 140, bottomY: 100 }] };
        const path = childLightPath(line, 'c2')!;
        expect(path).toEqual([{ x: 100, y: 40 }, { x: 100, y: 70 }, { x: 140, y: 70 }, { x: 140, y: 100 }]);
        expect(polylineLength(path)).toBe(30 + 40 + 30);
        expect(childLightPath(line, 'nobody')).toBeNull();
        expect(polylinePath([{ x: 0, y: 0 }, { x: 0, y: 5 }])).toBe('M0.0 0.0 L0.0 5.0');
        expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 9 }])).toEqual([{ x: 0, y: 0 }, { x: 0, y: 9 }]);
    });

    it('the glow is a 34 px dash run past the whole path; a line under 48 px gets no light', () => {
        const d = pulseDash(100);
        expect(d.dasharray).toBe('34 144');
        expect(d.from).toBe(34);
        expect(d.to).toBe(34 - 134);
        expect(lightFits(47)).toBe(false);
        expect(lightFits(48)).toBe(true);
    });

    it('new cards come nearest first, +20 ms each, a couple\'s children after the partner; at most 12', () => {
        const items = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, dist: 14 - i, afterPartner: i === 13 }));
        const delays = newCardDelays(items);
        expect(delays.size).toBe(LIVE.maxAnimatedNew);
        expect(delays.get('n12')).toBe(0);
        expect(delays.get('n11')).toBe(20);
        // The child waiting for its parent's partner is last in the order: beyond 12, it stands at once.
        expect(delays.has('n13')).toBe(false);
        const few = newCardDelays([{ id: 'p', dist: 5, afterPartner: false }, { id: 'c', dist: 1, afterPartner: true }]);
        expect(few.get('p')).toBe(0);
        expect(few.get('c')).toBe(20 + LIVE.childAfterPartner);
    });

    it('a card out of view gets the notch on the side it is furthest beyond, clamped from the corners', () => {
        expect(edgeNotchSpot({ left: 10, top: 10, right: 50, bottom: 50 }, 800, 600)).toBeNull();
        expect(edgeNotchSpot({ left: 900, top: 100, right: 1000, bottom: 160 }, 800, 600)).toEqual({ side: 'right', at: 130 });
        expect(edgeNotchSpot({ left: -300, top: -50, right: -200, bottom: 10 }, 800, 600)).toEqual({ side: 'left', at: 26 });
        expect(edgeNotchSpot({ left: 300, top: 700, right: 400, bottom: 760 }, 800, 600)?.side).toBe('bottom');
    });

    it('the trail dots fade with age along 043\'s series', () => {
        expect(cardTrailOpacity(0)).toBe(1);
        expect(cardTrailOpacity(7)).toBe(0.33);
        expect(cardTrailOpacity(20)).toBe(0.33);
    });
});

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

describe('the motion setting (§4)', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('on by default; off is stored as 0 and counts as a choice; back to the default restores it', () => {
        expect(getLiveMotion()).toBe(true);
        expect(hasFollowPrefs()).toBe(false);
        setLiveMotion(false);
        expect(getLiveMotion()).toBe(false);
        expect(localStorage.getItem('strom-live-motion')).toBe('0');
        expect(hasFollowPrefs()).toBe(true);
        const saved = resetFollowPrefs();
        expect(getLiveMotion()).toBe(true);
        restoreFollowPrefs(saved);
        expect(getLiveMotion()).toBe(false);
        setLiveMotion(true);
        expect(localStorage.getItem('strom-live-motion')).toBeNull();
    });
});

describe('the trail on the cards (K3.2)', () => {
    const e = (personId: string, at: number, kind: 'added' | 'changed' = 'added', session = 1): CardTrailEntry => ({ personId: P(personId), kind, session, at });

    it('newest first, a person once, at most 8, none older than an hour', () => {
        let trail: CardTrailEntry[] = [];
        trail = pushCardTrail(trail, [e('a', 0), e('b', 0)], 0);
        trail = pushCardTrail(trail, [e('a', 10, 'changed', 2)], 10);
        expect(trail.map(t => [t.personId, t.kind, t.session])).toEqual([['a', 'changed', 2], ['b', 'added', 1]]);
        for (let i = 0; i < 10; i++) trail = pushCardTrail(trail, [e(`p${i}`, 20 + i)], 20 + i);
        expect(trail.length).toBe(TRAIL_MAX);
        expect(trail[0].personId).toBe('p9');
        expect(pushCardTrail(trail, [], 30 + TRAIL_MAX_AGE_MS)).toEqual([]);
    });
});

describe('the screen reader\'s words (§5)', () => {
    it('one person: by name; more: the count and at most 3 names; changes, removals and merges joined', () => {
        const before = tree({
            ...base(),
            ctibor: { first: 'Ctibor', last: 'Šafránek', sex: 'male', born: '1879', parents: ['jaromir', 'ludmila'] },
        }, [['u1', 'jaromir', 'ludmila', ['vojtech', 'blazena', 'ctibor']]]);
        const people: Record<string, Spec> = { ...base() };
        for (const n of ['a', 'b', 'c', 'd']) people[n] = { first: `Kid${n.toUpperCase()}`, last: 'Vrbovský', sex: 'male', parents: ['jaromir', 'ludmila'] };
        people.vojtech = { ...people.vojtech, born: '1879' };
        const after = tree(people, [['u1', 'jaromir', 'ludmila', ['vojtech', 'blazena', 'a', 'b', 'c', 'd']]]);
        const text = liveAnnouncement(diffLive(before, after), before, after);
        expect(text).toBe('People added: 4 – KidA Vrbovský, KidB Vrbovský, KidC Vrbovský and 1 more. Person changed: Vojtěch Vrbovský. Person removed: Ctibor Šafránek');
        const one = tree({ ...base(), e: { first: 'Eliška', last: 'Vrbovská', sex: 'female', parents: ['jaromir', 'ludmila'] } }, baseUnions());
        expect(liveAnnouncement(diffLive(tree(base(), baseUnions()), one), tree(base(), baseUnions()), one)).toBe('Person added: Eliška Vrbovská');
        expect(liveAnnouncement(diffLive(one, one), one, one)).toBe('');
    });
});

describe('a person without a number keeps their id over a load (stabilizeIds)', () => {
    const GED = (extra: string[] = []) => [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @P0003@ INDI', '1 NAME Ctirad /Hlohovec/', '1 SEX M', '1 REFN P0003', '1 FAMS @F0000@',
        '0 @P0001@ INDI', '1 NAME Radim /Hlohovec/', '1 SEX M', '1 REFN P0001', '1 FAMC @F0000@',
        // A child of the family without a number of its own.
        '0 @X1@ INDI', '1 NAME Bez /Čísla/', '1 SEX F', '1 FAMC @F0000@',
        ...extra,
        '0 @F0000@ FAM', '1 HUSB @P0003@', '1 CHIL @P0001@', '1 CHIL @X1@',
        '0 TRLR',
    ].join('\n');
    const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;

    it('the same people around and the same name: the same id, so a load changes nothing', () => {
        const before = importGed(GED());
        const after = stabilizeIds(importGed(GED()), before);
        const diff = diffLive(before, after);
        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(Object.keys(after.persons).sort()).toEqual(Object.keys(before.persons).sort());
    });
});
