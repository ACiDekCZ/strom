/**
 * Connecting a file the GEDCOM only names (ExternalMediaRef) to the freshly
 * converted data: an image becomes the person's portrait (the first one) or an
 * image attachment, a PDF a document; a family's picture becomes the couple's
 * photo (spec 107), shrunk like an attachment because portraits are cut from it.
 *
 * The readers turning a file into a data URL are passed in (canvas work in the
 * browser), so the decisions here stay testable without one.
 */

import { addPersonMedia, givePortraitsRecords } from './media.js';
import { PersonId, PartnershipId, StromData } from './types.js';
import { uniqueIdSuffix } from './ids.js';
import { MAX_PDF_BYTES } from './attachments.js';
import { dropMediaLink } from './import-origin.js';
import { strings } from './strings.js';

/** The part of an ExternalMediaRef the connecting needs. */
export interface GedcomMediaTarget {
    personId?: PersonId;
    partnershipId?: PartnershipId;
    title?: string;
    date?: string;
    filePath?: string;
}

/** File to data URL: a square-cropped portrait, an attachment-sized image, a file as it is. */
export interface GedcomMediaReaders {
    portrait(file: File): Promise<string>;
    image(file: File): Promise<string>;
    raw(file: File): Promise<string>;
}

/** What a connected file became (counted in the import's result). */
export type GedcomMediaAttached = 'portrait' | 'attachment' | 'couplePhoto';

/**
 * Connect one file to the person or couple of its reference. Returns what it
 * became, or null when it fits nowhere (an unknown target, a couple that has
 * its photo already, a type that is neither an image nor a PDF within the
 * limit, a file that cannot be read). The reference's lines kept for "Back to
 * {prog}" go once the file takes their place.
 */
export async function attachGedcomMediaFile(
    data: StromData, ref: GedcomMediaTarget, file: File, read: GedcomMediaReaders,
): Promise<GedcomMediaAttached | null> {
    const image = file.type.startsWith('image/');
    try {
        if (ref.partnershipId) {
            const union = data.partnerships[ref.partnershipId];
            if (!union || !image || union.photo) return null;
            union.photo = await read.image(file);
            union.photoOriginalName = ref.title || file.name;
            if (ref.date) union.photoDate = ref.date;
            if (ref.filePath) dropMediaLink(union, ref.filePath);
            return 'couplePhoto';
        }
        const person = ref.personId ? data.persons[ref.personId] : undefined;
        if (!person) return null;
        // The picture's date from the file goes with it (spec 066 G8).
        const date = ref.date ? { date: ref.date } : {};
        let kind: GedcomMediaAttached;
        if (image) {
            if (!person.photo) {
                person.photo = await read.portrait(file);
                person.photoOriginalName = file.name;
                if (ref.date) person.photoDate = ref.date;
                // Every portrait is in a record of the tree's files (data v25).
                givePortraitsRecords(data, typeof data.researchAsOf === 'string');
                kind = 'portrait';
            } else {
                addPersonMedia(data, person.id, {
                    id: `att_${Date.now()}_${uniqueIdSuffix()}`,
                    name: ref.title || file.name,
                    mimeType: 'image/jpeg',
                    dataUrl: await read.image(file),
                    sizeBytes: 0,
                    ...date,
                });
                kind = 'attachment';
            }
        } else if (file.type === 'application/pdf' && file.size <= MAX_PDF_BYTES) {
            addPersonMedia(data, person.id, {
                id: `att_${Date.now()}_${uniqueIdSuffix()}`,
                name: ref.title || file.name,
                mimeType: 'application/pdf',
                dataUrl: await read.raw(file),
                sizeBytes: file.size,
                ...date,
            });
            kind = 'attachment';
        } else {
            return null;
        }
        if (ref.filePath) dropMediaLink(person, ref.filePath);
        return kind;
    } catch {
        return null;
    }
}

/**
 * The sentence after connecting files: the plain count, split into portraits,
 * attachments and couples' photos when at least one couple's photo came in.
 */
export function gedcomMediaAttachedText(became: ReadonlyMap<GedcomMediaAttached, number>, total: number): string {
    const n = (k: GedcomMediaAttached): number => became.get(k) ?? 0;
    const matched = n('portrait') + n('attachment') + n('couplePhoto');
    return n('couplePhoto') > 0
        ? strings.gedcom.mediaAttachedParts(matched, total, n('portrait'), n('attachment'), n('couplePhoto'))
        : strings.gedcom.mediaAttached(matched, total);
}
