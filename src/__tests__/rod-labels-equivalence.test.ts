/**
 * The lineage labels computed in one pass (rodLabels groups the lineages by
 * surname once) give exactly what the rule gave lineage by lineage against
 * the whole list: same labels, same order, on every fixture, the etalon
 * trees and large synthetic trees (invented names only). The rod view's
 * index of the open tree is computed again after every change of the data.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildLineages, rodLabel, rodLabels, rods, Rod, RodId, LineageIndex } from '../lineage.js';
import { rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { surnameKey } from '../surnames.js';
import { placeKey } from '../places.js';
import { StromData, PersonId } from '../types.js';
import { DataManager } from '../data.js';
import { resetRodView, rodIndex, rodIndexGeneration, rodViewDataChanged } from '../ui/rod-view.js';
import { syntheticTree } from './helpers/synthetic-tree.js';

// ---- The rule as it was written before (every lineage against the whole list) ----

function referenceLabel(rod: Rod, all: readonly Rod[], data?: StromData): string {
    const key = surnameKey(rod.surname);
    const peers = all.filter(r => r.id !== rod.id && surnameKey(r.surname) === key && (rod.small || !r.small));
    if (!peers.length || !rod.surname) return rod.surname;
    const place = rod.places[0]?.name;
    const pk = place ? placeKey(place) : '';
    const placeOf = (r: Rod): string => r.places[0] ? placeKey(r.places[0].name) : '';
    if (pk && !peers.some(r => placeOf(r) === pk)) return `${rod.surname} (${place})`;
    const year = rod.founderYear;
    if (year != null && !peers.some(r => r.founderYear === year)) return `${rod.surname} (${year})`;
    const first = (data ?? null)?.persons[rod.founderId]?.firstName?.trim() ?? '';
    if (first) {
        const firstOf = (r: Rod): string => (data?.persons[r.founderId]?.firstName ?? '').trim();
        if (!peers.some(r => firstOf(r) === first) || year == null) return `${rod.surname} (${first})`;
        return `${rod.surname} (${first}, ${year})`;
    }
    if (year != null) return `${rod.surname} (${year})`;
    return pk ? `${rod.surname} (${place})` : rod.surname;
}

function referenceLabels(index: LineageIndex): Map<RodId, string> {
    const all = rods(index);
    return new Map(all.map(r => [r.id, referenceLabel(r, all, index.data)]));
}

// ---- Trees ----

const TEST_DIR = join(__dirname, '../../test');

function fixtures(): [string, StromData][] {
    const out: [string, StromData][] = [];
    for (const f of readdirSync(TEST_DIR).filter(x => x.endsWith('.json')).sort()) {
        const d = JSON.parse(readFileSync(join(TEST_DIR, f), 'utf8')) as StromData;
        if (d && d.persons && d.partnerships) out.push([f, d]);
    }
    return out;
}

/** The synthetic tree, its places and dates stripped as asked (the labels' later rules then decide). */
function synthetic(persons: number, seed: number, strip: { places?: boolean; dates?: boolean } = {}): StromData {
    const data = structuredClone(syntheticTree({ persons, seed }).data);
    for (const p of Object.values(data.persons)) {
        if (strip.places) {
            delete p.birthPlace; delete p.deathPlace;
            for (const ev of p.events ?? []) delete ev.place;
        }
        if (strip.dates) {
            delete p.birthDate; delete p.deathDate;
            for (const ev of p.events ?? []) delete ev.date;
        }
    }
    for (const u of Object.values(data.partnerships)) {
        if (strip.places) { delete u.startPlace; for (const ev of u.events ?? []) delete ev.place; }
        if (strip.dates) { delete u.startDate; for (const ev of u.events ?? []) delete ev.date; }
    }
    return data;
}

function expectSameLabels(index: LineageIndex): Map<RodId, string> {
    const now = rodLabels(index);
    const before = referenceLabels(index);
    expect([...now.entries()]).toEqual([...before.entries()]);
    return now;
}

describe('rodLabels: the same labels as the rule lineage by lineage', () => {
    it.each(fixtures())('%s', (_name, data) => {
        const index = buildLineages(data);
        expectSameLabels(index);
        const all = rods(index);
        for (const rod of all) expect(rodLabel(rod, all, index.data)).toBe(referenceLabel(rod, all, index.data));
    });

    it('the real tree when present (local only)', () => {
        const file = join(TEST_DIR, 'real-large.json');
        if (!existsSync(file)) return;
        expectSameLabels(buildLineages(JSON.parse(readFileSync(file, 'utf8')) as StromData));
    });

    const variants: [string, () => StromData][] = [
        ['synthetic 6000', () => synthetic(6000, 20261017)],
        ['synthetic 2000, another seed', () => synthetic(2000, 7)],
        ['synthetic 2000 without places', () => synthetic(2000, 11, { places: true })],
        ['synthetic 2000 without places and dates', () => synthetic(2000, 13, { places: true, dates: true })],
    ];
    it.each(variants)('%s', (_name, make) => {
        const index = buildLineages(make());
        const labels = expectSameLabels(index);
        // The trees share surnames among many lineages: the qualifiers are really compared.
        expect([...labels.values()].filter(l => l.includes('(')).length).toBeGreaterThan(50);
        // The picker built on them as before (its items take the labels in).
        const reference = referenceLabels(index);
        for (const item of rodPickerItems(index, undefined, undefined, 'en')) {
            if (item.id !== 'tree' && item.id !== 'other') expect(item.label).toBe(reference.get(item.id) || index.rods.get(item.id)!.surname);
        }
        for (const item of rodPickerSmallItems(index, 'en')) {
            expect(item.label).toBe(reference.get(item.id as RodId) || index.rods.get(item.id as RodId)!.surname);
        }
    });

    it('the qualifiers of every kind are reached by the synthetic trees', () => {
        const kinds = new Set<string>();
        for (const [, make] of variants.slice(1)) {
            const index = buildLineages(make());
            for (const [id, label] of rodLabels(index)) {
                const rod = index.rods.get(id)!;
                const q = label.slice(rod.surname.length).trim();
                if (!q) kinds.add('plain');
                else if (/^\(\d+\)$/.test(q)) kinds.add('year');
                else if (/, \d+\)$/.test(q)) kinds.add('first+year');
                else if (rod.places[0] && q === `(${rod.places[0].name})`) kinds.add('place');
                else kinds.add('first');
            }
        }
        for (const k of ['first', 'first+year', 'place', 'year']) expect(kinds).toContain(k);
    });
});

describe('the rod view\'s index follows every change of the data', () => {
    afterEach(() => {
        resetRodView();
        vi.restoreAllMocks();
    });

    it('an edit in place (with its change notice), another tree, an undo: computed again each time', () => {
        resetRodView();
        let data = synthetic(1000, 5);
        vi.spyOn(DataManager, 'getData').mockImplementation(() => data);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockImplementation(() => null);
        vi.spyOn(DataManager, 'isLocked').mockImplementation(() => false);

        const first = rodIndex();
        expect(rodIndex()).toBe(first);                       // no change: the same index
        const rod = rods(first.index).find(r => !r.small)!;
        const founder = data.persons[rod.founderId as PersonId];
        const oldName = founder.lastName;

        // An edit mutates the data in place and notifies.
        const gen = rodIndexGeneration();
        founder.lastName = 'Vymyšlenec';
        for (const id of rod.memberIds) data.persons[id].lastName = 'Vymyšlenec';
        rodViewDataChanged();
        expect(rodIndexGeneration()).not.toBe(gen);
        const edited = rodIndex();
        expect(edited).not.toBe(first);
        expect(edited.index.rods.get(rod.id)?.surname).toBe('Vymyšlenec');
        expect([...edited.labels.entries()]).toEqual([...referenceLabels(edited.index).entries()]);

        // Another tree (a new data object), even before its notice.
        const before = data;
        data = synthetic(800, 9);
        const other = rodIndex();
        expect(other.index.data).toBe(data);
        expect([...other.labels.entries()]).toEqual([...referenceLabels(other.index).entries()]);

        // Back (an undo restores a copy of the data) and the notice.
        for (const id of rod.memberIds) before.persons[id].lastName = oldName;
        data = structuredClone(before);
        rodViewDataChanged();
        const undone = rodIndex();
        expect(undone.index.rods.get(rod.id)?.surname).toBe(first.index.rods.get(rod.id)?.surname);
        expect([...undone.labels.entries()]).toEqual([...first.labels.entries()]);
    });
});
