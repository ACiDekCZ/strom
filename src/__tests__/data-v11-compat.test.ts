/**
 * Data format 10 -> 11 (Strom 3.8 -> 3.9). The step is additive: a v10 tree
 * (as 3.8.1 writes it) loads with nothing transformed and nothing lost, and
 * every field 3.9 adds survives every load path of the newer app and a
 * change packet between two 3.9 users. Also pins the two numbers an older
 * app checks against — the data version and the IndexedDB schema version —
 * so that bumping either is a conscious decision (see the 3.9 pre-release
 * notes: 3.8.1 cannot open the browser storage once 3.9 upgraded it).
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { migrateData } from '../data.js';
import { validateJsonImport } from '../merge/validation.js';
import { buildChangePacket, applyPacketOntoData, applyChangePacket } from '../share-diff.js';
import { StromData, STROM_DATA_VERSION } from '../types.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SHA = 'ab'.repeat(32);

/** A tree in the shape 3.8.1 stores and exports (data version 10). */
function v10Tree(): StromData {
    return {
        version: 10,
        persons: {
            p1: {
                id: 'p1', firstName: 'Jan', lastName: 'Zkoušek', gender: 'male', isPlaceholder: false,
                partnerships: ['u1'], parentIds: [], childIds: ['p3'],
                birthDate: '1890-03-04', birthPlace: 'Brno', birthSourceIds: ['s1'], birthAddress: 'Brno 12',
                deathDate: '1950', deathCause: 'stáří', deathAge: '60 let',
                photo: PNG,
                events: [{ id: 'e1', type: 'residence', date: '1920', place: 'Praha', sourceIds: ['s1'], address: 'Praha 5' }],
                attachments: [{ id: 'a1', name: 'page.png', mimeType: 'image/png', dataUrl: PNG, sizeBytes: 70, note: 'scan', sourceId: 's1' }],
                story: { text: 'Kovář z Brna.' },
            },
            p2: {
                id: 'p2', firstName: 'Marie', lastName: 'Zkoušková', gender: 'female', isPlaceholder: false,
                partnerships: ['u1'], parentIds: [], childIds: ['p3'],
            },
            p3: {
                id: 'p3', firstName: 'Karel', lastName: 'Zkoušek', gender: 'male', isPlaceholder: false,
                partnerships: [], parentIds: ['p1', 'p2'], childIds: [], parentRelTypes: { p2: 'adoptive' },
            },
        },
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: ['p3'], status: 'married',
                startDate: '1915-05-06', startPlace: 'Brno', address: 'Brno 12', ages: { p1: '25' },
                sourceIds: ['s1'], participants: [{ name: 'Josef Svědek', role: 'witness' }],
                events: [{ id: 'ce1', type: 'banns', date: '1915-04', place: 'Brno', sourceIds: ['s1'] }],
            },
        },
        sources: {
            s1: {
                id: 's1', title: 'Matrika Brno 1915', repository: 'MZA Brno', reference: 'sig. 1',
                transcript: 'Jan Zkoušek a Marie oddáni', recordDate: '1915-05-06',
                excerpts: [{ id: 'x1', dataUrl: PNG, width: 1, height: 1, sizeBytes: 70, caption: 'zápis' }],
            },
        },
        places: { brno: { lat: 49.19, lon: 16.61 } },
        surnameVariants: [['Zkoušek', 'Zkousek']],
    } as unknown as StromData;
}

/** The same tree with every field 3.9 added on top (data version 11). */
function v11Tree(): StromData {
    const d = v10Tree() as unknown as Record<string, any>;
    d.version = 11;
    d.sources.s1.transcriptVerified = true;
    d.sources.s1.readBy = 'both';
    d.sources.s1.excerpts[0].originalSha = SHA;
    d.sources.s1.excerpts[0].orient = 6;
    d.persons.p1.birthStatus = 'proven';
    d.persons.p1.deathStatus = 'lead';
    d.persons.p1.events[0].status = 'possible';
    d.persons.p1.attachments[0].original = { sha256: SHA, name: 'page.tif', mimeType: 'image/tiff', bytes: 1234, orientation: 6 };
    d.persons.p1.attachments.push({
        id: 'a2', name: 'scan.tif', mimeType: 'image/tiff', dataUrl: '', sizeBytes: 0, originalOnly: true,
        original: { sha256: SHA, name: 'scan.tif', mimeType: 'image/tiff', bytes: 99999 },
    });
    d.partnerships.u1.startStatus = 'probable';
    d.partnerships.u1.endStatus = 'lead';
    d.partnerships.u1.events[0].status = 'proven';
    return d as unknown as StromData;
}

/** The tree without its version stamp (migrateData does not carry it; saving re-stamps it). */
function unstamped(d: StromData): StromData {
    const { version: _v, ...rest } = structuredClone(d) as StromData & { version?: number };
    return rest as StromData;
}

describe('data format 10 -> 11', () => {
    it('pins the versions an older app compares against', () => {
        // 3.8.1 knows data version 10 and IndexedDB schema 5. Raising either
        // decides what an older app does with this one's data (see header).
        expect(STROM_DATA_VERSION).toBe(11);
        // An older build opens IndexedDB with its own, lower version and fails
        // (VersionError) — the whole app, also an older exported HTML file.
        const storage = readFileSync(new URL('../storage.ts', import.meta.url), 'utf8');
        expect(storage).toMatch(/const DB_VERSION = 7;/);
    });

    it('a 3.8.1 (v10) tree loads unchanged: nothing transformed, nothing lost', () => {
        const before = v10Tree();
        const loaded = migrateData(structuredClone(before));
        expect(loaded).toEqual(unstamped(before));
    });

    it('a 3.8.1 (v10) JSON file imports without a warning and with every field kept', () => {
        const before = v10Tree();
        const r = validateJsonImport(JSON.stringify(before));
        expect(r.valid).toBe(true);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.data).toEqual(unstamped(before));
    });

    it('every field 3.9 adds survives a load and an import (additive step)', () => {
        const before = v11Tree();
        expect(migrateData(structuredClone(before))).toEqual(unstamped(before));
        const r = validateJsonImport(JSON.stringify(before));
        expect(r.warnings).toEqual([]);
        expect(r.data).toEqual(unstamped(before));
    });

    it('an only-original attachment and the source marks travel in a change packet between 3.9 users', () => {
        const base = v10Tree();
        const current = v11Tree();
        const packet = buildChangePacket(base, current, { baseExportId: 'exp_test' });
        // The packet carries no data version: an older recipient is not warned.
        expect(JSON.stringify(packet)).not.toContain('"version"');

        const rebuilt = applyChangePacket(base, packet);
        expect(rebuilt.sources?.s1.transcriptVerified).toBe(true);
        expect(rebuilt.sources?.s1.readBy).toBe('both');

        const accepted = applyPacketOntoData(structuredClone(base), packet, base);
        const p1 = accepted.persons['p1' as keyof typeof accepted.persons];
        expect(p1.birthStatus).toBe('proven');
        expect(p1.attachments?.map(a => a.id)).toEqual(['a1', 'a2']);
        expect(p1.attachments?.[1].originalOnly).toBe(true);
        expect(accepted.sources?.s1.transcriptVerified).toBe(true);
        expect(accepted.sources?.s1.readBy).toBe('both');
        // ...and a load after accepting keeps the only-original attachment.
        expect(migrateData(accepted).persons['p1' as keyof typeof accepted.persons].attachments).toHaveLength(2);
    });
});
