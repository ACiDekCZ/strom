/**
 * "What was written" with the tree's own files (spec 108 K2.6): the research's
 * answer says what it wrote of them (`media`, `/status.sends[].media` +
 * `mediaCount`); with a research that keeps them (`media.app`) the rows are
 * told by that alone, a photo is a written change ("photo"), and nothing of
 * the files is "app only". An older research without the gate: as before.
 * Invented data.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sanitizeMediaWritten, sanitizeSyncReply, sanitizeSends, MEDIA_WRITTEN_KINDS } from '../research-link.js';
import {
    diffOther, baseCopy, sentOtherRows, withWrittenMedia, RESEARCH_UNREAD_KINDS, MEDIA_APP_READ_KINDS,
    type PersonChange, type SentOtherRow, type NotWrittenItem,
} from '../research-changes.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import type { StromData, Person, PersonId, PartnershipId } from '../types.js';

const P = (id: string): PersonId => id as PersonId;
const person = (id: string, first: string, refn: string, extra: Partial<Person> = {}): Person => ({
    id: P(id), firstName: first, lastName: 'Brambůrek', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], refn, ...extra,
});

function tree(): StromData {
    return {
        persons: {
            p1: person('p1', 'Zbyhněv', 'P0001', { partnerships: ['u1' as PartnershipId] }),
            p2: person('p2', 'Ludmila', 'P0002', { gender: 'female', partnerships: ['u1' as PartnershipId] }),
            p3: person('p3', 'Hostivít', 'P0003'),
        },
        partnerships: {
            u1: { id: 'u1' as PartnershipId, person1Id: P('p1'), person2Id: P('p2'), childIds: [], status: 'married', researchId: 'F0001' },
        },
        sources: { s1: { id: 's1', title: 'Matrika N 1850–1860', refn: 'S0001' } },
    } as unknown as StromData;
}

const unreadGated = (): ReadonlySet<string> => {
    const s = new Set(RESEARCH_UNREAD_KINDS);
    for (const k of MEDIA_APP_READ_KINDS) s.delete(k);
    return s;
};

describe('the media of a write, checked', () => {
    it('keeps the known kinds with a record and an owner; drops the rest', () => {
        const items = sanitizeMediaWritten([
            { kind: 'media.photo', person: 'P0001', record: 'I0042', title: 'portrait.jpg', fields: ['title', 'date', 'Bad!', 'title'] },
            { kind: 'media.couplePhoto', family: 'F0001', record: 'I0042' },
            { kind: 'media.attachment', source: 'S0001', record: 'I0042', event: 'E0004' },
            { kind: 'media.unknown', person: 'P0001', record: 'I0042' },
            { kind: 'media.photo', person: 'P0001' },
            { kind: 'media.photo', record: 'I0042' },
            { kind: 'media.photo', person: '<b>', record: 'I0042' },
        ]);
        expect(items.map(i => i.kind)).toEqual(['media.photo', 'media.couplePhoto', 'media.attachment']);
        expect(items[0]).toEqual({ kind: 'media.photo', person: 'P0001', family: '', source: '', event: '', record: 'I0042', title: 'portrait.jpg', fields: ['title', 'date'] });
        expect(items[2].event).toBe('E0004');
        expect(MEDIA_WRITTEN_KINDS).toHaveLength(9);
    });

    it('a POST /sync answer: media in full, mediaCount never fewer than listed; none said: none', () => {
        const r = sanitizeSyncReply({ ok: true, changes: 2, applied: 2, input: 'I0042', media: [{ kind: 'media.photo', person: 'P0001', record: 'I0042' }] });
        expect(r.media).toHaveLength(1);
        expect(r.mediaCount).toBe(1);
        const more = sanitizeSyncReply({ ok: true, changes: 2, applied: 2, input: 'I0042', media: [{ kind: 'media.photo', person: 'P0001', record: 'I0042' }], mediaCount: 70 });
        expect(more.mediaCount).toBe(70);
        // An older research: nothing of the kind.
        const old = sanitizeSyncReply({ ok: true, changes: 1, applied: 1, input: 'I0042' });
        expect(old.media).toEqual([]);
        expect(old.mediaCount).toBe(0);
    });

    it('/status.sends: a written send keeps its media (at most 50) and mediaCount; another state none', () => {
        const media = Array.from({ length: 60 }, (_, i) => ({ kind: 'media.attachment', person: `P${i + 1}`, record: 'I0042' }));
        const [w, q] = sanitizeSends([
            { intake: 'R1', state: 'written', tree: 'tree_1', sent: 'fp-sent', at: '2026-11-17T10:30:00Z', changes: 60, media, mediaCount: 75 },
            { intake: 'R2', state: 'pending', tree: 'tree_1', sent: 'fp-sent', at: '2026-11-17T10:30:00Z', media },
        ])!;
        expect(w.media).toHaveLength(50);
        expect(w.mediaCount).toBe(75);
        expect(q.media).toBeUndefined();
        expect(q.mediaCount).toBeUndefined();
    });
});

describe('a photo is a change of its own', () => {
    it('a couple\'s photo: "photo", taken off "− photo"; "app only" without media.app, written with it', () => {
        const base = baseCopy(tree());
        const cur = tree();
        (cur.partnerships['u1' as PartnershipId] as { photo?: string }).photo = 'data:image/jpeg;base64,' + 'C'.repeat(400);
        const o = diffOther(base, cur)!;
        expect(o.couples[0].kinds).toEqual(['photo']);
        // An older research does not keep it (as before: the tree's files are not written there).
        expect(sentOtherRows(o)[0].appOnly).toBe(true);
        expect(sentOtherRows(o, unreadGated())[0].appOnly).toBeUndefined();

        const withPhoto = tree();
        (withPhoto.partnerships['u1' as PartnershipId] as { photo?: string }).photo = 'data:image/jpeg;base64,' + 'C'.repeat(400);
        expect(diffOther(baseCopy(withPhoto), tree())!.couples[0].kinds).toEqual(['photoRemoved']);
    });

    it('a source\'s attachment: "app only" without media.app, written with it', () => {
        const base = baseCopy(tree());
        const cur = tree();
        // An attachment of a person that belongs to the source: told at the source.
        cur.persons[P('p3')].attachments = [{ id: 'a1', dataUrl: 'data:application/pdf;base64,QUJD', name: 'zapis.pdf', sizeBytes: 3, sourceId: 's1' }] as never;
        const o = diffOther(base, cur)!;
        expect(o.sources[0].kinds).toContain('attachment');
        expect(sentOtherRows(o)[0].appOnly).toBe(true);
        expect(sentOtherRows(o, unreadGated())[0].appOnly).toBeUndefined();
    });
});

describe('the rows of a write told by its answer (withWrittenMedia)', () => {
    const item = (kind: string, o: { person?: string; family?: string; source?: string } = {}) =>
        ({ kind, person: o.person ?? '', family: o.family ?? '', source: o.source ?? '', record: 'I0042' });

    it('a portrait, a couple\'s photo and a source\'s attachment, from the answer alone', () => {
        const w = withWrittenMedia([], [], [
            item('media.photo', { person: 'P0003' }),
            item('media.couplePhoto', { family: 'F0001' }),
            item('media.attachment', { source: 'S0001' }),
            item('media.photo.removed', { person: 'P0001' }),
        ], 4, tree(), unreadGated());
        expect(w.list.map(c => [c.personId, c.kinds])).toEqual([['p3', ['photo']], ['p1', ['photoRemoved']]]);
        expect(w.other).toEqual([
            { type: 'source', id: 's1', title: 'Matrika N 1850–1860', kinds: ['attachment'] },
            { type: 'couple', id: 'u1', title: '', kinds: ['photo'], p1: 'p1', p2: 'p2' },
        ]);
        expect(w.more).toBe(0);
    });

    it('the comparison\'s file kinds go (the answer is the word); its other kinds stay', () => {
        const list: PersonChange[] = [
            { personId: P('p1'), name: 'Zbyhněv Brambůrek', kinds: ['birth', 'photo'] },
            { personId: P('p2'), name: 'Ludmila Brambůrek', kinds: ['attachment'] },
        ];
        const other: SentOtherRow[] = [
            { type: 'source', id: 's1', title: 'Matrika N 1850–1860', kinds: ['transcript', 'attachment'] },
            { type: 'couple', id: 'u1', title: '', kinds: ['photo'], appOnly: true, p1: P('p1'), p2: P('p2') },
        ] as SentOtherRow[];
        // The research says it wrote only Ludmila's attachment.
        const w = withWrittenMedia(list, other, [item('media.attachment', { person: 'P0002' })], 1, tree(), unreadGated());
        expect(w.list.map(c => [c.personId, c.kinds])).toEqual([['p2', ['attachment']], ['p1', ['birth']]]);
        expect(w.other).toEqual([{ type: 'source', id: 's1', title: 'Matrika N 1850–1860', kinds: ['transcript'] }]);
    });

    it('a couple the tree does not know by its family yet: the comparison\'s row of the same photo', () => {
        const t = tree();
        delete (t.partnerships['u1' as PartnershipId] as { researchId?: string }).researchId;
        const other = [{ type: 'couple', id: 'u1', title: '', kinds: ['photo'], appOnly: true, p1: P('p1'), p2: P('p2') }] as SentOtherRow[];
        const w = withWrittenMedia([], other, [item('media.couplePhoto', { family: 'F0099' })], 1, t, unreadGated());
        expect(w.other).toEqual([{ type: 'couple', id: 'u1', title: '', kinds: ['photo'], p1: 'p1', p2: 'p2' }]);
    });

    it('more than listed, or named for nothing here: "+ N more"', () => {
        const w = withWrittenMedia([], [], [item('media.photo', { person: 'P0001' }), item('media.photo', { person: 'P0777' })], 60, tree(), unreadGated());
        expect(w.list).toHaveLength(1);
        expect(w.more).toBe(58 + 1);
    });
});

describe('a not-written file (media.eventMissing, media.unreadable)', () => {
    let ui: typeof import('../ui/research-changes-ui.js');
    beforeAll(async () => { ui = await import('../ui/research-changes-ui.js'); }, 60000);
    afterEach(() => setLanguage('en'));
    const nw = (code: string, params: Record<string, string> = {}): NotWrittenItem => ({ person: 'P0001', fact: '', why: 'report', code, params });

    it('has its own reason in four languages, the unreadable part by params.part', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const s = getStringsForLang(lang).sync;
            expect(ui.nwReason(nw('media.eventMissing', { fact: 'BURI', record: 'I0042' })), lang).toBe(s.nw['media.eventMissing']);
            expect(ui.nwReason(nw('media.unreadable', { part: 'text', name: 'zapis.pdf' })), lang).toBe(s.nw['media.unreadable.text']);
            expect(ui.nwReason(nw('media.unreadable', { part: 'data', name: 'zapis.pdf' })), lang).toBe(s.nw['media.unreadable.data']);
            expect(s.nw['media.unreadable.text']).not.toBe(s.nw['media.unreadable.data']);
            expect(ui.nwReason(nw('media.unreadable', { part: 'data' }))).not.toBe(s.nwUnknown);
        }
    });
});
