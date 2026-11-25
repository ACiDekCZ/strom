/**
 * The pictures and files only the browser keeps (spec 108 K1b.1): the
 * fingerprint the "only in browser" indicator compares with the last file
 * copy on a tree linked to Strom Research, and whether its archive keeps them (U8).
 */
import { describe, it, expect } from 'vitest';
import { browserMediaFingerprint, browserMediaSafe, archiveHoldsAppMedia } from '../browser-media.js';
import { personFilesAnyVersion } from '../media.js';
import { mediaToken, fnvHash } from '../image-meta.js';
import type { PersonId, StromData } from '../types.js';

const img = (fill: string, n = 4000) => `data:image/jpeg;base64,${fill.repeat(n)}`;

function tree(over: { photo?: string; attachments?: unknown[]; couple?: string } = {}): StromData {
    return {
        version: 23,
        persons: {
            P1: { id: 'P1', firstName: 'Jan', lastName: 'Novák', gender: 'male', partnerships: ['U1'], parentIds: [], childIds: [],
                ...(over.photo ? { photo: over.photo } : {}), ...(over.attachments ? { attachments: over.attachments } : {}) },
            P2: { id: 'P2', firstName: 'Marie', lastName: 'Nováková', gender: 'female', partnerships: ['U1'], parentIds: [], childIds: [] },
        },
        partnerships: {
            U1: { id: 'U1', person1Id: 'P1', person2Id: 'P2', childIds: [], ...(over.couple ? { photo: over.couple } : {}) },
        },
    } as unknown as StromData;
}

const att = (id: string, dataUrl: string, note?: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl, sizeBytes: dataUrl.length, ...(note ? { note } : {}) });

describe('browserMediaFingerprint', () => {
    it('is empty for a tree without portraits, couple photos or attachments', () => {
        expect(browserMediaFingerprint(tree())).toBe('');
    });

    it('counts a portrait, a couple photo and an attachment', () => {
        expect(browserMediaFingerprint(tree({ photo: img('A') }))).not.toBe('');
        expect(browserMediaFingerprint(tree({ couple: img('B') }))).not.toBe('');
        expect(browserMediaFingerprint(tree({ attachments: [att('a1', img('C'))] }))).not.toBe('');
    });

    it('changes with a new picture, a re-cropped one (other length) or another attachment', () => {
        const base = browserMediaFingerprint(tree({ photo: img('A'), attachments: [att('a1', img('C'))] }));
        expect(browserMediaFingerprint(tree({ photo: img('D'), attachments: [att('a1', img('C'))] }))).not.toBe(base);
        expect(browserMediaFingerprint(tree({ photo: img('A', 3999), attachments: [att('a1', img('C'))] }))).not.toBe(base);
        expect(browserMediaFingerprint(tree({ photo: img('A'), attachments: [att('a1', img('C')), att('a2', img('E'))] }))).not.toBe(base);
        expect(browserMediaFingerprint(tree({ photo: img('A') }))).not.toBe(base);
    });

    it('stays the same for the same pictures in a copy, and for an attachment note', () => {
        const base = browserMediaFingerprint(tree({ photo: img('A'), attachments: [att('a1', img('C'))], couple: img('B') }));
        expect(browserMediaFingerprint(structuredClone(tree({ photo: img('A'), attachments: [att('a1', img('C'), 'note')], couple: img('B') })))).toBe(base);
    });

    it('leaves out an attachment that is only its original (kept by the research)', () => {
        const onlyOriginal = { ...att('a1', ''), originalOnly: true, original: { sha256: 'f'.repeat(64), bytes: 9 } };
        expect(browserMediaFingerprint(tree({ attachments: [onlyOriginal] }))).toBe('');
    });
});

/** The fingerprint as it was computed before: every record of the tree read again for each person. */
function fingerprintBefore(data: StromData): string {
    const parts: string[] = [];
    for (const id of Object.keys(data.persons ?? {}).sort()) {
        const p = data.persons[id as keyof typeof data.persons];
        if (!p) continue;
        const atts = personFilesAnyVersion(data, id as PersonId).filter(a => a.dataUrl);
        if (!p.photo && atts.length === 0) continue;
        parts.push(`p${id}:${mediaToken(p.photo)}:${atts.map(a => `${a.id}=${mediaToken(a.dataUrl)}`).join(',')}`);
    }
    for (const id of Object.keys(data.partnerships ?? {}).sort()) {
        const photo = data.partnerships[id as keyof typeof data.partnerships]?.photo;
        if (photo) parts.push(`u${id}:${mediaToken(photo)}`);
    }
    if (parts.length === 0) return '';
    const text = parts.join('|');
    return `${parts.length.toString(36)}-${fnvHash(text, 0, 1, 0x811c9dc5).toString(36)}-${fnvHash(text, 0, 1, 0x01000193).toString(36)}`;
}

/** A research of `n` people with a file per person and more (v24: the files in data.media, each with its places). */
function bigTree(n: number): StromData {
    const persons: Record<string, unknown> = {};
    const media: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
        const id = `P${i}`;
        persons[id] = { id, firstName: `Osoba${i}`, lastName: 'Mlýnková', gender: i % 2 ? 'male' : 'female', partnerships: [], parentIds: [], childIds: [],
            ...(i % 3 === 0 ? { photo: img(String.fromCharCode(65 + (i % 26)), 50 + i) } : {}),
            // A tree of v23 and older keeps its attachments on the person: read as they are.
            ...(i % 97 === 5 ? { attachments: [att(`L${i}`, img('L', 60 + i))] } : {}) };
        const places: unknown[] = [{ personId: id }];
        // A fact of theirs too (the same person once), another person, a source, nothing (taken out).
        if (i % 4 === 1) places.push({ personId: id, fact: 'birth' });
        if (i % 5 === 2) places.push({ personId: `P${(i + 7) % n}` });
        if (i % 6 === 3) places.push({ sourceId: `S${i}` });
        media[`M${i}`] = { ...att(`M${i}`, i % 11 === 4 ? '' : img(String.fromCharCode(97 + (i % 26)), 40 + i)), places: i % 13 === 7 ? [] : places };
        if (i % 9 === 0) media[`X${i}`] = { ...att(`X${i}`, img('X', 30 + i)), places: [{ sourceId: `S${i}` }] };
    }
    return { version: 24, persons, partnerships: {}, media } as unknown as StromData;
}

describe('browserMediaFingerprint of a big research (a phone opening it, every save)', () => {
    it('is exactly the fingerprint it was before', () => {
        for (const n of [0, 1, 7, 40, 300]) {
            const data = bigTree(n);
            expect(browserMediaFingerprint(data)).toBe(fingerprintBefore(data));
        }
    });

    it('reads the records of the tree once, not once per person', () => {
        const data = bigTree(400);
        let reads = 0;
        data.media = new Proxy(data.media!, { ownKeys(t) { reads++; return Reflect.ownKeys(t); } });
        browserMediaFingerprint(data);
        expect(reads).toBeLessThanOrEqual(2);
    });
});

describe('browserMediaSafe', () => {
    it('is safe without pictures, or when the last file copy carried exactly these', () => {
        expect(browserMediaSafe('', undefined, false)).toBe(true);
        expect(browserMediaSafe('x', 'x', false)).toBe(true);
    });

    it('is not safe for pictures no file copy holds', () => {
        expect(browserMediaSafe('x', undefined, false)).toBe(false);
        expect(browserMediaSafe('x', 'y', false)).toBe(false);
        expect(browserMediaSafe('x', '', false)).toBe(false);
    });

    // An index saved before spec 108 knows no fingerprint of a tree not read since (N1): not counted against it.
    it('does not count a tree whose pictures are not known against it', () => {
        expect(browserMediaSafe(undefined, undefined, false)).toBe(true);
        expect(browserMediaSafe(undefined, 'x', false)).toBe(true);
    });

    it('is safe whenever the tree\'s archive keeps its pictures (spec 108 U8)', () => {
        expect(browserMediaSafe('x', undefined, true)).toBe(true);
        expect(browserMediaSafe('x', 'y', true)).toBe(true);
    });
});

describe('archiveHoldsAppMedia (spec 108 K2.6: per tree, not a switch)', () => {
    it('holds once a write handed the files to a research that keeps them', () => {
        expect(archiveHoldsAppMedia({ keeps: true, researchId: 'R1', sentTo: 'R1' })).toBe(true);
        // Not asked in this page yet: its word at the write stands.
        expect(archiveHoldsAppMedia({ keeps: null, researchId: 'R1', sentTo: 'R1' })).toBe(true);
    });

    it('does not hold before such a write, after one to another research, or for a research without media.app', () => {
        expect(archiveHoldsAppMedia({ keeps: true, researchId: 'R1', sentTo: undefined })).toBe(false);
        expect(archiveHoldsAppMedia({ keeps: true, researchId: 'R1', sentTo: 'R0' })).toBe(false);
        expect(archiveHoldsAppMedia({ keeps: false, researchId: 'R1', sentTo: 'R1' })).toBe(false);
        expect(archiveHoldsAppMedia({ keeps: null, researchId: '', sentTo: '' })).toBe(false);
    });
});
