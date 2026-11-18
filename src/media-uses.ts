/**
 * Where a file of the tree is used (spec 102 §3 "Where used"): its places
 * (a person, a person's fact or event, a couple or a couple's event, a
 * source), the portraits cut from it, the couple photos taken from its
 * original and the source excerpts cut from it.
 *
 * Pure: `mediaUsesIndex` reads the whole tree once (the materials window's
 * counts); `mediaUses` gives one file's uses (the viewer, the Attachment
 * dialog). `mediaUseLabel` words a use for the block.
 */

import { Attachment, MediaPlace, PartnershipId, PersonId, StromData } from './types.js';
import { treeMedia } from './media.js';
import { lifeEventLabel, coupleEventLabelIn } from './person-sources.js';
import { shownName } from './person-name.js';
import { yearOf } from './dates.js';
import { strings as appStrings } from './strings.js';
import { nameWithoutYears } from './materials-overview.js';

type Strings = typeof appStrings;

export type MediaUseKind = 'person' | 'portrait' | 'couple' | 'event' | 'source' | 'excerpt';

export interface MediaUse {
    kind: MediaUseKind;
    /** The record's own place (it can be taken off); none for a portrait, an excerpt or a couple photo alone. */
    place?: MediaPlace;
    personId?: PersonId;
    partnershipId?: PartnershipId;
    sourceId?: string;
    eventId?: string;
    fact?: 'birth' | 'death';
    excerptId?: string;
    /** A couple whose photo was taken from this file's original. */
    couplePhoto?: boolean;
}

const ORDER: Record<MediaUseKind, number> = { person: 0, portrait: 1, couple: 2, event: 3, source: 4, excerpt: 5 };

/** A place of the file as a use (its kind, person, couple, event or source). */
export function placeUse(place: MediaPlace): MediaUse {
    if ('personId' in place) {
        if (place.fact || place.eventId) {
            return { kind: 'event', place, personId: place.personId, ...(place.fact ? { fact: place.fact } : { eventId: place.eventId }) };
        }
        return { kind: 'person', place, personId: place.personId };
    }
    if ('partnershipId' in place) {
        return place.eventId
            ? { kind: 'event', place, partnershipId: place.partnershipId, eventId: place.eventId }
            : { kind: 'couple', place, partnershipId: place.partnershipId };
    }
    return { kind: 'source', place, sourceId: place.sourceId };
}

/**
 * Every file's uses, read in one pass over the tree (only files that are in
 * the tree or that something was cut from). Uses in the order persons,
 * portraits, couples, events, sources, excerpts; within a kind as found.
 */
export function mediaUsesIndex(data: Pick<StromData, 'media' | 'persons' | 'partnerships' | 'sources'>, only?: ReadonlySet<string>): Map<string, MediaUse[]> {
    const out = new Map<string, MediaUse[]>();
    const add = (id: string, use: MediaUse) => {
        if (only && !only.has(id)) return;
        const list = out.get(id);
        if (list) list.push(use); else out.set(id, [use]);
    };
    const bySha = new Map<string, string[]>();
    for (const att of Object.values(data.media ?? {}) as Attachment[]) {
        if (!att || typeof att !== 'object') continue;
        if (only && !only.has(att.id)) continue;
        const sha = att.original?.sha256?.toLowerCase();
        if (sha) bySha.set(sha, [...(bySha.get(sha) ?? []), att.id]);
    }
    for (const att of treeMedia(data)) {
        if (only && !only.has(att.id)) continue;
        for (const place of att.places) add(att.id, placeUse(place));
    }
    for (const person of Object.values(data.persons ?? {})) {
        const id = person?.photoSource?.attachmentId;
        if (id && data.media?.[id]) add(id, { kind: 'portrait', personId: person.id });
    }
    for (const p of Object.values(data.partnerships ?? {})) {
        const sha = p?.photo ? p.photoOriginal?.sha256?.toLowerCase() : undefined;
        if (!sha) continue;
        for (const id of bySha.get(sha) ?? []) {
            const list = out.get(id);
            const own = list?.find(u => u.kind === 'couple' && u.partnershipId === p.id);
            if (own) own.couplePhoto = true;
            else add(id, { kind: 'couple', partnershipId: p.id, couplePhoto: true });
        }
    }
    for (const source of Object.values(data.sources ?? {})) {
        for (const ex of source?.excerpts ?? []) {
            const id = ex.fromAttachmentId;
            if (id && data.media?.[id]) add(id, { kind: 'excerpt', sourceId: source.id, excerptId: ex.id });
        }
    }
    for (const [id, list] of out) {
        out.set(id, list.map((use, index) => ({ use, index }))
            .sort((a, b) => ORDER[a.use.kind] - ORDER[b.use.kind] || a.index - b.index)
            .map(x => x.use));
    }
    return out;
}

/** One file's uses (see mediaUsesIndex). */
export function mediaUses(data: Pick<StromData, 'media' | 'persons' | 'partnerships' | 'sources'>, mediaId: string): MediaUse[] {
    return mediaUsesIndex(data, new Set([mediaId])).get(mediaId) ?? [];
}

export interface MediaUseLabel {
    /** The kind's word ("Person", "Event"…). */
    type: string;
    /** The person, couple, event or source. */
    text: string;
    /** What it is to the file ("cut from this file", "evidence"…). */
    sub?: string;
    /** A person's name (shown in the serif face). */
    person?: boolean;
}

/**
 * A person's name as the materials show it: none, or only the app's "?"
 * stand-in (a name the records do not give), reads "Unknown person"; the
 * years after it stay ("? (1850–1902)" → "Unknown person (1850–1902)").
 */
export function materialPersonLabel(name: string, S: Strings = appStrings): string {
    const full = name.trim();
    const bare = nameWithoutYears(full);
    if (bare && bare !== '?') return full;
    return `${S.materials.unknownPerson}${full.slice(bare.length)}`;
}

function personName(data: Pick<StromData, 'persons'>, id: PersonId | undefined, S: Strings): string {
    const p = id ? data.persons[id] : undefined;
    return p ? materialPersonLabel(shownName(p, S.materials.unknownPerson), S) : S.materials.unknownPerson;
}

function coupleName(data: Pick<StromData, 'persons' | 'partnerships'>, id: PartnershipId | undefined, S: Strings): string {
    const p = id ? data.partnerships[id] : undefined;
    if (!p) return S.materials.unknownPerson;
    return S.materials.usedCouple(personName(data, p.person1Id, S), personName(data, p.person2Id, S));
}

function withYear(label: string, date: string | undefined): string {
    const year = yearOf(date);
    return year ? `${label} ${year}` : label;
}

/** A use as the block shows it. */
export function mediaUseLabel(data: Pick<StromData, 'persons' | 'partnerships' | 'sources'>, use: MediaUse, S: Strings = appStrings): MediaUseLabel {
    const m = S.materials;
    const t = m.usedType;
    switch (use.kind) {
        case 'person':
            return { type: t.person, text: personName(data, use.personId, S), person: true };
        case 'portrait':
            return { type: t.portrait, text: personName(data, use.personId, S), sub: m.portraitCut, person: true };
        case 'couple':
            return { type: t.couple, text: coupleName(data, use.partnershipId, S), ...(use.couplePhoto ? { sub: m.couplePhoto } : {}) };
        case 'event': {
            if (use.partnershipId) {
                const p = data.partnerships[use.partnershipId];
                const ev = p?.events?.find(e => e.id === use.eventId);
                const label = ev ? withYear(coupleEventLabelIn(ev, S), ev.date) : t.event;
                return { type: t.event, text: `${label} · ${coupleName(data, use.partnershipId, S)}` };
            }
            const person = use.personId ? data.persons[use.personId] : undefined;
            let label: string = t.event;
            if (use.fact) label = withYear(S.events.types[use.fact], use.fact === 'birth' ? person?.birthDate : person?.deathDate);
            else {
                const ev = person?.events?.find(e => e.id === use.eventId);
                if (ev) label = withYear(lifeEventLabel(ev, S), ev.date);
            }
            return { type: t.event, text: `${label} · ${personName(data, use.personId, S)}` };
        }
        case 'source': {
            // Its evidence, and where the source is cited (5d): "evidence · cited at Birth".
            const at = use.sourceId ? sourceCitedAt(data, use.sourceId, S) : null;
            return { type: t.source, text: data.sources?.[use.sourceId ?? '']?.title || m.unknownSource, sub: at ? m.docCitedAt(at) : m.docOf };
        }
        case 'excerpt':
            return { type: t.excerpt, text: data.sources?.[use.sourceId ?? '']?.title || m.unknownSource, sub: m.excerptCut };
    }
}

/** The first fact or event a source is cited at (a person's birth, death or life event); null: none such. */
export function sourceCitedAt(data: Pick<StromData, 'persons'>, sourceId: string, S: Strings = appStrings): string | null {
    for (const person of Object.values(data.persons ?? {})) {
        if (!person) continue;
        if (person.birthSourceIds?.includes(sourceId)) return S.events.types.birth;
        if (person.deathSourceIds?.includes(sourceId)) return S.events.types.death;
        const ev = person.events?.find(e => e.sourceIds?.includes(sourceId));
        if (ev) return lifeEventLabel(ev, S);
    }
    return null;
}

/** A place as the texts name it ("Birth 1890 · Jan Novák", "Jan Novák and Marie…", the source's title). */
export function mediaPlaceLabel(data: Pick<StromData, 'persons' | 'partnerships' | 'sources'>, place: MediaPlace, S: Strings = appStrings): string {
    return mediaUseLabel(data, placeUse(place), S).text;
}
