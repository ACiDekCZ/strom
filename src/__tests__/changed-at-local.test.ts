/**
 * Person.changedAt (spec 136 D4) is this tree's own bookkeeping, written by
 * every edit: it is not a change of the tree's content. The comparisons of
 * content (the research's fingerprint, the change packets of a share, the
 * merge's print of a person) leave it out, and a step that puts people back
 * as they were (the undo of a merge) gives back their earlier time.
 */

import { describe, it, expect } from 'vitest';
import { contentFingerprint } from '../research-link.js';
import { buildChangePacket, isEmptyPacket, summarizeChangePacket, applyPacketOntoData } from '../share-diff.js';
import { restoreChangedAt, stampChangedAt } from '../person-lists-data.js';
import { personPrint } from '../merge/record.js';
import type { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

const id = (s: string) => s as PersonId;
const uid = (s: string) => s as PartnershipId;

function person(pid: string, firstName: string, extra: Partial<Person> = {}): Person {
    return { id: id(pid), firstName, lastName: 'Talvanen', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra } as Person;
}

/** Oskar and Liisa Talvanen with their son Veli. */
function tree(): StromData {
    const u: Partnership = { id: uid('u1'), person1Id: id('oskar'), person2Id: id('liisa'), childIds: [id('veli')], status: 'married' } as Partnership;
    return {
        version: 1,
        persons: {
            [id('oskar')]: person('oskar', 'Oskar', { partnerships: [uid('u1')], childIds: [id('veli')], birthPlace: 'Mlýnky' }),
            [id('liisa')]: person('liisa', 'Liisa', { gender: 'female', partnerships: [uid('u1')], childIds: [id('veli')] }),
            [id('veli')]: person('veli', 'Veli', { parentIds: [id('oskar'), id('liisa')] }),
        },
        partnerships: { [uid('u1')]: u },
    } as StromData;
}

describe('the research fingerprint', () => {
    it('does not change with the time of a last change', () => {
        const a = tree();
        const b = structuredClone(a);
        b.persons[id('oskar')].changedAt = '2026-11-20T09:00:00.000Z';
        expect(contentFingerprint(b)).toBe(contentFingerprint(a));
        b.persons[id('oskar')].birthPlace = 'Horní Vranice';
        expect(contentFingerprint(b)).not.toBe(contentFingerprint(a));
    });
});

describe('change packets of a share', () => {
    it('a person whose only difference is the time of the last change is no change', () => {
        const base = tree();
        const current = structuredClone(base);
        current.persons[id('veli')].changedAt = '2026-11-20T09:00:00.000Z';
        expect(isEmptyPacket(buildChangePacket(base, current, { baseExportId: 'X' }))).toBe(true);
    });

    it('the sender\'s time stays theirs: Accept keeps this tree\'s, a packet opened again changes nothing', () => {
        const base = tree();
        const sender = structuredClone(base);
        sender.persons[id('veli')].birthDate = '1952';
        sender.persons[id('veli')].changedAt = '2026-11-20T09:00:00.000Z';
        const packet = buildChangePacket(base, sender, { baseExportId: 'X' });
        // The owner edited Veli meanwhile (their own time).
        const owner = structuredClone(base);
        owner.persons[id('veli')].birthPlace = 'Ostrovid';
        owner.persons[id('veli')].changedAt = '2026-11-21T08:00:00.000Z';
        const summary = summarizeChangePacket(owner, packet, base);
        expect(summary.modifiedPersons.map(p => p.changedFieldKeys)).toEqual([['birthDate']]);
        const accepted = applyPacketOntoData(owner, packet, base);
        expect(accepted.persons[id('veli')]).toMatchObject({ birthDate: '1952', birthPlace: 'Ostrovid', changedAt: '2026-11-21T08:00:00.000Z' });
        // Accept is an edit here: Veli gets this tree's time; the same packet again has nothing to apply.
        stampChangedAt(owner, accepted, '2026-11-22T10:00:00.000Z');
        const again = summarizeChangePacket(accepted, packet, base);
        expect(again.modifiedPersons).toEqual([]);
        expect(again.newPersons).toEqual([]);
    });
});

describe('the merge', () => {
    it('a person\'s print leaves out the time of the last change', () => {
        const p = tree().persons[id('oskar')];
        expect(personPrint({ ...p, changedAt: '2026-11-20T09:00:00.000Z' })).toBe(personPrint(p));
    });

    it('restoreChangedAt: people back as they were get their earlier time, the rest keep the step\'s', () => {
        const earlier = tree();
        earlier.persons[id('oskar')].changedAt = '2026-11-01T09:00:00.000Z';
        // The merge: Oskar and Veli changed (stamped then), Liisa through the couple.
        const merged = structuredClone(earlier);
        merged.persons[id('oskar')].birthDate = '1921';
        merged.persons[id('veli')].notes = 'Mlynář';
        merged.partnerships[uid('u1')].startPlace = 'Mlýnky';
        stampChangedAt(earlier, merged, '2026-11-22T14:41:00.000Z');
        expect(merged.persons[id('liisa')].changedAt).toBe('2026-11-22T14:41:00.000Z');
        // Its undo: Oskar and the couple as before, Veli keeps the note (a later edit stays).
        const undone = structuredClone(merged);
        delete undone.persons[id('oskar')].birthDate;
        delete undone.partnerships[uid('u1')].startPlace;
        stampChangedAt(merged, undone, '2026-11-22T14:42:00.000Z');
        undone.persons[id('veli')].changedAt = '2026-11-22T14:42:00.000Z';
        expect(restoreChangedAt(undone, merged, earlier)).toBe(2);
        expect(undone.persons[id('oskar')].changedAt).toBe('2026-11-01T09:00:00.000Z');
        expect('changedAt' in undone.persons[id('liisa')]).toBe(false);
        expect(undone.persons[id('veli')].changedAt).toBe('2026-11-22T14:42:00.000Z');
    });

    it('restoreChangedAt keeps the step\'s time of a person whose couple is not as before', () => {
        const earlier = tree();
        const merged = structuredClone(earlier);
        merged.persons[id('oskar')].birthDate = '1921';
        merged.partnerships[uid('u1')].startPlace = 'Mlýnky';
        stampChangedAt(earlier, merged, '2026-11-22T14:41:00.000Z');
        const undone = structuredClone(merged);
        delete undone.persons[id('oskar')].birthDate;
        stampChangedAt(merged, undone, '2026-11-22T14:42:00.000Z');
        expect(restoreChangedAt(undone, merged, earlier)).toBe(0);
        expect(undone.persons[id('oskar')].changedAt).toBe('2026-11-22T14:42:00.000Z');
    });
});
