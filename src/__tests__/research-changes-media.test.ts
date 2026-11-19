/**
 * The tree's files in "What will be sent" / "What was written" (spec 102 §10):
 * a file's title, a file put at a fact, a file taken off a source, the
 * portrait right after the name, and what a research without `media.app` or
 * `material.links` is not promised. Invented data.
 */

import { describe, it, expect } from 'vitest';
import {
    diffByPerson, diffOther, baseCopy, gateMediaChanges, docSentRows, splitPersonAppOnly, personAppOnly, sanitizeSentOtherRow, type SentOtherRow,
} from '../research-changes.js';
import { addPersonMedia } from '../media.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

const person = (id: string, first: string, extra: Partial<Person> = {}): Person => ({
    id: id as PersonId, firstName: first, lastName: 'Quellmayer', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

function tree(): StromData {
    const d = {
        persons: {
            p1: person('p1', 'Oskar', { events: [{ id: 'e1', type: 'baptism', date: '1860-03-04' }], partnerships: ['u1' as PartnershipId] }),
            p2: person('p2', 'Ilsa', { gender: 'female', partnerships: ['u1' as PartnershipId], photo: 'data:image/jpeg;base64,' + 'A'.repeat(40) }),
        },
        partnerships: { u1: { id: 'u1' as PartnershipId, person1Id: 'p1' as PersonId, person2Id: 'p2' as PersonId, childIds: [], status: 'married' } },
        sources: { s1: { id: 's1', title: 'Matrika Talvany' } },
    } as unknown as StromData;
    addPersonMedia(d, 'p1' as PersonId, { id: 'a1', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 });
    addPersonMedia(d, 'p1' as PersonId, { id: 'a2', name: 'list.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,BBBB', sizeBytes: 3 }, 's1');
    return d;
}

const of = (list: ReturnType<typeof diffByPerson>, id: string) => list.find(c => c.personId === id)!;

describe('a file\'s title, place and source as changes of the person', () => {
    it('a title, kind or date: "attachment title"; a note is still "other"', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.media!.a1.title = 'Oskar at the mill';
        expect(of(diffByPerson(base, cur), 'p1').kinds).toEqual(['attachmentTitle']);
        const note = tree();
        note.media!.a1.note = 'from aunt Ermelinda';
        expect(of(diffByPerson(base, note), 'p1').kinds).toEqual(['other']);
    });

    it('a file put at the person\'s birth or event: "attachmentAt" naming it', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.media!.a1.places.push({ personId: 'p1' as PersonId, fact: 'birth' });
        const ch = of(diffByPerson(base, cur), 'p1');
        expect(ch.kinds).toEqual(['attachmentAt']);
        expect(ch.mediaAt).toEqual({ fact: 'birth' });
        const ev = tree();
        ev.media!.a1.places.push({ personId: 'p1' as PersonId, eventId: 'e1' });
        expect(of(diffByPerson(base, ev), 'p1').mediaAt).toEqual({ eventId: 'e1' });
    });

    it('a file taken off a source: "attachmentFrom" with the source\'s title, the source tells its file', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.media!.a2.places = cur.media!.a2.places.filter(p => !('sourceId' in p));
        const ch = of(diffByPerson(base, cur), 'p1');
        expect(ch.kinds).toContain('attachmentFrom');
        expect(ch.mediaFrom).toBe('Matrika Talvany');
        expect(diffOther(base, cur)!.sources.find(s => s.sourceId === 's1')!.kinds).toEqual(['attachment']);
    });

    it('the portrait is told right after the name', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.persons['p2' as PersonId].photo = 'data:image/jpeg;base64,' + 'C'.repeat(60);
        cur.persons['p2' as PersonId].firstName = 'Ilse';
        cur.persons['p2' as PersonId].birthDate = '1866';
        expect(of(diffByPerson(base, cur), 'p2').kinds).toEqual(['name', 'photo', 'birth']);
    });
});

describe('what a research writes of the tree\'s files (media.app, material.links)', () => {
    function changed(): { base: StromData; cur: StromData } {
        const base = baseCopy(tree());
        const cur = tree();
        cur.persons['p2' as PersonId].photo = 'data:image/jpeg;base64,' + 'C'.repeat(60);
        cur.media!.a1.title = 'Oskar at the mill';
        cur.media!.a1.places.push({ personId: 'p1' as PersonId, fact: 'birth' });
        cur.media!.a2.places = cur.media!.a2.places.filter(p => !('sourceId' in p));
        cur.partnerships['u1' as PartnershipId].photo = 'data:image/jpeg;base64,' + 'D'.repeat(60);
        return { base, cur };
    }

    it('a research with both: everything as it is, a source\'s file is its evidence', () => {
        const { base, cur } = changed();
        const g = gateMediaChanges(diffByPerson(base, cur), diffOther(base, cur), { photos: true, links: true }, { doc: true });
        expect(g.older).toBe(false);
        expect(of(g.list, 'p1').kinds).toEqual(['attachmentTitle', 'attachmentAt', 'attachmentFrom']);
        expect(of(g.list, 'p2').kinds).toEqual(['photo']);
        expect(g.other!.sources[0].kinds).toEqual(['doc']);
        expect(g.other!.couples[0].kinds).toEqual(['photo']);
    });

    it('without media.app: no portrait and no couple\'s photo promised (no "app only" step), one sentence', () => {
        const { base, cur } = changed();
        const g = gateMediaChanges(diffByPerson(base, cur), diffOther(base, cur), { photos: false, links: true });
        expect(g.older).toBe(true);
        expect(g.list.find(c => c.personId === 'p2')).toBeUndefined();
        expect(g.other!.couples).toEqual([]);
    });

    it('without material.links: a title or a new place is "other", a file off a source only at the source', () => {
        const { base, cur } = changed();
        const g = gateMediaChanges(diffByPerson(base, cur), diffOther(base, cur), { photos: true, links: false }, { doc: true });
        expect(g.older).toBe(true);
        const p1 = of(g.list, 'p1');
        expect(p1.kinds).toEqual(['other']);
        expect(p1.mediaAt).toBeUndefined();
        expect(p1.mediaFrom).toBeUndefined();
        expect(g.other!.sources[0].kinds).toEqual(['attachment']);
    });

    it('nothing of the files changed: nothing held back', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.persons['p1' as PersonId].firstName = 'Oskar Josef';
        const g = gateMediaChanges(diffByPerson(base, cur), diffOther(base, cur), { photos: false, links: false });
        expect(g.older).toBe(false);
        expect(of(g.list, 'p1').kinds).toEqual(['name']);
    });

    it('without media.app a person\'s attachments are app only: they leave the written row, a row of only files goes (verification of 3.30.0, research 1.34, N1)', () => {
        const base = baseCopy(tree());
        const cur = tree();
        addPersonMedia(cur, 'p1' as PersonId, { id: 'a3', name: 'mill.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,CCCC', sizeBytes: 3 });
        cur.persons['p1' as PersonId].notes = 'Worked at the mill.';
        addPersonMedia(cur, 'p2' as PersonId, { id: 'a4', name: 'letter.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,DDDD', sizeBytes: 3 });
        const w = { photos: false, links: false };
        const g = gateMediaChanges(diffByPerson(base, cur), null, w);
        expect(of(g.list, 'p1').kinds).toEqual(['attachment', 'note']);
        expect(personAppOnly(of(g.list, 'p2').kinds, w)).toBe(true);
        expect(personAppOnly(of(g.list, 'p1').kinds, w)).toBe(false);
        const split = splitPersonAppOnly(g.list, w);
        expect(split.list.map(c => [c.personId, c.kinds])).toEqual([['p1', ['note']]]);
        expect([...split.appOnly].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
            { type: 'person', id: 'p1', title: of(g.list, 'p1').name, kinds: ['attachment'], appOnly: true },
            { type: 'person', id: 'p2', title: of(g.list, 'p2').name, kinds: ['attachment'], appOnly: true },
        ]);
        // Kept for "What was written" and read back.
        expect(split.appOnly.map(sanitizeSentOtherRow)).toEqual(split.appOnly);
        expect(sanitizeSentOtherRow({ type: 'person', id: 'p1', title: 'x', kinds: ['attachment', 'birth', 7], appOnly: true })?.kinds).toEqual(['attachment']);
        // A research with media.app writes them (or not known yet: nothing held back).
        expect(splitPersonAppOnly(g.list, { photos: true, links: false }).appOnly).toEqual([]);
        expect(splitPersonAppOnly(g.list, null).list).toEqual(g.list);
        expect(personAppOnly(['attachment'], { photos: true, links: true })).toBe(false);
    });

    it('a written send\'s source rows: their files named evidence for a research with material.links', () => {
        const rows: SentOtherRow[] = [{ type: 'source', id: 's1', title: 'Matrika Talvany', kinds: ['title', 'attachment'] }];
        expect(docSentRows(rows, true)[0].kinds).toEqual(['title', 'doc']);
        expect(docSentRows(rows, false)[0].kinds).toEqual(['title', 'attachment']);
    });
});
