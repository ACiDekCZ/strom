/**
 * Where a file of the tree is used (spec 102 §3): its places, portraits cut
 * from it, couple photos from its original and excerpts cut from it, in the
 * block's order, and how each is worded. Invented data.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mediaUses, mediaUsesIndex, mediaUseLabel, materialPersonLabel } from '../media-uses.js';
import { setLanguage, strings } from '../strings.js';
import type { Attachment, PartnershipId, PersonId, StromData } from '../types.js';

const pid = (id: string) => id as PersonId;
const uid = (id: string) => id as PartnershipId;
const SHA = 'b'.repeat(64);

function att(id: string, init: Partial<Attachment> = {}): Attachment {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', sizeBytes: 10, places: [], ...init };
}

function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) => ({
        id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
    });
    return {
        version: 24,
        persons: {
            p1: person('p1', 'Ivar', 'Pellström', {
                birthDate: '1898-03-02',
                photoSource: { attachmentId: 'm1', x: 0, y: 0, w: 1, h: 1 },
                events: [{ id: 'e1', type: 'occupation', date: '1925' }],
            }),
            p2: person('p2', 'Hedda', 'Vossberg', { gender: 'female' }),
        },
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], status: 'married',
                photo: 'data:image/jpeg;base64,AA==', photoOriginal: { sha256: SHA, name: 'wedding.jpg', mimeType: 'image/jpeg', bytes: 5 },
                events: [{ id: 'c1', type: 'engagement', date: '1923-05' }],
            },
        },
        sources: {
            s1: { id: 's1', title: 'Parish register Ödeby 1898', excerpts: [{ id: 'x1', dataUrl: 'data:,', width: 1, height: 1, sizeBytes: 1, fromAttachmentId: 'm1' }] },
        },
        media: {
            m1: att('m1', {
                original: { sha256: SHA, name: 'wedding.jpg', mimeType: 'image/jpeg', bytes: 5 },
                places: [
                    { sourceId: 's1' },
                    { personId: pid('p1'), fact: 'birth' },
                    { partnershipId: uid('u1'), eventId: 'c1' },
                    { personId: pid('p2') },
                    { personId: pid('p1') },
                    { personId: pid('p1'), eventId: 'e1' },
                ],
            }),
            m2: att('m2', { places: [{ partnershipId: uid('u1') }] }),
            m3: att('m3', { places: [], removed: { at: '2026-11-01T10:00:00.000Z', places: [{ personId: pid('p2') }] } }),
        },
    } as unknown as StromData;
}

describe('mediaUses', () => {
    beforeEach(() => setLanguage('en'));

    it('lists places, the portrait, the couple photo and the excerpt in the block’s order', () => {
        const uses = mediaUses(tree(), 'm1');
        expect(uses.map(u => u.kind)).toEqual(['person', 'person', 'portrait', 'couple', 'event', 'event', 'event', 'source', 'excerpt']);
        expect(uses.slice(0, 2).map(u => u.personId)).toEqual(['p2', 'p1']);
        expect(uses[2]).toEqual({ kind: 'portrait', personId: 'p1' });
        // The couple photo is not a place of the file: nothing to take off.
        expect(uses[3]).toEqual({ kind: 'couple', partnershipId: 'u1', couplePhoto: true });
        expect(uses[4]).toMatchObject({ kind: 'event', personId: 'p1', fact: 'birth', place: { personId: 'p1', fact: 'birth' } });
        expect(uses[5]).toMatchObject({ kind: 'event', partnershipId: 'u1', eventId: 'c1' });
        expect(uses[8]).toEqual({ kind: 'excerpt', sourceId: 's1', excerptId: 'x1' });
    });

    it('a couple that is also a place keeps its place and says the photo is from the file', () => {
        const data = tree();
        data.media!.m1.places.push({ partnershipId: uid('u1') });
        const couple = mediaUses(data, 'm1').filter(u => u.kind === 'couple');
        expect(couple).toEqual([{ kind: 'couple', place: { partnershipId: 'u1' }, partnershipId: 'u1', couplePhoto: true }]);
    });

    it('a file taken out of the tree is used nowhere; an unknown id neither', () => {
        expect(mediaUses(tree(), 'm3')).toEqual([]);
        expect(mediaUses(tree(), 'nope')).toEqual([]);
    });

    it('the index gives every file’s uses in one pass, the same as one by one', () => {
        const data = tree();
        const index = mediaUsesIndex(data);
        expect(index.get('m1')).toEqual(mediaUses(data, 'm1'));
        expect(index.get('m2')).toEqual([{ kind: 'couple', place: { partnershipId: 'u1' }, partnershipId: 'u1' }]);
        expect(index.has('m3')).toBe(false);
    });
});

describe('mediaUseLabel', () => {
    beforeEach(() => setLanguage('en'));

    it('words each use: the person, the event with its year and people, the source and what the file is to it', () => {
        const data = tree();
        const labels = mediaUses(data, 'm1').map(u => mediaUseLabel(data, u));
        const m = strings.materials;
        expect(labels[0]).toEqual({ type: m.usedType.person, text: 'Hedda Vossberg', person: true });
        expect(labels[2]).toEqual({ type: m.usedType.portrait, text: 'Ivar Pellström', sub: m.portraitCut, person: true });
        expect(labels[3]).toEqual({ type: m.usedType.couple, text: 'Ivar Pellström and Hedda Vossberg', sub: m.couplePhoto });
        expect(labels[4].text).toBe('Birth 1898 · Ivar Pellström');
        expect(labels[5].text).toBe(`${strings.partnerEvents.types.engagement} 1923 · Ivar Pellström and Hedda Vossberg`);
        expect(labels[6].text).toBe(`${strings.events.types.occupation} 1925 · Ivar Pellström`);
        expect(labels[7]).toEqual({ type: m.usedType.source, text: 'Parish register Ödeby 1898', sub: m.docOf });
        expect(labels[8]).toEqual({ type: m.usedType.excerpt, text: 'Parish register Ödeby 1898', sub: m.excerptCut });
    });

    it('a source cited at a birth: "evidence · cited at Birth" (5d)', () => {
        const data = tree();
        const person = Object.values(data.persons)[0];
        const sourceId = mediaUses(data, 'm1').find(u => u.kind === 'source')!.sourceId!;
        person.birthSourceIds = [sourceId];
        const label = mediaUseLabel(data, mediaUses(data, 'm1').find(u => u.kind === 'source')!);
        expect(label.sub).toBe('evidence · cited at Birth');
        setLanguage('cs');
        expect(mediaUseLabel(data, mediaUses(data, 'm1').find(u => u.kind === 'source')!).sub).toBe('doklad · citace u Narození');
        setLanguage('en');
    });

    it('in Czech', () => {
        setLanguage('cs');
        const data = tree();
        const [first, , , couple] = mediaUses(data, 'm1').map(u => mediaUseLabel(data, u));
        expect(first.type).toBe('Osoba');
        expect(couple.text).toBe('Ivar Pellström a Hedda Vossberg');
        expect(couple.sub).toBe('fotka svazku');
        setLanguage('en');
    });

    it('a person the records do not name ("?") reads "Unknown person", also in a couple; the years stay', () => {
        const data = tree();
        Object.assign(data.persons['p2' as PersonId], { firstName: '?', lastName: '', isPlaceholder: true });
        const labels = mediaUses(data, 'm1').map(u => mediaUseLabel(data, u));
        expect(labels.find(l => l.type === strings.materials.usedType.person && l.text !== 'Ivar Pellström')?.text).toBe('Unknown person');
        expect(labels.find(l => l.type === strings.materials.usedType.couple)?.text).toBe('Ivar Pellström and Unknown person');
        expect(materialPersonLabel('? (1850–1902)')).toBe('Unknown person (1850–1902)');
        expect(materialPersonLabel('')).toBe('Unknown person');
        expect(materialPersonLabel('? Novák')).toBe('? Novák');
        setLanguage('cs');
        expect(materialPersonLabel('?')).toBe('Neznámá osoba');
        setLanguage('en');
    });
});
