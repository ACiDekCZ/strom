/**
 * Living-person privacy filter for exports.
 *
 * When a tree leaves the family (shared/embedded/GEDCOM export), details of
 * people who are probably still alive can be hidden. The filter always returns
 * a DEEP COPY and never mutates the original; the tree STRUCTURE (ids,
 * relationships, partnerships, gender) is always preserved so the exported tree
 * still renders.
 */

import { StromData, Person } from './types.js';
import { strings } from './strings.js';
import { yearOf } from './dates.js';
import { stripPhotos } from './photo.js';
import { stripAttachments } from './attachments.js';

export type PrivacyMode = 'full' | 'initials' | 'anonymous' | 'minimal';

// ==================== GRANULAR EXPORT CONTENT ====================

/**
 * Which content categories an export carries. Independent of the living-privacy
 * filter above: privacy obscures WHO, content options decide WHAT extras (heavy
 * media, free-text notes, the source apparatus) travel with the file. All true
 * is the full archive.
 */
export interface ContentOptions {
    photos: boolean;
    attachments: boolean;
    notes: boolean;
    sources: boolean;
}

/** Everything included — the default (Complete archive) and the "all on" preset. */
export const ALL_CONTENT: ContentOptions = { photos: true, attachments: true, notes: true, sources: true };

/** Named export-content presets offered in the dialog. */
export type ContentPreset = 'complete' | 'small' | 'skeleton';

/**
 * Checkbox patterns behind the three presets:
 * - complete: the full archive (everything),
 * - small: no heavy media (photos + attachments), text kept — a file to email,
 * - skeleton: structure and names only (all four off).
 */
export const CONTENT_PRESETS: Record<ContentPreset, ContentOptions> = {
    complete: { photos: true, attachments: true, notes: true, sources: true },
    small: { photos: false, attachments: false, notes: true, sources: true },
    skeleton: { photos: false, attachments: false, notes: false, sources: false },
};

/** The preset whose pattern equals `opts`, or null when the state is custom. */
export function matchContentPreset(opts: ContentOptions): ContentPreset | null {
    for (const name of Object.keys(CONTENT_PRESETS) as ContentPreset[]) {
        const p = CONTENT_PRESETS[name];
        if (p.photos === opts.photos && p.attachments === opts.attachments
            && p.notes === opts.notes && p.sources === opts.sources) return name;
    }
    return null;
}

/**
 * Deep copy with every free-text note removed: person notes, partnership notes,
 * life-event notes and event-participant notes. Identity, structure and all
 * other fields are preserved. Does not mutate the input.
 */
export function stripNotes(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const person of Object.values(copy.persons)) {
        delete person.notes;
        for (const ev of person.events ?? []) {
            delete ev.note;
            for (const part of ev.participants ?? []) delete part.note;
        }
    }
    for (const partnership of Object.values(copy.partnerships)) {
        delete partnership.note;
    }
    return copy;
}

/**
 * Deep copy with the whole source/citation apparatus removed: the sources
 * catalog and every reference into it — person/event/partnership sourceIds and
 * attachment.sourceId links — so nothing is left pointing at a source that is no
 * longer present. Does not mutate the input.
 */
export function stripSources(data: StromData): StromData {
    const copy = structuredClone(data);
    delete copy.sources;
    for (const person of Object.values(copy.persons)) {
        delete person.sourceIds;
        for (const ev of person.events ?? []) delete ev.sourceIds;
        for (const att of person.attachments ?? []) delete att.sourceId;
    }
    for (const partnership of Object.values(copy.partnerships)) {
        delete partnership.sourceIds;
    }
    return copy;
}

/**
 * Normalise the legacy boolean "drop media" flag into full ContentOptions:
 * `false` keeps everything, `true` drops photos + attachments (the old
 * stripMedia behaviour) while keeping notes and sources.
 */
export function resolveContentOptions(content: boolean | ContentOptions): ContentOptions {
    if (typeof content === 'boolean') {
        return content ? { photos: false, attachments: false, notes: true, sources: true } : ALL_CONTENT;
    }
    return content;
}

/**
 * Deep copy of `data` keeping only the selected content categories. A thin
 * composition of the pure strip functions; the leading clone guarantees a fresh
 * object even when nothing is stripped. Does not mutate the input.
 */
export function applyContentOptions(data: StromData, content: boolean | ContentOptions): StromData {
    const opts = resolveContentOptions(content);
    let out = structuredClone(data);
    if (!opts.photos) out = stripPhotos(out);
    if (!opts.attachments) out = stripAttachments(out);
    if (!opts.notes) out = stripNotes(out);
    if (!opts.sources) out = stripSources(out);
    return out;
}

/** Ages beyond this (with no death date) are assumed deceased. */
const ASSUMED_MAX_AGE = 110;
/** A parent is at least this much older than any of their children. */
const MIN_PARENT_AGE = 12;
/** Nobody marries younger than this (historically conservative). */
const MIN_MARRIAGE_AGE = 14;

/**
 * Whether a person should be treated as living. A death date (or isDeceased:
 * true) means deceased; isDeceased: false forces living. Otherwise: living if
 * the latest possible birth year is within ASSUMED_MAX_AGE. `bounds` (see
 * inferBirthUpperBounds) lets people WITHOUT any dates of their own be
 * recognised as certainly deceased from indirect evidence; without it, only
 * the person's own birth year is used and unknowns stay living (safe default).
 */
export function isLivingPerson(
    person: Person,
    currentYear: number = new Date().getFullYear(),
    bounds?: Map<string, number>
): boolean {
    if (person.isDeceased === true) return false;
    if (person.isDeceased === false) return true;
    if (person.deathDate) return false;
    const birthYear = bounds?.get(person.id) ?? yearOf(person.birthDate);
    if (birthYear === null || birthYear === undefined) return true;
    return currentYear - birthYear < ASSUMED_MAX_AGE;
}

/**
 * Infer, for every person, the LATEST year they can have been born — from
 * their own dates and events, their weddings, and (propagated up through the
 * generations) their descendants' bounds: a parent is at least MIN_PARENT_AGE
 * older than any child. Only certain inferences, so the privacy filter can
 * stop treating clearly-historical people (no recorded dates of their own,
 * but a child born in 1880) as "maybe living".
 */
export function inferBirthUpperBounds(data: StromData): Map<string, number> {
    const bounds = new Map<string, number>();
    const tighten = (id: string, year: number | null): boolean => {
        if (year === null) return false;
        const cur = bounds.get(id);
        if (cur === undefined || year < cur) { bounds.set(id, year); return true; }
        return false;
    };

    for (const p of Object.values(data.persons)) {
        tighten(p.id, yearOf(p.birthDate));
        tighten(p.id, yearOf(p.deathDate));               // born no later than died
        for (const ev of p.events ?? []) tighten(p.id, yearOf(ev.date));
    }
    for (const u of Object.values(data.partnerships)) {
        const wy = yearOf(u.startDate);
        if (wy !== null) {
            tighten(u.person1Id, wy - MIN_MARRIAGE_AGE);
            tighten(u.person2Id, wy - MIN_MARRIAGE_AGE);
        }
    }

    // Fixpoint child → parent. The iteration cap guards against parent cycles
    // in broken data (a DAG needs at most its depth in passes).
    const persons = Object.values(data.persons);
    let changed = true;
    for (let i = 0; i < persons.length && changed; i++) {
        changed = false;
        for (const p of persons) {
            const b = bounds.get(p.id);
            if (b === undefined) continue;
            for (const parentId of p.parentIds) {
                if (tighten(parentId, b - MIN_PARENT_AGE)) changed = true;
            }
        }
    }
    return bounds;
}

/** First letter + '.', e.g. "Jan" -> "J.". Empty stays empty. */
function initial(name: string): string {
    const trimmed = name.trim();
    return trimmed ? `${trimmed[0].toUpperCase()}.` : '';
}

/** Drop every detail field, keeping only identity/structure fields. */
function stripDetails(person: Person): void {
    delete person.birthDate;
    delete person.birthPlace;
    delete person.deathDate;
    delete person.deathPlace;
    delete person.notes;
    delete person.photo;
    delete person.photoOriginalName;
    // Life events carry places and dates — drop them for living people.
    delete person.events;
    // Source citations may point at sensitive references — drop them too.
    delete person.sourceIds;
    // Attachments (scans, letters) are private documents — always drop.
    delete person.attachments;
}

/**
 * Return a deep copy of `data` with living persons obscured according to `mode`.
 * Deceased persons and placeholders are left untouched. 'full' is a no-op copy.
 */
export function applyLivingPrivacy(
    data: StromData,
    mode: PrivacyMode,
    currentYear: number = new Date().getFullYear()
): StromData {
    const copy = structuredClone(data);
    if (mode === 'full') return copy;

    // The source catalog may hold sensitive references (e.g. registers of the
    // living), so it is never exported under a privacy mode. Drop every citation
    // too, so no person/event points at a source that is no longer present.
    delete copy.sources;
    for (const person of Object.values(copy.persons)) {
        delete person.sourceIds;
        delete person.attachments;
        for (const ev of person.events ?? []) delete ev.sourceIds;
    }
    for (const partnership of Object.values(copy.partnerships)) {
        delete partnership.sourceIds;
    }

    // Decide liveness BEFORE any transformation (the loop below strips the
    // very dates the inference reads), with indirect evidence: a person whose
    // child was born in 1880 is certainly not living, even with no dates of
    // their own.
    const bounds = inferBirthUpperBounds(copy);
    const living = new Set(
        Object.values(copy.persons)
            .filter(p => !p.isPlaceholder && isLivingPerson(p, currentYear, bounds))
            .map(p => p.id)
    );

    for (const person of Object.values(copy.persons)) {
        if (!living.has(person.id)) continue;

        switch (mode) {
            case 'initials': {
                const birthYear = yearOf(person.birthDate);
                person.firstName = initial(person.firstName);
                person.lastName = initial(person.lastName);
                stripDetails(person);
                if (birthYear !== null) person.birthDate = String(birthYear);
                break;
            }
            case 'anonymous': {
                stripDetails(person);
                person.firstName = strings.privacy.livingPerson;
                person.lastName = '';
                break;
            }
            case 'minimal': {
                const keptLastName = person.lastName;
                stripDetails(person);
                person.firstName = strings.privacy.livingPerson;
                person.lastName = keptLastName;
                break;
            }
        }
    }

    return copy;
}

/**
 * Presumed-deceased set for the † marker (renderer + poster export share this):
 * a recorded death, isDeceased, or age beyond 120 seeds the set, and every
 * ANCESTOR of a presumed-deceased person is presumed deceased too. Looser than
 * the privacy heuristic above on purpose — it only drives a display marker.
 */
export function presumedDeceasedSet(data: StromData, currentYear: number = new Date().getFullYear()): Set<string> {
    const MARKER_MAX_AGE = 120;
    const out = new Set<string>();
    for (const p of Object.values(data.persons)) {
        if (p.deathDate || p.isDeceased === true) { out.add(p.id); continue; }
        const birthYear = yearOf(p.birthDate);
        if (birthYear !== null && currentYear - birthYear > MARKER_MAX_AGE) out.add(p.id);
    }
    const markAncestors = (id: string): void => {
        const p = data.persons[id as keyof typeof data.persons];
        if (!p) return;
        for (const parentId of p.parentIds) {
            if (!out.has(parentId)) {
                out.add(parentId);
                markAncestors(parentId);
            }
        }
    };
    for (const id of [...out]) markAncestors(id);
    return out;
}
