/**
 * Granular export content (R8): the composable strip functions
 * (stripNotes / stripSources, plus stripPhotos / stripAttachments composed by
 * applyContentOptions) and the preset logic.
 *
 * Roundtrip-safe / whitelist-guard convention (mirrors whitelist-guard.test.ts):
 * a strip function must remove ONLY its own category and leave every unrelated
 * field untouched. The fixtures below carry every strippable field of every
 * category at once, so a strip that reaches too far is caught here.
 */

import { describe, it, expect } from 'vitest';
import {
    ContentOptions,
    ALL_CONTENT,
    CONTENT_PRESETS,
    matchContentPreset,
    resolveContentOptions,
    applyContentOptions,
    stripNotes,
    stripSources,
} from '../privacy.js';
import { stripPhotos } from '../photo.js';
import { stripAttachments } from '../attachments.js';
import {
    StromData, Person, Partnership, PersonId, PartnershipId,
    toPersonId, toPartnershipId,
} from '../types.js';

const ALICE = toPersonId('p_alice');
const BOB = toPersonId('p_bob');
const UNION = toPartnershipId('u_alice_bob');

/**
 * A tree in which every strippable field of every category is populated on a
 * single person / partnership: photo, attachment (with a sourceId link), person
 * notes + sourceIds, an event with a note, sourceIds and a participant note, and
 * a partnership with a note + sourceIds. Plus a live source catalog.
 */
function richTree(): StromData {
    const alice: Person = {
        id: ALICE, firstName: 'Alice', lastName: 'Novak', gender: 'female',
        isPlaceholder: false, partnerships: [UNION], parentIds: [], childIds: [],
        birthDate: '1900', birthPlace: 'Kolín',
        notes: 'Kept bees.',
        photo: 'data:image/jpeg;base64,AAAA',
        photoOriginalName: 'alice.jpg',
        sourceIds: ['s1'],
        attachments: [{
            id: 'a1', name: 'letter.pdf', mimeType: 'application/pdf',
            dataUrl: 'data:application/pdf;base64,BBBB', sizeBytes: 4,
            note: 'A letter.', sourceId: 's1',
        }],
        events: [{
            id: 'e1', type: 'baptism', date: '1900', note: 'In the village church.',
            sourceIds: ['s1'],
            participants: [{ id: 'pt1', role: 'godparent', name: 'Neighbour', note: 'the blacksmith' }],
        }],
    };
    const bob: Person = {
        id: BOB, firstName: 'Bob', lastName: 'Novak', gender: 'male',
        isPlaceholder: false, partnerships: [UNION], parentIds: [], childIds: [],
    };
    const union: Partnership = {
        id: UNION, person1Id: BOB, person2Id: ALICE, childIds: [], status: 'married',
        note: 'Married in spring.', sourceIds: ['s1'],
    };
    return {
        persons: { [ALICE]: alice, [BOB]: bob },
        partnerships: { [UNION]: union },
        sources: { s1: { id: 's1', title: 'Parish register, Kolín', quality: 3 } },
    };
}

const alice = (d: StromData) => d.persons[ALICE];
const union = (d: StromData) => d.partnerships[UNION];

describe('stripNotes', () => {
    it('removes every note but nothing else', () => {
        const src = richTree();
        const out = stripNotes(src);
        expect(alice(out).notes).toBeUndefined();
        expect(alice(out).events?.[0].note).toBeUndefined();
        expect(alice(out).events?.[0].participants?.[0].note).toBeUndefined();
        expect(union(out).note).toBeUndefined();
        // Unrelated fields survive.
        expect(alice(out).photo).toBeDefined();
        expect(alice(out).attachments).toHaveLength(1);
        expect(alice(out).sourceIds).toEqual(['s1']);
        expect(alice(out).events?.[0].sourceIds).toEqual(['s1']);
        expect(out.sources?.s1).toBeDefined();
        expect(alice(out).events?.[0].participants?.[0].name).toBe('Neighbour');
    });

    it('does not mutate the input', () => {
        const src = richTree();
        stripNotes(src);
        expect(alice(src).notes).toBe('Kept bees.');
        expect(union(src).note).toBe('Married in spring.');
    });
});

describe('stripSources', () => {
    it('removes the catalog and every citation link but nothing else', () => {
        const src = richTree();
        const out = stripSources(src);
        expect(out.sources).toBeUndefined();
        expect(alice(out).sourceIds).toBeUndefined();
        expect(alice(out).events?.[0].sourceIds).toBeUndefined();
        expect(alice(out).attachments?.[0].sourceId).toBeUndefined();
        expect(union(out).sourceIds).toBeUndefined();
        // Unrelated fields survive, including the attachment payload + note.
        expect(alice(out).notes).toBe('Kept bees.');
        expect(alice(out).photo).toBeDefined();
        expect(alice(out).attachments?.[0].dataUrl).toBeDefined();
        expect(alice(out).attachments?.[0].note).toBe('A letter.');
        expect(union(out).note).toBe('Married in spring.');
    });

    it('does not mutate the input', () => {
        const src = richTree();
        stripSources(src);
        expect(src.sources?.s1).toBeDefined();
        expect(alice(src).sourceIds).toEqual(['s1']);
        expect(alice(src).attachments?.[0].sourceId).toBe('s1');
    });
});

describe('resolveContentOptions', () => {
    it('maps the legacy boolean flag', () => {
        expect(resolveContentOptions(false)).toEqual(ALL_CONTENT);
        expect(resolveContentOptions(true)).toEqual({ photos: false, attachments: false, notes: true, sources: true });
    });
    it('passes ContentOptions through unchanged', () => {
        const opts: ContentOptions = { photos: false, attachments: true, notes: false, sources: true };
        expect(resolveContentOptions(opts)).toBe(opts);
    });
});

describe('applyContentOptions', () => {
    it('all-on returns an equal but independent copy', () => {
        const src = richTree();
        const out = applyContentOptions(src, ALL_CONTENT);
        expect(out).toEqual(src);
        expect(out).not.toBe(src);
        expect(out.persons[ALICE]).not.toBe(src.persons[ALICE]);
    });

    it('all-off (skeleton) drops all four categories, keeps structure', () => {
        const out = applyContentOptions(richTree(), CONTENT_PRESETS.skeleton);
        expect(alice(out).photo).toBeUndefined();
        expect(alice(out).photoOriginalName).toBeUndefined();
        expect(alice(out).attachments).toBeUndefined();
        expect(alice(out).notes).toBeUndefined();
        expect(alice(out).sourceIds).toBeUndefined();
        expect(out.sources).toBeUndefined();
        // Structure and identity survive.
        expect(alice(out).firstName).toBe('Alice');
        expect(alice(out).birthDate).toBe('1900');
        expect(alice(out).partnerships).toEqual([UNION]);
        expect(union(out).status).toBe('married');
    });

    it('"small file to send" keeps text, drops media', () => {
        const out = applyContentOptions(richTree(), CONTENT_PRESETS.small);
        expect(alice(out).photo).toBeUndefined();
        expect(alice(out).attachments).toBeUndefined();
        expect(alice(out).notes).toBe('Kept bees.');
        expect(out.sources?.s1).toBeDefined();
        expect(alice(out).sourceIds).toEqual(['s1']);
    });

    it('selectively keeps photos only', () => {
        const out = applyContentOptions(richTree(), { photos: true, attachments: false, notes: false, sources: false });
        expect(alice(out).photo).toBeDefined();
        expect(alice(out).attachments).toBeUndefined();
        expect(alice(out).notes).toBeUndefined();
        expect(out.sources).toBeUndefined();
    });

    it('accepts the legacy boolean flag', () => {
        const out = applyContentOptions(richTree(), true);
        expect(alice(out).photo).toBeUndefined();
        expect(alice(out).attachments).toBeUndefined();
        expect(alice(out).notes).toBe('Kept bees.');
    });
});

describe('content presets', () => {
    it('stripPhotos and stripAttachments are the media half of the presets', () => {
        // Sanity: composing the two dedicated helpers equals the media strip.
        const media = stripAttachments(stripPhotos(richTree()));
        expect(alice(media).photo).toBeUndefined();
        expect(alice(media).attachments).toBeUndefined();
        expect(alice(media).notes).toBe('Kept bees.');
    });

    it('matchContentPreset recognises each preset pattern', () => {
        expect(matchContentPreset(CONTENT_PRESETS.complete)).toBe('complete');
        expect(matchContentPreset(CONTENT_PRESETS.small)).toBe('small');
        expect(matchContentPreset(CONTENT_PRESETS.skeleton)).toBe('skeleton');
        expect(matchContentPreset(ALL_CONTENT)).toBe('complete');
    });

    it('matchContentPreset returns null for a custom mix', () => {
        expect(matchContentPreset({ photos: true, attachments: false, notes: true, sources: false })).toBeNull();
        expect(matchContentPreset({ photos: false, attachments: true, notes: false, sources: false })).toBeNull();
    });
});
