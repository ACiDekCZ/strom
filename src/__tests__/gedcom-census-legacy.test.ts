/**
 * A person's census from GEDCOM (`1 CENS`): Strom 3.27 read it as a custom
 * event named "Census" (or by its `2 TYPE`); the census type of a person's
 * own reads it as a census. A tree of 3.27 is updated once (data version 20,
 * a backup first): its custom "Census" becomes a census with everything
 * written at it kept, so the same file loaded again adds no census twice;
 * a custom event of another name stays. The census's TYPE heads its note and
 * goes back to the file as TYPE. Invented data (the Křemenáček family of
 * Horní Bludovec).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { createSnapshot } from '../snapshots.js';
import { StorageManager } from '../storage.js';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { executeMerge, isEffectivelyConfirmed } from '../merge/executor.js';
import { convertLegacyCensusEvents } from '../events.js';
import type { MergeState } from '../merge/types.js';
import type { LifeEvent, Person, StromData, TreeId } from '../types.js';

/** Two censuses of Bořivoj, one with a TYPE; one of his wife with her age and a citation. */
const GED = [
    '0 HEAD', '1 SOUR GRAMPS', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Bořivoj /Křemenáček/', '1 SEX M', '1 BIRT', '2 DATE 1851', '1 FAMS @F1@',
    '1 CENS', '2 DATE 31 DEC 1880', '2 PLAC Horní Bludovec', '2 NOTE Čp. 12, hospodář',
    '1 CENS', '2 TYPE Sčítání obyvatel Čech', '2 DATE 31 DEC 1890', '2 PLAC Horní Bludovec',
    '0 @I2@ INDI', '1 NAME Vratislavka /Ořechovská/', '1 SEX F', '1 BIRT', '2 DATE 1856', '1 FAMS @F1@',
    '1 CENS', '2 DATE 31 DEC 1880', '2 PLAC Horní Bludovec', '2 AGE 24', '2 SOUR @S1@', '3 PAGE fol. 3',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1878',
    '0 @S1@ SOUR', '1 TITL Sčítání lidu Horní Bludovec 1880',
    '0 TRLR',
].join('\n');

const load = (text: string): StromData => migrateData(convertToStrom(parseGedcom(text)).data);
const person = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
const censuses = (p: Person): LifeEvent[] => (p.events ?? []).filter(e => e.type === 'census');
const customs = (p: Person): LifeEvent[] => (p.events ?? []).filter(e => e.type === 'custom');

/**
 * The tree 3.27 made of GED and stored (data version 19): each person's
 * `1 CENS` a custom event named "Census" (as checked with the parser of tag
 * v3.27.0), one with a TYPE named by it, its note without the TYPE.
 */
function storedBy327(): StromData {
    const d = convertToStrom(parseGedcom(GED)).data;
    for (const p of Object.values(d.persons)) {
        for (const ev of p.events ?? []) {
            if (ev.type !== 'census') continue;
            ev.type = 'custom';
            ev.customLabel = ev.gedcomType ?? 'Census';
            if (ev.gedcomType) {
                const rest = ev.note!.slice(ev.gedcomType.length).replace(/^\n/, '');
                if (rest) ev.note = rest; else delete ev.note;
                delete ev.gedcomType;
            }
        }
    }
    d.version = 19;
    return d;
}

/** The wizard's "Merge with existing", every match it leaves to confirm confirmed. */
const mergeAll = async (state: MergeState): Promise<StromData> => {
    for (const m of state.matches) if (!isEffectivelyConfirmed(state, m)) updateMatchDecision(state, m.incomingId, 'confirm');
    return (await executeMerge(state)).mergedData!;
};
const eventCount = (d: StromData): number => Object.values(d.persons).reduce((n, p) => n + (p.events?.length ?? 0), 0);

describe('GEDCOM 1 CENS / 2 TYPE: the kind of census is kept (B-N2)', () => {
    it('heads the census\'s note and goes back as TYPE, read again the same', () => {
        const d = load(GED);
        const [plain, typed] = censuses(person(d, 'Bořivoj'));
        expect(plain.note).toBe('Čp. 12, hospodář');
        expect(plain.gedcomType).toBeUndefined();
        expect(typed.note).toBe('Sčítání obyvatel Čech');
        expect(typed.gedcomType).toBe('Sčítání obyvatel Čech');
        const out = exportToGedcom(d, 'Křemenáček', {}).content.split(/\r?\n/);
        const at = out.indexOf('2 TYPE Sčítání obyvatel Čech');
        expect(at).toBeGreaterThan(0);
        expect(out[at - 1]).toBe('1 CENS');
        expect(out.filter(l => l.startsWith('2 NOTE Sčítání'))).toHaveLength(0);
        const again = load(out.join('\n'));
        expect(censuses(person(again, 'Bořivoj')).map(e => [e.date, e.note, e.gedcomType])).toEqual([
            ['1880-12-31', 'Čp. 12, hospodář', undefined],
            ['1890-12-31', 'Sčítání obyvatel Čech', 'Sčítání obyvatel Čech'],
        ]);
    });

    it('a TYPE with a note: both kept, the note goes as NOTE; a note edited at its first line writes no TYPE', () => {
        const d = load(GED.replace('2 TYPE Sčítání obyvatel Čech', '2 TYPE Sčítání obyvatel Čech\n2 NOTE Čp. 12'));
        const typed = censuses(person(d, 'Bořivoj'))[1];
        expect(typed.note).toBe('Sčítání obyvatel Čech\nČp. 12');
        const out = exportToGedcom(d, 'Křemenáček', {}).content.split(/\r?\n/);
        const at = out.indexOf('2 TYPE Sčítání obyvatel Čech');
        expect(out.slice(at, at + 5)).toContain('2 NOTE Čp. 12');
        typed.note = 'Čp. 14';
        const edited = exportToGedcom(d, 'Křemenáček', {}).content.split(/\r?\n/);
        expect(edited).not.toContain('2 TYPE Sčítání obyvatel Čech');
        expect(edited).toContain('2 NOTE Čp. 14');
    });
});

describe('a tree of 3.27: its custom "Census" becomes a census once (B-N1)', () => {
    it('the update converts only a custom event named "Census" in one of the languages, all written at it kept', () => {
        const d = storedBy327();
        const vrat = person(d, 'Vratislavka');
        // Written by hand: a census in Czech with a source and an age, another custom event.
        vrat.events!.push(
            { id: 'ev_hand1', type: 'custom', customLabel: 'Sčítání lidu', date: '1890-12-31', place: 'Horní Bludovec', age: '34', note: 'S manželem' },
            { id: 'ev_hand2', type: 'custom', customLabel: 'Census of the parish', date: '1869' },
        );
        const before = structuredClone(vrat.events!);
        const loaded = migrateData(structuredClone(d));
        const bor = person(loaded, 'Bořivoj');
        expect(censuses(bor).map(e => [e.date, e.note, e.customLabel])).toEqual([['1880-12-31', 'Čp. 12, hospodář', undefined]]);
        // The census named by its TYPE is a custom event like another file's EVEN / TYPE: it stays.
        expect(customs(bor).map(e => e.customLabel)).toEqual(['Sčítání obyvatel Čech']);
        const lv = person(loaded, 'Vratislavka');
        expect(lv.events!.map(e => [e.id, e.type, e.customLabel])).toEqual([
            [before[0].id, 'census', undefined], ['ev_hand1', 'census', undefined], ['ev_hand2', 'custom', 'Census of the parish'],
        ]);
        // Nothing else of them changed: date, place, age, note, citation.
        for (const [i, ev] of lv.events!.entries()) {
            const { type: _t1, customLabel: _l1, ...was } = before[i];
            const { type: _t2, customLabel: _l2, ...now } = ev;
            expect(now).toEqual(was);
        }
        expect(lv.events![0].age).toBe(before[0].age);
        expect(lv.events![0].age).toBeTruthy();
        expect(lv.events![0].sourceIds).toHaveLength(1);
    });

    it('a tree of data version 20 is not touched: a custom "Census" written there stays', () => {
        const d = storedBy327();
        d.version = 20;
        const loaded = migrateData(structuredClone(d));
        expect(censuses(person(loaded, 'Bořivoj'))).toHaveLength(0);
        expect(customs(person(loaded, 'Bořivoj')).map(e => e.customLabel)).toEqual(['Census', 'Sčítání obyvatel Čech']);
        expect(convertLegacyCensusEvents(structuredClone(d))).toBe(2);
    });

    describe('TreeManager.readTreeData', () => {
        let saved: StromData[];
        beforeEach(() => {
            saved = [];
            vi.mocked(createSnapshot).mockClear();
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation((_id, data) => { saved.push(JSON.parse(JSON.stringify(data))); });
        });
        afterEach(() => { vi.restoreAllMocks(); });

        it('backs the tree up as it was, converts and saves it once', async () => {
            const d = storedBy327();
            vi.spyOn(TreeManager as unknown as { readTreeRecord: () => Promise<unknown> }, 'readTreeRecord')
                .mockResolvedValue({ status: 'ok', data: structuredClone(d) });
            const result = await TreeManager.readTreeData('census-327' as TreeId);
            if (result.status !== 'ok') throw new Error(result.status);
            expect(createSnapshot).toHaveBeenCalledTimes(1);
            expect(vi.mocked(createSnapshot).mock.calls[0][2]).toBe('pre-migration');
            const backup = vi.mocked(createSnapshot).mock.calls[0][1] as StromData;
            expect(customs(person(backup, 'Bořivoj')).map(e => e.customLabel)).toEqual(['Census', 'Sčítání obyvatel Čech']);
            expect(saved).toHaveLength(1);
            expect(censuses(person(saved[0], 'Bořivoj'))).toHaveLength(1);
            expect(censuses(person(saved[0], 'Vratislavka'))).toHaveLength(1);
            expect(censuses(person(result.data, 'Bořivoj'))[0].note).toBe('Čp. 12, hospodář');
        });
    });
});

describe('the same file merged again into the tree of 3.27 adds no census (B-N1)', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('the updated tree: 0 events added, the citation joins the kept census', async () => {
        const old = migrateData(storedBy327());
        const merged = await mergeAll(createMergeState(old, load(GED)));
        expect(eventCount(merged)).toBe(eventCount(old));
        expect(censuses(person(merged, 'Bořivoj'))).toHaveLength(1);
        expect(customs(person(merged, 'Bořivoj')).map(e => e.customLabel)).toEqual(['Sčítání obyvatel Čech']);
        expect(censuses(person(merged, 'Vratislavka'))).toHaveLength(1);
    });

    it('a tree that kept its custom "Census" (not updated): paired all the same', async () => {
        const old = storedBy327();
        old.version = 20;
        const kept = migrateData(old);
        const merged = await mergeAll(createMergeState(kept, load(GED)));
        expect(eventCount(merged)).toBe(eventCount(kept));
        expect(censuses(person(merged, 'Bořivoj'))).toHaveLength(0);
    });
});
