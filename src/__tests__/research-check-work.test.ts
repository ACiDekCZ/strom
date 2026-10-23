/**
 * Checking the agent's work (spec 015): what the research does not read
 * ("app only"), what a send carried beyond the people, what the research did
 * not write paired to sources and places, the sources named by the
 * research's history lines. Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    RESEARCH_UNREAD_KINDS, sourceAppOnly, coupleAppOnly, placesAppOnly, variantsAppOnly,
    sentOtherRows, sanitizeSentOtherRow, pairNotWritten, OtherChanges, NotWrittenItem,
} from '../research-changes.js';
import { researchAutoState } from '../research-device.js';
import {
    sanitizeLiveLog, sanitizeLiveChange, sanitizeSyncReply, sourceIdsByRef, researchShortTitle, findSourceTitle,
    lineNewerThanLoaded, sourceIdOfXref,
} from '../research-link.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

const P = (id: string): PersonId => id as PersonId;

const person = (id: string, first: string, extra: Partial<Person> = {}): Person => ({
    id: P(id), firstName: first, lastName: 'Dvořák', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

function tree(): StromData {
    return {
        persons: {
            p1: person('p1', 'Karel', { refn: 'P0001' }),
            p2: person('p2', 'Marta', { gender: 'female', refn: 'P0002' }),
        },
        partnerships: {},
        sources: {
            s1: { id: 's1', title: 'Matrika narozených Kolín 1850–1870', refn: 'S0012' },
            s2: { id: 's2', title: 'Sčítání lidu 1890' },
        },
    } as unknown as StromData;
}

describe('what the research does not read', () => {
    it('a row is app only when every one of its kinds is unread', () => {
        expect(RESEARCH_UNREAD_KINDS.size).toBeGreaterThan(0);
        expect(sourceAppOnly(['excerptAdded'])).toBe(true);
        expect(sourceAppOnly(['excerptAdded', 'attachment'])).toBe(true);
        expect(sourceAppOnly(['excerptAdded', 'transcript'])).toBe(false);
        expect(sourceAppOnly(['added', 'excerptAdded'])).toBe(false);
        expect(sourceAppOnly([])).toBe(false);
        expect(coupleAppOnly(['childOrder'])).toBe(true);
        expect(coupleAppOnly(['childOrder', 'singleParent'])).toBe(false);
        expect(variantsAppOnly()).toBe(true);
    });

    it('places: only removed coordinates are unread', () => {
        expect(placesAppOnly([{ key: 'k', name: 'Kolín' }])).toBe(true);
        expect(placesAppOnly([{ key: 'k', name: 'Kolín', lat: 50, lon: 15 }])).toBe(false);
        expect(placesAppOnly([{ key: 'k', name: 'Kolín' }, { key: 'b', name: 'Brno', lat: 49, lon: 16 }])).toBe(false);
    });

    it('a research that reads everything: no row is app only', () => {
        const none = new Set<string>();
        expect(sourceAppOnly(['excerptAdded'], none)).toBe(false);
        expect(variantsAppOnly(none)).toBe(false);
    });
});

describe('what a send carried beyond the people', () => {
    const other: OtherChanges = {
        sources: [
            { sourceId: 's1', title: 'Matrika', kinds: ['transcript'], citedBy: { persons: 1 } },
            { sourceId: 's2', title: 'Sčítání', kinds: ['excerptAdded'], citedBy: { persons: 0 } },
            { sourceId: 's3', title: 'Pryč', kinds: ['deleted'], citedBy: { persons: 0 }, deleted: true },
        ],
        couples: [{ partnershipId: 'u1' as PartnershipId, p1: P('p1'), p2: P('p2'), kinds: ['mainMarriage'] }],
        places: { count: 2, items: [{ key: 'a', name: 'Kolín', lat: 50, lon: 15 }, { key: 'b', name: 'Brno' }] },
        surnameVariants: { count: 2, items: [{ surname: 'Fíšek', variant: 'Fischek' }, { surname: 'Fíšek', variant: 'Fišek' }] },
    };

    it('rows in the panel order, the unread ones marked', () => {
        const rows = sentOtherRows(other);
        expect(rows.map(r => `${r.type}:${r.id}:${r.appOnly ? 'app' : 'read'}`)).toEqual([
            'source:s1:read', 'source:s2:app', 'source:s3:read', 'couple:u1:app', 'places::read', 'variants::app',
        ]);
        expect(rows[2].deleted).toBe(true);
        expect(rows[5]).toMatchObject({ count: 2, surname: 'Fíšek' });
        expect(sentOtherRows(null)).toEqual([]);
    });

    it('a kept row comes back checked', () => {
        for (const r of sentOtherRows(other)) expect(sanitizeSentOtherRow(JSON.parse(JSON.stringify(r)))).toEqual(r);
        expect(sanitizeSentOtherRow({ type: 'person', id: 'x' })).toBeNull();
        expect(sanitizeSentOtherRow({ type: 'places', count: -1, kinds: [1, 'x'] })).toEqual({ type: 'places', id: '', title: '', kinds: ['x'] });
    });
});

describe('what the research did not write, paired', () => {
    const item = (x: Partial<NotWrittenItem>): NotWrittenItem => ({ person: '', fact: '', why: 'report', ...x });

    it('people by their number, sources by the app id from the send or the research number, places by name', () => {
        const { rows, unnamed } = pairNotWritten([
            item({ person: 'P0002', fact: 'BIRT' }),
            item({ source: '@S2@', sourceId: 's2' }),
            item({ source: 'S0012' }),
            item({ place: 'Kolín' }),
            item({ name: 'Jan Dvořák' }),
        ], tree());
        expect(rows.map(r => r.type)).toEqual(['person', 'source', 'source', 'places', 'person']);
        expect(rows[0]).toMatchObject({ personId: 'p2' });
        expect(rows[1]).toMatchObject({ sourceId: 's2', title: 'Sčítání lidu 1890' });
        expect(rows[2]).toMatchObject({ sourceId: 's1' });
        expect(rows[3]).toMatchObject({ place: 'Kolín' });
        expect(rows[4]).toMatchObject({ personId: null });
        expect(unnamed).toBe(0);
    });

    it('a family alone, a source the tree does not have, an older research: not named', () => {
        const { rows, unnamed } = pairNotWritten([
            item({ family: 'F0003' }),
            item({ source: 'S0999' }),
            item({ source: '@S7@', sourceId: 'gone' }),
            item({}),
        ], tree());
        expect(rows).toEqual([]);
        expect(unnamed).toBe(4);
    });

    it('a person the tree no longer has keeps a row', () => {
        const { rows } = pairNotWritten([item({ person: 'P0404', name: 'Eva' })], tree());
        expect(rows).toEqual([{ type: 'person', item: expect.objectContaining({ person: 'P0404' }), personId: null }]);
    });

    it('a person this send deleted (the archive kept it): paired with the deletion, by its number (audit 017 a-D2)', () => {
        const sent = [
            { personId: P('p9'), name: 'Petr Dvořák', kinds: ['deleted' as const], deleted: true as const, refn: 'P0009' },
            { personId: P('p1'), name: 'Karel Dvořák', kinds: ['name' as const] },
        ];
        const { rows } = pairNotWritten([item({ person: 'P0009', why: 'kept' })], tree(), sent);
        expect(rows).toEqual([{
            type: 'person', item: expect.objectContaining({ person: 'P0009' }), personId: 'p9', deleted: { name: 'Petr Dvořák' },
        }]);
        // A deletion with another number is not this item.
        expect(pairNotWritten([item({ person: 'P0010' })], tree(), sent).rows[0]).toMatchObject({ personId: null });
    });

    it('the reply carries the source and the place; a bad value is dropped', () => {
        const r = sanitizeSyncReply({ ok: true, notWritten: [
            { kind: 'source.transcript', source: 'S0012', why: 'report' },
            { kind: 'source.new', source: '@S12@' },
            { kind: 'place.coords', place: 'Kolín' },
            { kind: 'source.page', source: 'javascript:x' },
        ] });
        expect(r.notWritten.map(n => [n.source, n.place])).toEqual([['S0012', ''], ['@S12@', ''], ['', 'Kolín'], ['', '']]);
    });

    it('the sent file names a source by its xref: the app id back', () => {
        const xrefs = { persons: new Map(), sources: new Map([['s1', '@S12@'], ['s2', '@S13@']]) } as never;
        expect(sourceIdOfXref(xrefs, '@S13@')).toBe('s2');
        expect(sourceIdOfXref(xrefs, '@S99@')).toBe('');
    });
});

describe('what was not written, as kept', () => {
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

    it('keeps the source, its app id and the place', () => {
        store.set('strom-research-auto:t1', JSON.stringify({ notWritten: {
            at: '2026-10-20T10:00:00Z', fingerprint: 'f1', written: 3, unexplained: 0,
            items: [
                { person: '', fact: '', why: 'report', source: 'S0012' },
                { person: '', fact: '', why: '', source: '@S12@', sourceId: 's1' },
                { person: '', fact: '', why: '', place: 'Kolín' },
                { person: '', fact: '', why: '', source: '<b>' },
            ],
        } }));
        const items = researchAutoState('t1').notWritten!.items;
        expect(items[0].source).toBe('S0012');
        expect(items[1]).toMatchObject({ source: '@S12@', sourceId: 's1' });
        expect(items[2].place).toBe('Kolín');
        expect(items[3].source).toBeUndefined();
    });
});

describe('the sources of the research history', () => {
    const at = '2026-10-20T10:00:00Z';

    it('pairs sources with text lines, also when an empty line drops', () => {
        const [e] = sanitizeLiveLog({ entries: [{
            head: 'h1', at, task: '', what: ['x'],
            text: ['Nový pramen: Matrika', '', 'Nová osoba: Jan'],
            sources: [['S0012', 'S0012', 'bad', 7], ['S0001'], []],
        }] })!;
        expect(e.text).toEqual(['Nový pramen: Matrika', 'Nová osoba: Jan']);
        expect(e.sources).toEqual([['S0012'], []]);
    });

    it('an older research, a list of another length or with no source: no sources', () => {
        const log = sanitizeLiveLog({ entries: [
            { head: 'h1', at, what: ['x'], text: ['a'] },
            { head: 'h2', at, what: ['x'], text: ['a', 'b'], sources: [['S0001']] },
            { head: 'h3', at, what: ['x'], text: ['a'], sources: [[]] },
            { head: 'h4', at, what: ['x'], sources: [['S0001']] },
        ] })!;
        expect(log.map(e => e.sources)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('at most 20 sources a line; the change event carries them too', () => {
        const many = Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(4, '0')}`);
        const [e] = sanitizeLiveLog({ entries: [{ head: 'h', at, what: ['x'], text: ['t'], sources: [many] }] })!;
        expect(e.sources![0]).toHaveLength(20);
        const c = sanitizeLiveChange({ head: 'h', at, what: ['x'], entries: [{ head: 'h', at, what: ['x'], text: ['t'], sources: [['S0003']] }] })!;
        expect(c.entries![0].sources).toEqual([['S0003']]);
    });

    it('finds a source by the research number and its title in the line as the research shortens it', () => {
        const data = tree();
        expect(sourceIdsByRef(data).get('S0012')).toBe('s1');
        expect(sourceIdsByRef(data).size).toBe(1);
        const long = `Matrika ${'velmi '.repeat(20)}dlouhá`;
        expect(researchShortTitle(long)).toHaveLength(90);
        expect(researchShortTitle(long).endsWith('…')).toBe(true);
        expect(researchShortTitle('  Matrika\n Kolín ')).toBe('Matrika Kolín');
        const line = `Nový pramen: ${researchShortTitle(long)} (2 snímky)`;
        expect(findSourceTitle(line, long)).toEqual({ at: 13, length: 90 });
        expect(findSourceTitle('Přepis: Matrika  Kolín', 'Matrika Kolín')).toBeNull();
        expect(findSourceTitle('Přepis: Matrika Kolín', 'Matrika\nKolín')).toEqual({ at: 8, length: 13 });
        expect(findSourceTitle('x', '  ')).toBeNull();
    });

    it('a line newer than the loaded version: by the order of the history, else when a version waits', () => {
        const heads = ['h3', 'h2', 'h1'];
        expect(lineNewerThanLoaded('h3', heads, 'h2', false)).toBe(true);
        expect(lineNewerThanLoaded('h2', heads, 'h2', true)).toBe(false);
        expect(lineNewerThanLoaded('h1', heads, 'h2', true)).toBe(false);
        expect(lineNewerThanLoaded('h9', heads, 'h2', true)).toBe(true);
        expect(lineNewerThanLoaded('h3', heads, undefined, false)).toBe(false);
        expect(lineNewerThanLoaded('', heads, 'h2', false)).toBe(false);
    });
});
