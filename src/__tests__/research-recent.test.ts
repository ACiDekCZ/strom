/**
 * "Last 24 h" of the research overview: the bridge's own count
 * (`/status.recent`, read only with `status.recent` in `features`), checked
 * as untrusted input, plus what came after its head; without it the count of
 * the research's history (/log) as before. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeLiveStatus, sanitizeLiveRecent, recentAddsCount, LiveRecent, LiveCommitAdds } from '../research-link.js';

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const HEAD = 'bd2885d0e51183f1af6c5648f4dd262e57e3bf3a';
const FROM = '17021a256b91f5e5af9be6568ad4440e6cffa95f';

function recent(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        hours: 24,
        since: '2026-10-08T12:11:38.987Z',
        from: FROM,
        head: HEAD,
        at: '2026-10-09T12:11:38.987Z',
        commits: 978,
        persons: { added: 17, ids: ['P0102', 'P0103'] },
        sources: { added: 4, ids: ['S0031'] },
        ...over,
    };
}

const status = (r: unknown, features: unknown = ['status.recent', 'sync.takenBack']) =>
    sanitizeLiveStatus({ tree: { id: UUID, name: 'Víškovi' }, head: HEAD, features, recent: r });

describe('/status.recent is untrusted', () => {
    it('a valid summary is kept as sent', () => {
        expect(sanitizeLiveRecent(recent())).toEqual({
            hours: 24, since: '2026-10-08T12:11:38.987Z', from: FROM, head: HEAD, at: '2026-10-09T12:11:38.987Z',
            commits: 978, persons: { added: 17, ids: ['P0102', 'P0103'] }, sources: { added: 4, ids: ['S0031'] },
        });
        expect(status(recent())!.recent?.persons.added).toBe(17);
    });

    it('from may be null (a research younger than the window)', () => {
        expect(sanitizeLiveRecent(recent({ from: null }))?.from).toBeNull();
    });

    it('added counts all, the ids at most 50', () => {
        const ids = Array.from({ length: 50 }, (_, i) => `P${String(100 + i).padStart(4, '0')}`);
        expect(sanitizeLiveRecent(recent({ persons: { added: 120, ids } }))?.persons).toEqual({ added: 120, ids });
        expect(sanitizeLiveRecent(recent({ persons: { added: 120, ids: [...ids, 'P0999'] } }))).toBeNull();
    });

    it.each([
        ['hours negative', { hours: -1 }],
        ['hours not whole', { hours: 24.5 }],
        ['hours a string', { hours: '24' }],
        ['commits missing', { commits: undefined }],
        ['commits negative', { commits: -3 }],
        ['since not a time', { since: 'yesterday' }],
        ['at missing', { at: undefined }],
        ['from not a hash', { from: 'main' }],
        ['from missing', { from: undefined }],
        ['head not a hash', { head: 'h2' }],
        ['head null', { head: null }],
        ['persons.added negative', { persons: { added: -1, ids: [] } }],
        ['persons.added not whole', { persons: { added: 1.5, ids: [] } }],
        ['persons.ids missing', { persons: { added: 1 } }],
        ['a source id among the persons', { persons: { added: 2, ids: ['P0102', 'S0031'] } }],
        ['a person id among the sources', { sources: { added: 1, ids: ['P0102'] } }],
        ['an id with junk', { persons: { added: 1, ids: ['P0102 <b>'] } }],
        ['sources missing', { sources: undefined }],
    ])('%s: as if absent', (_, over) => {
        expect(sanitizeLiveRecent(recent(over))).toBeNull();
        expect(status(recent(over))!.recent).toBeNull();
    });

    it('not an object: absent', () => {
        expect(sanitizeLiveRecent(null)).toBeNull();
        expect(sanitizeLiveRecent([recent()])).toBeNull();
        expect(sanitizeLiveRecent('17')).toBeNull();
    });

    it('read only when the bridge lists status.recent in its features', () => {
        expect(status(recent(), ['sync.takenBack'])!.recent).toBeNull();
        expect(status(recent(), null)!.recent).toBeNull();
        expect(status(undefined)!.recent).toBeNull();
    });
});

describe('"Last 24 h" count', () => {
    const now = Date.parse('2026-10-09T12:20:00Z');
    const ago = (min: number) => new Date(now - min * 60_000).toISOString();
    const DAY = 24 * 60 * 60_000;
    const r = sanitizeLiveRecent(recent()) as LiveRecent;
    // Newest first, as the session keeps them.
    const adds: LiveCommitAdds[] = [
        { head: 'c3c3c3c3c3', at: ago(1), persons: 1, sources: 0 },
        { head: 'b2b2b2b2b2', at: ago(3), persons: 2, sources: 1 },
        { head: HEAD, at: ago(8), persons: 1, sources: 0 },
        { head: 'a1a1a1a1a1', at: ago(60), persons: 3, sources: 1 },
        { head: 'a0a0a0a0a0', at: ago(25 * 60), persons: 5, sources: 2 },
    ];

    it('the bridge count alone when nothing came after its head', () => {
        expect(recentAddsCount(r, adds.slice(2), now, DAY)).toEqual({ persons: 17, sources: 4 });
    });

    it('plus the commits newer than its head', () => {
        expect(recentAddsCount(r, adds, now, DAY)).toEqual({ persons: 20, sources: 5 });
    });

    it('its head not among the commits: nothing added (the next status catches up)', () => {
        expect(recentAddsCount(r, adds.filter(a => a.head !== HEAD), now, DAY)).toEqual({ persons: 17, sources: 4 });
        expect(recentAddsCount(r, [], now, DAY)).toEqual({ persons: 17, sources: 4 });
    });

    it('without it: the history younger than the window, as before', () => {
        expect(recentAddsCount(null, adds, now, DAY)).toEqual({ persons: 7, sources: 2 });
    });
});
