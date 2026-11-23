/**
 * "What will be sent" beyond the people: sources (with their attachments),
 * couples, places' coordinates and surname variants since the research's
 * version; when the list cannot be told exactly. Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { diffByPerson, diffOther, baseCopy, markOlderCopy, otherRowCount, previewInexact, previewNothing, OtherChanges, sendCounts } from '../research-changes.js';
import { researchAutoState } from '../research-device.js';
import { getStringsForLang } from '../strings.js';
import { normalizeSingleParents } from '../single-parent.js';
import { addPersonMedia } from '../media.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

const P = (id: string): PersonId => id as PersonId;

const person = (id: string, first: string, extra: Partial<Person> = {}): Person => ({
    id: P(id), firstName: first, lastName: 'Dvořák', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

function tree(): StromData {
    return {
        persons: {
            p1: person('p1', 'Karel', { birthPlace: 'Kolín', partnerships: ['u1' as PartnershipId], childIds: [P('p3'), P('p4')], sourceIds: ['s1'] }),
            p2: person('p2', 'Marta', { gender: 'female', partnerships: ['u1' as PartnershipId], childIds: [P('p3'), P('p4')] }),
            p3: person('p3', 'Petr', { parentIds: [P('p1'), P('p2')] }),
            p4: person('p4', 'Eva', { gender: 'female', parentIds: [P('p1'), P('p2')], sourceIds: ['s1'] }),
        },
        partnerships: {
            u1: { id: 'u1' as PartnershipId, person1Id: P('p1'), person2Id: P('p2'), childIds: [P('p3'), P('p4')], status: 'married', startDate: '1901', sourceIds: ['s3'] },
        },
        sources: {
            s1: { id: 's1', title: 'Matrika Kolín', reference: 'fol. 12', excerpts: [{ id: 'x1', dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10, sizeBytes: 3 }] },
            s2: { id: 's2', title: 'Sčítání lidu 1921' },
            s3: { id: 's3', title: 'Oddací kniha Kolín' },
        },
        places: { kolin: { lat: 50.0281, lon: 15.2006 } },
        surnameVariants: [['Dvořák', 'Dworzak']],
    } as unknown as StromData;
}

const copyOf = (t: StromData): StromData => JSON.parse(JSON.stringify(t)) as StromData;

describe('changes beyond the people', () => {
    it('nothing changed: nothing beyond the people', () => {
        const o = diffOther(baseCopy(tree()), tree())!;
        expect(o).toEqual({ sources: [], couples: [], places: { count: 0, items: [] }, surnameVariants: { count: 0, items: [] } });
        expect(otherRowCount(o)).toBe(0);
    });

    it('no base: not known', () => {
        expect(diffOther(null, tree())).toBeNull();
        expect(otherRowCount(null)).toBe(0);
    });

    it('a source added (with its transcript and an excerpt) and one deleted (titled as the research has it, no link)', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        delete cur.sources!.s2;
        cur.sources!.s9 = { id: 's9', title: 'Pozemková kniha', transcript: 'Karel Dvořák, chalupník', excerpts: [{ id: 'x9', dataUrl: 'data:image/jpeg;base64,BBBB', width: 1, height: 1, sizeBytes: 3 }] };
        const o = diffOther(base, cur)!;
        expect(o.sources).toEqual([
            { sourceId: 's9', title: 'Pozemková kniha', kinds: ['added', 'transcript', 'excerptAdded'], citedBy: { persons: 0 } },
            { sourceId: 's2', title: 'Sčítání lidu 1921', kinds: ['deleted'], citedBy: { persons: 0 }, deleted: true },
        ]);
    });

    it('a source\'s title, transcript, page, excerpts added and removed; other fields as "other"', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        const s1 = cur.sources!.s1;
        s1.title = 'Matrika Kolín N 1890–1910';
        s1.transcript = 'Eva, dcera Karla';
        s1.reference = 'fol. 13';
        s1.excerpts = [{ id: 'x2', dataUrl: 'data:image/jpeg;base64,CCCC', width: 10, height: 10, sizeBytes: 3 }];
        cur.sources!.s2.repository = 'SOA Praha';
        const o = diffOther(base, cur)!;
        expect(o.sources.find(s => s.sourceId === 's1')!.kinds).toEqual(['title', 'transcript', 'page', 'excerptAdded', 'excerptRemoved']);
        expect(o.sources.find(s => s.sourceId === 's2')!.kinds).toEqual(['other']);
    });

    it('who cites a source: people, else only a couple, else nobody', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        cur.sources!.s1.transcript = 'x';
        cur.sources!.s2.transcript = 'y';
        cur.sources!.s3.transcript = 'z';
        const o = diffOther(base, cur)!;
        expect(o.sources.find(s => s.sourceId === 's1')!.citedBy).toEqual({ persons: 2 });
        expect(o.sources.find(s => s.sourceId === 's2')!.citedBy).toEqual({ persons: 0 });
        expect(o.sources.find(s => s.sourceId === 's3')!.citedBy).toEqual({ persons: 0, couple: [P('p1'), P('p2')] });
    });

    it('an attachment of a source is told at the source only, not at the person holding it', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        addPersonMedia(cur, P('p3'), { id: 'a1', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 }, 's2');
        const o = diffOther(base, cur)!;
        expect(o.sources).toEqual([{ sourceId: 's2', title: 'Sčítání lidu 1921', kinds: ['attachment'], citedBy: { persons: 0 } }]);
        expect(diffByPerson(base, cur)).toEqual([]);
        // An attachment of the person's own (no source) stays the person's.
        const own = copyOf(tree());
        addPersonMedia(own, P('p3'), { id: 'a2', name: 'foto.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 });
        expect(diffOther(base, own)!.sources).toEqual([]);
        expect(diffByPerson(base, own)).toEqual([{ personId: 'p3', name: 'Petr Dvořák', kinds: ['attachment'] }]);
    });

    it('an attachment naming a source in neither version: a row of its own named by its file (no link)', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        addPersonMedia(cur, P('p3'), { id: 'a1', name: 'list.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA', sizeBytes: 3 }, 's77');
        expect(diffOther(base, cur)!.sources).toEqual([{ sourceId: 's77', title: 'list.pdf', kinds: ['attachment'], citedBy: { persons: 0 }, attachmentOnly: true }]);
    });

    it('a changed source is not counted twice: at the source, while the people citing it keep only their own changes', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        cur.sources!.s1.transcript = 'Eva, dcera…';
        expect(diffByPerson(base, cur)).toEqual([]);
        expect(diffOther(base, cur)!.sources.map(s => s.sourceId)).toEqual(['s1']);
        // A new citation is still the person's.
        cur.persons[P('p3')].sourceIds = ['s1'];
        expect(diffByPerson(base, cur)).toEqual([{ personId: 'p3', name: 'Petr Dvořák', kinds: ['citation'] }]);
    });

    it('couples: the children\'s order, the main marriage, the wedding\'s evidence', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        const u = cur.partnerships['u1' as PartnershipId];
        u.childIds = [P('p4'), P('p3')];
        u.isPrimary = true;
        u.startStatus = 'proven';
        expect(diffOther(base, cur)!.couples).toEqual([{ partnershipId: 'u1', p1: P('p1'), p2: P('p2'), kinds: ['childOrder', 'mainMarriage', 'marriageEvidence'] }]);
        // A changed wedding date is the partners' change (diffByPerson), not a couple row.
        const date = copyOf(tree());
        date.partnerships['u1' as PartnershipId].startDate = '1902';
        expect(diffOther(base, date)!.couples).toEqual([]);
    });

    it('couples: a child given to one parent (a "?" family) is a single-parent row', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        cur.persons[P('p5')] = person('p5', 'Jiří', { parentIds: [P('p3')] });
        cur.persons[P('p3')].childIds = [P('p5')];
        normalizeSingleParents(cur);
        const o = diffOther(base, cur)!;
        const u = Object.values(cur.partnerships).find(x => x.childIds.includes(P('p5')))!;
        expect(o.couples).toEqual([{ partnershipId: u.id, p1: u.person1Id, p2: u.person2Id, kinds: ['singleParent'] }]);
        expect(diffByPerson(base, cur).map(c => c.personId)).toEqual(['p5']);
    });

    it('places: coordinates only; a renamed place is the people\'s change, not counted here', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        cur.places!.kolin = { lat: 50.03, lon: 15.2 };
        const o = diffOther(base, cur)!;
        expect(o.places!.count).toBe(1);
        expect(o.places!.items[0]).toMatchObject({ key: 'kolin', name: 'Kolín', lat: 50.03, lon: 15.2 });
        const renamed = copyOf(tree());
        renamed.persons[P('p1')].birthPlace = 'Kolín nad Labem';
        expect(diffOther(base, renamed)!.places).toEqual({ count: 0, items: [] });
        expect(otherRowCount(o)).toBe(1);
    });

    it('surname variants added and removed', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        cur.surnameVariants = [['Dvořák', 'Dvorak'], ['Nováková', 'Novakova']];
        const o = diffOther(base, cur)!;
        expect(o.surnameVariants!.items).toEqual([
            { surname: 'Dvořák', variant: 'Dvorak' },
            { surname: 'Nováková', variant: 'Novakova' },
            { surname: 'Dvořák', variant: 'Dworzak', removed: true },
        ]);
        expect(o.surnameVariants!.count).toBe(3);
        // A new group belongs to the surname someone in the tree has, whatever order the group keeps.
        const sorted = copyOf(tree());
        sorted.surnameVariants = [['Dvořák', 'Dworzak'], ['Hrabak', 'Hrabák']];
        sorted.persons[P('p3')].lastName = 'Hrabák';
        expect(diffOther(base, sorted)!.surnameVariants!.items).toEqual([{ surname: 'Hrabák', variant: 'Hrabak' }]);
    });

    it('a copy kept before places and variants were: those sections are not known (undefined), even when kept again', () => {
        const old = copyOf(tree()) as StromData & Record<string, unknown>;
        delete old.places;
        delete old.surnameVariants;
        const marked = markOlderCopy(old);
        const cur = copyOf(tree());
        cur.places!.kolin = { lat: 1, lon: 2 };
        cur.surnameVariants = [];
        const o = diffOther(marked, cur)!;
        expect(o.places).toBeUndefined();
        expect(o.surnameVariants).toBeUndefined();
        expect(diffOther(baseCopy(marked), cur)!.places).toBeUndefined();
        // A copy that has them: told.
        expect(diffOther(baseCopy(tree()), cur)!.places!.count).toBe(1);
    });
});

describe('the preview\'s subtitle and "cannot be told exactly"', () => {
    const other = (n: number): OtherChanges => ({ sources: Array.from({ length: n }, (_, i) => ({ sourceId: `s${i}`, title: 't', kinds: ['title'], citedBy: { persons: 0 } })), couples: [] });

    it('counts people and the other rows (places and variants one row each)', () => {
        const o: OtherChanges = { ...other(3), couples: [{ partnershipId: 'u1', p1: P('p1'), p2: P('p2'), kinds: ['childOrder'] }],
            places: { count: 12, items: [] }, surnameVariants: { count: 2, items: [] } };
        expect(otherRowCount(o)).toBe(6);
        const en = getStringsForLang('en').changes;
        const cs = getStringsForLang('cs').changes;
        const de = getStringsForLang('de').changes;
        expect(en.willSendSub(1, 6, '10:42')).toBe('1 person · 6 other changes · changed since 10:42');
        expect(en.willSendSub(2, 0, '')).toBe('2 people');
        expect(en.willSendSub(0, 3, '')).toBe('3 changes');
        expect(en.willSendAutoSub(1, 1)).toBe('1 person · 1 other change · sent automatically shortly');
        expect(cs.willSendSub(1, 6, '')).toBe('1 osoba · 6 dalších změn');
        expect(cs.willSendSub(3, 2, '')).toBe('3 osoby · 2 další změny');
        expect(de.willSendSub(1, 6, '')).toBe('1 Person · 6 weitere Änderungen');
        expect(en.showWhat(1, 6)).toBe('Show what will be sent (1 person · 6 other changes)');
        expect(en.showWhat(1)).toBe('Show what will be sent (1 person)');
    });

    it('no base (copy not read yet, a restore before loading, a send taken back with no copy before it): inexact', () => {
        // All three leave researchChangesBase() without a base: no list of people, nothing beyond them.
        expect(previewInexact(null, null)).toBe(true);
        expect(previewInexact(null, null, { inStep: true })).toBe(true);
        expect(previewInexact([], other(0), { inexact: true })).toBe(true);
        expect(previewInexact([], other(0), { inexact: true, inStep: true })).toBe(true);
    });

    it('no people but other changes: exact', () => {
        expect(previewInexact([], other(2))).toBe(false);
        expect(previewInexact([{ personId: P('p1'), name: 'Karel', kinds: ['name'] }], other(0))).toBe(false);
        // Nothing to name at all although the tree differs: said so (never "0 people" with Send).
        expect(previewInexact([], other(0))).toBe(true);
    });

    it('a tree in step with the research and nothing listed: nothing to send, exact, no Send', () => {
        expect(previewInexact([], other(0), { inStep: true })).toBe(false);
        expect(previewNothing([], other(0), true)).toBe(true);
        // Something listed, the tree not in step, no base, or the base moved: not "nothing".
        expect(previewNothing([], other(1), true)).toBe(false);
        expect(previewNothing([{ personId: P('p1'), name: 'Karel', kinds: ['name'] }], other(0), true)).toBe(false);
        expect(previewNothing([], other(0), false)).toBe(false);
        expect(previewNothing(null, null, true)).toBe(false);
        expect(previewNothing([], other(0), true, { inexact: true })).toBe(false);
    });

    it('nothing to send is said in every language', () => {
        expect(getStringsForLang('en').changes.nothingToSend).toBe('Nothing to send: the tree is in step with the research.');
        expect(getStringsForLang('cs').changes.nothingToSend).toBe('Není co poslat: strom je v souladu s výzkumem.');
        expect(getStringsForLang('de').changes.nothingToSend).toBe('Nichts zu senden: Der Stammbaum ist mit der Forschung abgeglichen.');
        expect(getStringsForLang('pl').changes.nothingToSend).toBe('Nie ma nic do wysłania: drzewo jest zgodne z badaniem.');
    });
});

describe('what a written send did not write, as kept', () => {
    let store: Map<string, string>;
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('keeps the name and the family of each item (the row names who it was about)', () => {
        store.set('strom-research-auto:t1', JSON.stringify({ notWritten: {
            at: '2026-10-20T10:00:00Z', fingerprint: 'f1', written: 3, unexplained: 0,
            items: [{ person: 'I0007', fact: 'BIRT', why: 'kept', name: 'Karel Dvořák', family: 'F0003' }, { person: 'I0008', fact: '', why: 'pick', family: 'X1' }],
        } }));
        const items = researchAutoState('t1').notWritten!.items;
        expect(items[0]).toEqual({ person: 'I0007', fact: 'BIRT', why: 'kept', name: 'Karel Dvořák', family: 'F0003' });
        expect(items[1]).toEqual({ person: 'I0008', fact: '', why: 'pick' });
    });
});

describe('the numbers of What will be sent after a merge (134 V-N5)', () => {
    it('the lead and the sections count the same rows: a "?" is no new person, a new couple is told at its partners', () => {
        const base = baseCopy(tree());
        const cur = copyOf(tree());
        const u = (id: string, a: string, b: string, kids: string[]) =>
            ({ id: id as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: kids.map(P), status: 'married' });
        // A merge brought: Kvido, a child of the couple; Zbyhněv, a child of Petr and a "?" stand-in; Dalimil, Eva's husband.
        cur.persons[P('p5')] = person('p5', 'Kvido', { parentIds: [P('p1'), P('p2')] });
        cur.persons[P('p1')].childIds.push(P('p5'));
        cur.persons[P('p2')].childIds.push(P('p5'));
        cur.partnerships['u1' as PartnershipId].childIds.push(P('p5'));
        cur.persons[P('p6')] = person('p6', '?', { lastName: '', gender: 'female', isPlaceholder: true, partnerships: ['u2' as PartnershipId], childIds: [P('p7')] });
        cur.persons[P('p7')] = person('p7', 'Zbyhněv', { parentIds: [P('p3'), P('p6')] });
        cur.persons[P('p3')].partnerships = ['u2' as PartnershipId];
        cur.persons[P('p3')].childIds = [P('p7')];
        cur.partnerships['u2' as PartnershipId] = u('u2', 'p3', 'p6', ['p7']) as never;
        cur.persons[P('p8')] = person('p8', 'Dalimil', { partnerships: ['u3' as PartnershipId] });
        cur.persons[P('p4')].partnerships = ['u3' as PartnershipId];
        cur.partnerships['u3' as PartnershipId] = u('u3', 'p8', 'p4', []) as never;

        const list = diffByPerson(base, cur);
        const other = diffOther(base, cur);
        const c = sendCounts(list, other);
        // Three new people (not the "?"); Eva, a person of the research, married Dalimil: a row of her own.
        // A new child is told at the child (its parents' rows say nothing). One couple's own row: Petr and the "?".
        expect(c.added).toBe(3);
        expect(list.filter(ch => ch.kinds.includes('added')).map(ch => ch.personId).sort()).toEqual(['p5', 'p7', 'p8']);
        expect(list.filter(ch => !ch.kinds.includes('added')).map(ch => ch.personId)).toEqual(['p4']);
        expect(c.persons).toBe(list.length);
        expect(c.changed).toBe(1);
        expect(c.couples).toBe(other!.couples.length);
        expect(c.couples).toBe(1);
        // The lead says these numbers, the heads of the list the same.
        const W = getStringsForLang('en').mergeWizard;
        const ch = getStringsForLang('en').changes;
        expect(W.resSendLeadList('Dvořákovi', c.added, c.changed, c.couples, c.sources))
            .toContain('Dvořákovi: 3 new people, 1 other person changed, 1 couple.');
        expect(ch.sectionPersons(c.persons)).toBe(`People · ${c.added + c.changed}`);
        expect(ch.sectionCouples(c.couples)).toBe('Couples · 1');
    });
});
