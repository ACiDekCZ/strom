/**
 * Which of a person's photos a portrait can be cut from (spec 107, "Portrait
 * from a photo"): the candidates of the picker, newest first, the research's
 * pictures the bridge must bring left out (and counted) while it does not
 * run; who else is in each photo; where the crop editor starts.
 *
 * No DOM: the picker (src/ui/portrait-picker-ui.ts) hands in what it reads
 * from the materials.
 */

import { DataManager } from './data.js';
import { Attachment, Person, PersonId, PortraitCrop, PortraitSource } from './types.js';
import { MaterialItem, directPersons } from './materials.js';
import { researchPersonRef } from './research-link.js';
import { shownName } from './person-name.js';
import type { ImgState } from './ui/image-slot.js';

/** One photo the picker offers. */
export interface PortraitCandidate {
    /** MaterialItem.key ('a:<id>' | 'm:<I…>'). */
    key: string;
    item: MaterialItem;
    title: string;
    /** The picture to show at once: the tree's file (the person's own or its copy at another person), else null (the preview queue, by `sha`). */
    image: string | null;
    /** The file's hash for the preview queue (only when `image` is null). */
    sha?: string;
    /** The picture needs its working copy over the bridge. */
    bridge: boolean;
    /** The person's portrait is cut from this photo now (the Portrait tag). */
    isSource: boolean;
    /** Other people in the photo, without this person; '' for one whose name is not known (counted, not named). */
    others: string[];
    /** The tree's file still on its way after the tree (spec 116). */
    waits: ImgState;
    /** Sorting: when it came (ms; NaN last). */
    at: number;
}

export interface PortraitCandidatesInput {
    /** The person's materials as their section shows them (hidden ones left out). */
    items: MaterialItem[];
    /** Can the item become the person's portrait, and does it need the bridge (null: not offered). */
    offer: (item: MaterialItem) => { bridge: boolean } | null;
    bridgeUp: boolean;
    /** The attachment the person's portrait is cut from as shown now. */
    sourceId: string | null;
    /** The tree's file that is the item (at any person), if any. */
    treeCopy: (item: MaterialItem) => Attachment | undefined;
    others: (item: MaterialItem) => string[];
    waits: (item: MaterialItem) => ImgState;
}

/**
 * The photos a portrait can be cut from: what "Use as portrait…" offers,
 * newest first (undated ones last, in the materials' order). A picture that
 * needs the bridge while it does not run is not shown, only counted
 * (`researchOnly`); a tree's file that did not come is left out. The
 * portrait's own photo is offered too (a new crop of it), with its tag.
 */
export function portraitCandidates(input: PortraitCandidatesInput): { shown: PortraitCandidate[]; researchOnly: number } {
    let researchOnly = 0;
    const shown: { c: PortraitCandidate; index: number }[] = [];
    input.items.forEach((item, index) => {
        const offer = input.offer(item);
        if (!offer) return;
        const waits = input.waits(item);
        // Nothing can be done with a file of the tree that did not come.
        if (waits === 'failed') return;
        if (offer.bridge && !input.bridgeUp) {
            researchOnly++;
            return;
        }
        const copy = input.treeCopy(item);
        const own = item.attachment && !item.attachment.originalOnly && item.attachment.mimeType.startsWith('image/') ? item.attachment : undefined;
        const tree = own ?? copy;
        const image = waits === 'none' && tree?.dataUrl ? tree.dataUrl : null;
        // The file's hash for its preview (the same as the materials' rows).
        const sha = image ? undefined : item.file?.sha ?? item.attachment?.original?.sha256;
        const id = item.attachment?.id ?? copy?.id;
        const when = item.at ?? item.attachment?.addedAt;
        shown.push({
            index,
            c: {
                key: item.key,
                item,
                title: item.title,
                image,
                ...(sha ? { sha } : {}),
                bridge: offer.bridge,
                isSource: !!input.sourceId && id === input.sourceId,
                others: input.others(item),
                waits,
                at: when ? Date.parse(when) : NaN,
            },
        });
    });
    shown.sort((a, b) => {
        const an = Number.isNaN(a.c.at), bn = Number.isNaN(b.c.at);
        if (an !== bn) return an ? 1 : -1;
        if (!an && a.c.at !== b.c.at) return b.c.at - a.c.at;
        return a.index - b.index;
    });
    return { shown: shown.map(x => x.c), researchOnly };
}

/** A name as the research's list gives it, without the years ("Jan Novák (1899–1972)" → "Jan Novák"). */
function bareName(name: string): string {
    return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

/**
 * Who else is in the photo: the research's file names its own people and
 * those its sorting found (not those only through its batch: a batch says
 * whom it was sent to, not who is in it); the tree's file the people it is
 * at. Without this person, each once, in the source's order; '' for one whose
 * name is not known. `people`: the research's REFN → name.
 */
export function photoPeopleOthers(item: MaterialItem, person: Pick<Person, 'id' | 'refn'>, people: Record<string, string> = {}): string[] {
    const own = researchPersonRef(person.refn);
    let byRefn: Map<string, Person> | null = null;
    const treePerson = (refn: string): Person | undefined => {
        if (!byRefn) {
            byRefn = new Map();
            for (const p of DataManager.getAllPersons()) {
                const r = researchPersonRef(p.refn);
                if (r && !byRefn.has(r)) byRefn.set(r, p);
            }
        }
        return byRefn.get(refn);
    };
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (key: string, name: () => string): void => {
        if (seen.has(key)) return;
        seen.add(key);
        out.push(name());
    };
    if (item.file) {
        for (const refn of directPersons(item.file)) {
            if (refn === own) continue;
            add(refn, () => {
                const listed = people[refn] ? bareName(people[refn]) : '';
                if (listed) return listed;
                const p = treePerson(refn);
                return p ? shownName(p) : '';
            });
        }
    }
    for (const place of item.attachment?.places ?? []) {
        if (!('personId' in place)) continue;
        const id = place.personId as PersonId;
        if (id === person.id) continue;
        const p = DataManager.getPerson(id);
        const refn = researchPersonRef(p?.refn);
        if (refn && refn === own) continue;
        add(refn ?? `id:${id}`, () => (refn && people[refn] ? bareName(people[refn]) : '') || (p ? shownName(p) : ''));
    }
    return out;
}

/** A portrait's crop without its origin. */
export function portraitCropOf(source: PortraitSource): PortraitCrop {
    const crop: PortraitCrop = { region: { ...source.region } };
    if (source.quarterTurns) crop.quarterTurns = source.quarterTurns;
    if (source.angle) crop.angle = source.angle;
    if (source.mirror) crop.mirror = true;
    return crop;
}

/**
 * Where the crop editor starts over a photo chosen for the person: the
 * person's crop when the portrait is cut from that photo already; else the
 * editor's own start (undefined). `copyId`: the tree's file that is the item
 * at another person.
 *
 * The one place a start on the person's face will come from once the
 * research keeps where each person is in a photo (a region per person): a
 * square centred on it, about 2.2× its larger side, inside the photo.
 */
export function portraitInitialFor(item: MaterialItem, person: Pick<Person, 'photo' | 'photoSource'>, copyId?: string): PortraitCrop | undefined {
    const source = person.photo ? person.photoSource : undefined;
    const id = item.attachment?.id ?? copyId;
    if (source?.attachmentId && id && source.attachmentId === id) return portraitCropOf(source);
    return undefined;
}
