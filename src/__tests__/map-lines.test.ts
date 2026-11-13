/**
 * The ancestors' path to one person on the map (spec 054): ancestor records
 * (rel, generation, quarter, eighth), lines and their classes, merging of
 * sibling routes, implex, missing ancestors, the target's place, the cut at
 * 400 lines and the playback schedule. Pure data, no DOM.
 */
import { describe, it, expect } from 'vitest';
import {
    buildPathModel, pathSegments, pathPoints, pathPlaySchedule, pathAddedIn, pathLastAdded,
    lineClassOf, pointClassOf, PATH_PLAY_MS, PathModel,
} from '../map-lines.js';
import { placeKey } from '../places.js';
import { StromData, Person, PersonId, PlaceGeo, LifeEvent } from '../types.js';

type G = 'male' | 'female';

function person(id: string, gender: G, parents: string[], o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Ostrolist', gender,
        isPlaceholder: false, parentIds: parents as PersonId[], childIds: [], partnerships: [], ...o,
    };
}

/** A person born in `year` at the place "Misto <id>" (which has coordinates unless `noGeo`). */
function born(id: string, gender: G, parents: string[], year: number | null, o: Partial<Person> = {}): Person {
    return person(id, gender, parents, { ...(year !== null ? { birthDate: String(year) } : {}), birthPlace: `Misto ${id}`, ...o });
}

function tree(persons: Person[], noGeo: string[] = []): StromData {
    const places: Record<string, PlaceGeo> = {};
    persons.forEach((p, i) => {
        for (const raw of [p.birthPlace, ...(p.events ?? []).map(e => e.place)]) {
            if (!raw) continue;
            const key = placeKey(raw);
            if (noGeo.some(n => key === placeKey(n))) continue;
            places[key] ??= { lat: 49 + (i % 7) * 0.1, lon: 14 + Math.floor(i / 7) * 0.1 + (i % 3) * 0.01 };
        }
    });
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {},
        places,
    };
}

const id = (s: string) => s as PersonId;
const rec = (m: PathModel, pid: string) => m.ancestors.filter(a => a.personId === pid);

/** T ← F, M ← four grandparents ← four great-grandparents (two on FF's side, two on MM's side). */
function family(): StromData {
    return tree([
        born('t', 'male', ['f', 'm'], 1958),
        born('f', 'male', ['ff', 'fm'], 1925),
        born('m', 'female', ['mf', 'mm'], 1930, { lastName: 'Pelyňková' }),
        born('ff', 'male', ['fff', 'ffm'], 1890),
        born('fm', 'female', [], 1895, { lastName: 'Rozchodníková' }),
        born('mf', 'male', [], 1898, { lastName: 'Jitrocel' }),
        born('mm', 'female', ['mmf', 'mmm'], 1900, { lastName: 'Mateřídoušková' }),
        born('fff', 'male', [], 1860),
        born('ffm', 'female', [], 1862, { lastName: 'Rozchodníková' }),
        born('mmf', 'male', [], 1870, { lastName: 'Mateřídoušek' }),
        born('mmm', 'female', [], 1872, { lastName: 'Jitrocelová' }),
    ]);
}

describe('ancestor records', () => {
    const m = buildPathModel(family(), id('t'));

    it('numbers each ancestor relative to the chosen person, with generation, quarter and eighth', () => {
        const pick = (pid: string) => { const a = rec(m, pid)[0]; return [a.rel, a.gen, a.quarter, a.eighth]; };
        expect(pick('f')).toEqual([2, 1, -1, -1]);
        expect(pick('m')).toEqual([3, 1, -1, -1]);
        expect(pick('ff')).toEqual([4, 2, 0, -1]);
        expect(pick('fm')).toEqual([5, 2, 1, -1]);
        expect(pick('mf')).toEqual([6, 2, 2, -1]);
        expect(pick('mm')).toEqual([7, 2, 3, -1]);
        expect(pick('fff')).toEqual([8, 3, 0, 0]);
        expect(pick('ffm')).toEqual([9, 3, 0, 1]);
        expect(pick('mmf')).toEqual([14, 3, 3, 6]);
        expect(pick('mmm')).toEqual([15, 3, 3, 7]);
        expect(m.ancestors).toHaveLength(10);
        expect(m.onMapCount).toBe(10);
    });

    it('the four and eight lines carry the birth surname, a count and the earliest year; an unknown one is null', () => {
        expect(m.quarters.map(q => q?.surname)).toEqual(['Ostrolist', 'Rozchodníková', 'Jitrocel', 'Mateřídoušková']);
        expect(m.quarters[0]).toMatchObject({ rootId: 'ff', count: 3, firstYear: 1860 });
        expect(m.quarters[1]).toMatchObject({ rootId: 'fm', count: 1, firstYear: 1895 });
        expect(m.quarters[3]).toMatchObject({ rootId: 'mm', count: 3, firstYear: 1870 });
        expect(m.eighths.map(e => e?.surname ?? null)).toEqual(
            ['Ostrolist', 'Rozchodníková', null, null, null, null, 'Mateřídoušek', 'Jitrocelová']);
        expect(m.eighths[1]).toMatchObject({ rootId: 'ffm', count: 1, firstYear: 1862 });
    });

    it('a missing grandparent is a null quarter', () => {
        const d = family();
        d.persons[id('m')].parentIds = [id('mf')];
        const m2 = buildPathModel(d, id('t'));
        expect(m2.quarters[3]).toBeNull();
        expect(m2.quarters[2]).not.toBeNull();
        expect(m2.eighths[6]).toBeNull();
    });

    it('the year range runs from the earliest ancestor on the map to the target', () => {
        expect([m.yearFrom, m.yearTo]).toEqual([1860, 1958]);
        expect(m.target).toMatchObject({ year: 1958, placeKey: 'misto t', kind: 'birth' });
    });

    it('maxGen stops the walk', () => {
        const m2 = buildPathModel(family(), id('t'), { maxGen: 2 });
        expect(m2.ancestors.map(a => a.rel)).toEqual([2, 3, 4, 5, 6, 7]);
    });

    it('a person who is their own ancestor (a data error) does not loop', () => {
        const d = family();
        d.persons[id('fff')].parentIds = [id('t')];
        d.persons[id('mmm')].parentIds = [id('m')];
        const m2 = buildPathModel(d, id('t'));
        expect(m2.ancestors.some(a => a.personId === 't')).toBe(false);
        expect(m2.ancestors.length).toBeLessThan(40);
    });
});

describe('missing ancestors', () => {
    it('lists each person once, with what is missing', () => {
        const d = family();
        delete d.persons[id('fm')].birthDate;                 // no date
        d.persons[id('mf')].birthPlace = 'Misto bez polohy';   // a place without a location
        delete d.persons[id('mmm')].birthDate;                // neither
        delete d.persons[id('mmm')].birthPlace;
        const m = buildPathModel(d, id('t'));
        expect(m.missing).toEqual([
            { personId: 'fm', reason: 'date' },
            { personId: 'mf', reason: 'place' },
            { personId: 'mmm', reason: 'both' },
        ]);
        expect(m.missingOnMap).toEqual(['fm', 'mf', 'mmm']);
        expect(m.onMapCount).toBe(7);
        expect(m.quarters[1]).toMatchObject({ rootId: 'fm', count: 0 });
        expect(m.quarters[1]!.firstYear).toBeUndefined();
    });

    it('a placeholder parent (the other parent of a one-parent family) is no ancestor: not missing, its line unknown', () => {
        const d = family();
        d.persons[id('mf')] = person('mf', 'male', [], { firstName: '', lastName: '', isPlaceholder: true });
        d.persons[id('ffm')] = person('ffm', 'female', [], { firstName: '', lastName: '', isPlaceholder: true });
        const m = buildPathModel(d, id('t'));
        expect(m.missing).toEqual([]);
        expect(rec(m, 'mf')).toEqual([]);
        expect(rec(m, 'ffm')).toEqual([]);
        expect(m.quarters[2]).toBeNull();
        expect(m.eighths[1]).toBeNull();
        expect(m.eighths[0]).toMatchObject({ rootId: 'fff' });
    });

    it('a baptism or a dated residence stands in for a missing birth place and year', () => {
        const d = family();
        const fm = d.persons[id('fm')];
        delete fm.birthDate; delete fm.birthPlace;
        fm.events = [{ id: 'e1', type: 'baptism', date: '1896', place: 'Misto krest' } as LifeEvent];
        d.places![placeKey('Misto krest')] = { lat: 50, lon: 15 };
        const m = buildPathModel(d, id('t'));
        expect(rec(m, 'fm')[0]).toMatchObject({ year: 1896, placeKey: 'misto krest', placeKind: 'baptism' });
        expect(m.missing).toEqual([]);
    });
});

describe('the target', () => {
    it('stands at birth → baptism → first dated residence, its year birth → baptism → the place’s year', () => {
        const d = family();
        const t = d.persons[id('t')];
        delete t.birthDate; delete t.birthPlace;
        t.events = [
            { id: 'r2', type: 'residence', date: '1990', place: 'Bydliste B' },
            { id: 'r1', type: 'residence', date: '1985', place: 'Bydliste A' },
            { id: 'r0', type: 'residence', place: 'Bydliste bez data' },
        ] as LifeEvent[];
        for (const n of ['Bydliste A', 'Bydliste B', 'Bydliste bez data']) d.places![placeKey(n)] = { lat: 50.5, lon: 15.5 };
        const m = buildPathModel(d, id('t'));
        expect(m.target).toEqual({ year: 1985, placeKey: 'bydliste a', pointKey: 'bydliste a', kind: 'residence' });
        expect(m.yearTo).toBe(1985);

        t.birthDate = '1958';
        expect(buildPathModel(d, id('t')).target).toMatchObject({ year: 1958, kind: 'residence' });
    });

    it('without a place the target is not drawn and the trunk ends at the parents', () => {
        const d = family();
        delete d.persons[id('t')].birthPlace;
        const m = buildPathModel(d, id('t'));
        expect(m.target).toEqual({ year: 1958, kind: null });
        expect(m.links.some(l => l.childId === 't')).toBe(false);
        expect(m.links.some(l => l.childId === 'f')).toBe(true);
        expect([m.yearFrom, m.yearTo]).toEqual([1860, 1958]);
    });

    it('nobody on the map: no range, no schedule', () => {
        const d = tree([born('t', 'male', ['f'], 1958), person('f', 'male', [])]);
        const m = buildPathModel(d, id('t'));
        expect(m.ancestors).toHaveLength(1);
        expect(m.onMapCount).toBe(0);
        expect([m.yearFrom, m.yearTo]).toEqual([null, null]);
        expect(pathPlaySchedule(m)).toBeNull();
        expect(buildPathModel(tree([born('t', 'male', [], 1958)]), id('t')).ancestors).toEqual([]);
    });
});

describe('lines', () => {
    it('parents and grandparents are the trunk, deeper lines take the parent’s quarter or eighth', () => {
        const m = buildPathModel(family(), id('t'));
        const { segs, total } = pathSegments(m, 2000, 'quarter');
        expect(total).toBe(10);
        const cls = (from: string, to: string) => segs.find(s => s.fromKey === `misto ${from}` && s.toKey === `misto ${to}`)?.cls;
        expect(cls('f', 't')).toBe('trunk');
        expect(cls('ff', 'f')).toBe('trunk');
        expect(cls('mm', 'm')).toBe('trunk');
        expect(cls('fff', 'ff')).toBe('q0');
        expect(cls('mmm', 'mm')).toBe('q3');
        const eighth = pathSegments(m, 2000, 'eighth').segs;
        expect(eighth.find(s => s.fromKey === 'misto ffm')?.cls).toBe('e1');
        expect(eighth.find(s => s.fromKey === 'misto mmf')?.cls).toBe('e6');
        expect(lineClassOf(4, 2, 5, 'eighth')).toBe('e5');
        expect(pointClassOf({ gen: 1, quarter: -1, eighth: -1 }, 'quarter')).toBe('trunk');
        expect(pointClassOf({ gen: 2, quarter: 1, eighth: -1 }, 'eighth')).toBe('q1');
    });

    it('a line appears in its child’s year and fades from it', () => {
        const m = buildPathModel(family(), id('t'));
        const at1890 = pathSegments(m, 1890, 'quarter').segs;
        expect(at1890.map(s => s.toKey).sort()).toEqual(['misto ff', 'misto ff']);
        expect(at1890[0]).toMatchObject({ year: 1890, age: 0, fresh: true });
        const late = pathSegments(m, 1950, 'quarter').segs.find(s => s.toKey === 'misto ff')!;
        expect(late).toMatchObject({ age: 60, fresh: false });
    });

    it('routes of one class merge; another class keeps its own line', () => {
        const d = family();
        // Both great-grandparents of FF born in one place: one line in quarters, two in eighths.
        d.persons[id('ffm')].birthPlace = 'Misto fff';
        // Both grandparents on the father's side born in one place: one trunk line.
        d.persons[id('fm')].birthPlace = 'Misto ff';
        const m = buildPathModel(d, id('t'));
        const q = pathSegments(m, 2000, 'quarter').segs;
        const toFF = q.filter(s => s.toKey === 'misto ff');
        expect(toFF).toHaveLength(1);
        expect(toFF[0]).toMatchObject({ cls: 'q0', parentIds: ['fff', 'ffm'], year: 1890 });
        const toF = q.filter(s => s.toKey === 'misto f');
        expect(toF).toHaveLength(1);
        expect(toF[0]).toMatchObject({ cls: 'trunk', parentIds: ['ff', 'fm'] });
        const e = pathSegments(m, 2000, 'eighth').segs.filter(s => s.toKey === 'misto ff');
        expect(e.map(s => s.cls).sort()).toEqual(['e0', 'e1']);
    });

    it('a parent born where the child was draws no line', () => {
        const d = family();
        d.persons[id('mf')].birthPlace = 'Misto m';
        const m = buildPathModel(d, id('t'));
        expect(m.links.some(l => l.parentId === 'mf')).toBe(false);
    });

    it('a map point resolver gathers several place keys into one point', () => {
        const d = family();
        d.persons[id('fm')].birthPlace = 'Misto f 12';
        d.places![placeKey('Misto f 12')] = { lat: 1, lon: 1 };
        const town = d.places!['misto f'];
        const m = buildPathModel(d, id('t'), {
            locate: key => key.startsWith('misto f') && key.length > 'misto f'.length + 1 && /\d$/.test(key)
                ? { key: 'misto f', geo: town }
                : d.places![key] ? { key, geo: d.places![key] } : null,
        });
        expect(rec(m, 'fm')[0]).toMatchObject({ placeKey: 'misto f 12', pointKey: 'misto f' });
        expect(m.links.some(l => l.parentId === 'fm')).toBe(false);   // same point as the child
    });
});

describe('implex', () => {
    // P is the father of both FM and MF: the father's mother and the mother's father are siblings.
    const d = tree([
        born('t', 'male', ['f', 'm'], 1958),
        born('f', 'male', ['ff', 'fm'], 1925),
        born('m', 'female', ['mf', 'mm'], 1930),
        born('ff', 'male', [], 1890),
        born('fm', 'female', ['p', 'pw'], 1895),
        born('mf', 'male', ['p', 'pw'], 1898),
        born('mm', 'female', [], 1900),
        born('p', 'male', [], 1860),
        born('pw', 'female', [], 1862),
    ]);
    const m = buildPathModel(d, id('t'));

    it('one record per path, the person counted once', () => {
        expect(rec(m, 'p').map(a => [a.rel, a.quarter, a.eighth])).toEqual([[10, 1, 2], [12, 2, 4]]);
        expect(m.onMapCount).toBe(8);
        expect(m.implex).toEqual([
            { personId: 'p', rels: [10, 12], quarters: [1, 2], eighths: [2, 4] },
            { personId: 'pw', rels: [11, 13], quarters: [1, 2], eighths: [3, 5] },
        ]);
    });

    it('each line to a child takes the colour of the branch it leads to; the point is drawn once, split', () => {
        const segs = pathSegments(m, 2000, 'quarter').segs.filter(s => s.fromKey === 'misto p');
        expect(segs.map(s => `${s.toKey}:${s.cls}`).sort()).toEqual(['misto fm:q1', 'misto mf:q2']);
        const pt = pathPoints(m, 2000, 'quarter').find(p => p.key === 'misto p')!;
        expect(pt.classes).toEqual(['q1', 'q2']);
        expect(pt.personIds).toEqual(['p']);
        expect(pt.ancestors).toHaveLength(2);
        expect(pathPoints(m, 2000, 'quarter').filter(p => p.key === 'misto p')).toHaveLength(1);
    });
});

describe('the cut at 400 lines', () => {
    /** A full pedigree of `gens` generations, everyone born at an own place, a generation every 25 years. */
    function pedigree(gens: number): StromData {
        const persons: Person[] = [];
        const name = (rel: number) => rel === 1 ? 't' : `a${rel}`;
        for (let rel = 1; rel < 2 ** (gens + 1); rel++) {
            const gen = Math.floor(Math.log2(rel));
            const parents = gen < gens ? [name(rel * 2), name(rel * 2 + 1)] : [];
            persons.push(born(name(rel), rel % 2 === 0 || rel === 1 ? 'male' : 'female', parents, 2000 - gen * 25 - (rel % 5)));
        }
        return tree(persons);
    }

    it('keeps 400 of the total: the trunk first, then closer generations', () => {
        const m = buildPathModel(pedigree(9), id('t'));
        const { segs, total } = pathSegments(m, 2010, 'quarter');
        expect(total).toBeGreaterThan(400);
        expect(segs).toHaveLength(400);
        const all = pathSegments(m, 2010, 'quarter', undefined, Infinity).segs;
        expect(all).toHaveLength(total);
        const trunk = all.filter(s => s.cls === 'trunk');
        expect(trunk).toHaveLength(6);
        expect(segs.slice(0, 6).every(s => s.cls === 'trunk')).toBe(true);
        const key = (s: { fromKey: string; toKey: string; cls: string }) => `${s.fromKey}->${s.toKey}|${s.cls}`;
        const kept = new Set(segs.map(key));
        const maxKeptGen = Math.max(...segs.map(s => s.gen));
        const minDroppedGen = Math.min(...all.filter(s => !kept.has(key(s))).map(s => s.gen));
        expect(maxKeptGen).toBeLessThanOrEqual(minDroppedGen);
    });

    it('lines added in the last ten years come right after the trunk', () => {
        const m = buildPathModel(pedigree(9), id('t'));
        // In 1830 the newest lines (children born 1821–1830) go before the older, closer ones.
        const { segs, total } = pathSegments(m, 1830, 'quarter', undefined, 20);
        expect(total).toBeGreaterThan(20);
        const fresh = pathSegments(m, 1830, 'quarter', undefined, Infinity).segs.filter(s => s.fresh);
        expect(fresh.length).toBeGreaterThan(0);
        expect(segs.slice(0, Math.min(20, fresh.length)).every(s => s.fresh)).toBe(true);
        expect(segs.every(s => s.cls !== 'trunk')).toBe(true);
    });

    it('within a generation an end in the viewport and then a longer line come first', () => {
        const d = tree([
            born('t', 'male', ['f'], 1958),
            born('f', 'male', ['ff'], 1925),
            born('ff', 'male', ['x', 'y'], 1890),
            born('x', 'male', ['x1', 'x2'], 1860),
            born('y', 'female', [], 1862),
            born('x1', 'male', [], 1830),
            born('x2', 'female', [], 1832),
        ]);
        d.places!['misto ff'] = { lat: 50, lon: 15 };
        d.places!['misto x'] = { lat: 50, lon: 16 };       // its line ends at FF (gen 3)
        d.places!['misto y'] = { lat: 50, lon: 15.1 };     // shorter, also to FF
        d.places!['misto x1'] = { lat: 50, lon: 17 };      // gen 4, to X
        d.places!['misto x2'] = { lat: 50, lon: 16.05 };
        const m = buildPathModel(d, id('t'));
        const nonTrunk = (segs: { cls: string; fromKey: string }[]) => segs.filter(s => s.cls !== 'trunk').map(s => s.fromKey);
        expect(nonTrunk(pathSegments(m, 2000, 'quarter').segs)).toEqual(['misto x', 'misto y', 'misto x1', 'misto x2']);
        // FF outside the viewport: the gen-3 lines still come before gen 4 (generation beats the viewport) …
        const outsideFF = (g: PlaceGeo) => !(g.lat === 50 && g.lon === 15);
        expect(nonTrunk(pathSegments(m, 2000, 'quarter', outsideFF).segs)).toEqual(['misto x', 'misto y', 'misto x1', 'misto x2']);
        // … and inside gen 4, the line whose end is in view wins over the longer one.
        const onlyX2End = (g: PlaceGeo) => g.lon !== 16;
        const trunkCount = pathSegments(m, 2000, 'quarter').segs.filter(s => s.cls === 'trunk').length;
        const cut = pathSegments(m, 2000, 'quarter', onlyX2End, trunkCount + 2).segs;
        expect(nonTrunk(cut)).toEqual(['misto x', 'misto y']);
        // The newest lines go first: at 1862, Y and X are fresh while X1 → X is not.
        expect(nonTrunk(pathSegments(m, 1862, 'quarter').segs)).toEqual(['misto x1', 'misto x2']);
    });
});

describe('playback schedule', () => {
    it('plays the whole range in 24 s, a year with a new ancestor or the target five times as long', () => {
        const m = buildPathModel(family(), id('t'));
        const s = pathPlaySchedule(m)!;
        expect([s.from, s.to]).toEqual([1860, 1958]);
        expect(s.steps).toHaveLength(1958 - 1860 + 1);
        expect(s.steps.reduce((a, x) => a + x.ms, 0)).toBe(PATH_PLAY_MS);
        const eventYears = s.steps.filter(x => x.event).map(x => x.year);
        expect(eventYears).toEqual([1860, 1862, 1870, 1872, 1890, 1895, 1898, 1900, 1925, 1930, 1958]);
        const weights = 99 + 11 * 4;
        expect(Math.abs(s.msOf(1861) - 24000 / weights)).toBeLessThanOrEqual(1);
        expect(Math.abs(s.msOf(1890) - 5 * 24000 / weights)).toBeLessThanOrEqual(1);
        expect(s.msOf(1700)).toBe(0);
    });

    it('a 246-year path with 45 years of a birth: about 56 ms an empty year, 280 ms a year with a birth', () => {
        // A straight paternal line of 44 ancestors born every five years from 1712, the target in 1958.
        const persons: Person[] = [born('t', 'male', ['a0'], 1958)];
        for (let i = 0; i < 44; i++) persons.push(born(`a${i}`, 'male', i < 43 ? [`a${i + 1}`] : [], 1927 - i * 5));
        const s = pathPlaySchedule(buildPathModel(tree(persons), id('t'), { maxGen: 50 }))!;
        expect([s.from, s.to]).toEqual([1712, 1958]);
        expect(s.steps.filter(x => x.event)).toHaveLength(45);
        expect(Math.abs(s.msOf(1713) - 56)).toBeLessThanOrEqual(1);
        expect(Math.abs(s.msOf(1712) - 281)).toBeLessThanOrEqual(1);
        expect(s.steps.reduce((a, x) => a + x.ms, 0)).toBe(24000);
    });

    it('what came in a year: the ancestor and the parent’s place, the target last', () => {
        const d = family();
        d.persons[id('mm')].birthDate = '1925';
        const m = buildPathModel(d, id('t'));
        expect(pathAddedIn(m, 1925).map(a => [a.personId, a.pointKey, a.fromKey])).toEqual([
            ['f', 'misto f', 'misto ff'],
            ['mm', 'misto mm', 'misto mmf'],
        ]);
        expect(pathAddedIn(m, 1958)).toEqual([
            { personId: 't', isTarget: true, rels: [], gen: 0, quarter: -1, eighth: -1, pointKey: 'misto t', fromKey: 'misto f' },
        ]);
        expect(pathAddedIn(m, 1927)).toEqual([]);
        expect(pathLastAdded(m, 1927)!.year).toBe(1925);
        expect(pathLastAdded(m, 1859)).toBeNull();
        expect(pathLastAdded(m, 2020)!.items[0].isTarget).toBe(true);
    });
});
