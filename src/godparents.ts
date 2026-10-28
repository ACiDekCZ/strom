/**
 * The godparent who keeps turning up (P2).
 *
 * Recording who stood at a baptism is only half of it. The half that matters is
 * the pattern: a godparent at one child's baptism is a neighbour, but the same
 * name at three baptisms in one family is almost always a relative — and that is
 * a lead a genealogist follows. It is the reason godparents are worth storing as
 * data instead of a sentence in a note, and until now the app stored them and
 * said nothing.
 *
 * Names are compared by the name alone (participantName): the estate, the
 * village and the house number a register adds ("Jan Lhoták, sedlák z Lhotky
 * čp. 12") are left out, and what is left is folded for case and diacritics.
 * Older research entries carry all of that in the name, newer ones keep it in
 * the note; both compare the same. A linked person counts under their own
 * identity, so two spellings of a linked godparent still count as one person.
 *
 * Not every recurring name is a lead (spec 021 K1.1): the priest and the
 * midwife are at every baptism of the parish, and a godparent who stood only
 * at one couple's children is the custom of the time. What stays is a name
 * that turns up in families that are not one sibling group.
 */

import { StromData, Person, PersonId, EventParticipant } from './types.js';
import { shownNameOrEmpty } from './person-name.js';

/** Someone who appears as a participant more than once. */
export interface RecurringParticipant {
    /** Their name as shown: from the linked person, or as written. */
    name: string;
    /** Linked person, when the participant was linked to one. */
    personId?: PersonId;
    /** How many events they appear at. */
    count: number;
    /** Whose events: the people whose baptisms/weddings they attended. */
    subjects: { id: PersonId; name: string }[];
    /** Are they already related to those people? Then it is no news. */
    alreadyRelated: boolean;
}

/** How many appearances make a pattern worth mentioning. */
export const RECURRING_THRESHOLD = 2;

const fold = (t: string): string =>
    t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Words that join a name and stay part of it ("Karl von Berg", "Anna de la Cour"). */
const NAME_PARTICLES = new Set(['von', 'van', 'der', 'den', 'de', 'du', 'da', 'di', 'del', 'della', 'la', 'le', 'zu', 'ten', 'ter']);

/**
 * Words in front of a name that are not the name: a role ("kmotr Jan …"),
 * an address ("pan", "vdova") or a title ("P. Antonín …", "Mgr."). Folded, without the dot.
 */
const NAME_PREFIXES = new Set([
    'kmotr', 'kmotra', 'kmotrem', 'svedek', 'svedkyne', 'pate', 'patin', 'godfather', 'godmother', 'godparent', 'witness',
    'pan', 'pani', 'sl', 'slecna', 'vdova', 'vdovec', 'frau', 'herr', 'hr', 'fr', 'mr', 'mrs', 'miss',
    'p', 'rd', 'r', 'd', 'rev', 'pfr', 'mgr', 'dr', 'mudr', 'judr', 'phdr', 'ing', 'bc',
]);

const foldWord = (t: string): string => fold(t).replace(/\./g, '');

/**
 * The name a participant is compared by (spec 021 K1.2), and the rest of what
 * the register wrote with it.
 *
 * Registers, and the research's older entries, write a godparent as "Jan
 * Lhoták, sedlák z Lhotky čp. 12", "Marie Nováková roz. Dvořáková" or "Anna
 * uxor Josefa Lhotáka"; newer entries keep the name alone and the rest in the
 * note. Either way the name is the leading run of capitalised words, before the
 * first comma and the first word in lower case or with a digit: the estate, the
 * village, the house number, a maiden name or a husband never take part in the
 * comparison. A reading mark ("Novák[?]", "Lhoták(?)") is dropped; a word the
 * reader completed in brackets ("Lho[ták]") is kept. Titles and role words in
 * front ("P.", "pan", "kmotr") are not the name either.
 *
 * `key` is null when what is left is not enough to tell a person by — a lone
 * given name ("Anna, jeho manželka"): two of those across the tree are not the
 * same woman.
 */
export function participantName(written: string): { name: string; key: string | null; rest: string } {
    const raw = written.normalize('NFC').trim();
    const asides: string[] = [];
    const cleaned = raw
        .replace(/\?/g, '')                          // "Novák[?]", "Lhoták(?)"
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/[[\]]/g, '')                       // "Lho[ták]": the reader's completion stays
        .replace(/\(([^)]*)\)/g, (_m, aside: string) => { asides.push(aside); return ' '; })
        .replace(/\s+/g, ' ').trim();
    const comma = cleaned.search(/[,;:]/);
    const head = comma >= 0 ? cleaned.slice(0, comma) : cleaned;
    const tokens = head.split(' ').filter(Boolean);

    let i = 0;
    while (i < tokens.length - 1 && NAME_PREFIXES.has(foldWord(tokens[i]))) i++;
    const isCapital = (t: string): boolean => /^\p{Lu}/u.test(t) && !/\d/.test(t);
    const taken: string[] = [];
    if (i < tokens.length && isCapital(tokens[i])) {
        for (; i < tokens.length; i++) {
            const t = tokens[i];
            if (isCapital(t)) { taken.push(t); continue; }
            if (NAME_PARTICLES.has(t.toLowerCase()) && tokens[i + 1] && isCapital(tokens[i + 1])) { taken.push(t); continue; }
            break;
        }
    } else {
        // Written all in lower case: the part before the first comma, up to a number.
        for (; i < tokens.length && !/\d/.test(tokens[i]); i++) taken.push(tokens[i]);
    }
    const name = taken.join(' ').replace(/[.,]+$/, '');
    const rest = [...tokens.slice(i), comma >= 0 ? cleaned.slice(comma + 1) : '', ...asides]
        .join(' ').replace(/\s+/g, ' ').trim();
    if (!name) return { name: raw, key: null, rest };
    const words = taken.filter(t => !NAME_PARTICLES.has(t.toLowerCase()));
    return { name, key: words.length >= 2 ? fold(name).replace(/\./g, '') : null, rest };
}

/** What a participant's note or descriptor says of a priest ("farář", "kaplan", "Pfarrer", "parochus"…). Folded word stems. */
const CLERGY_WORDS = ['farar', 'kaplan', 'kooperator', 'cooperator', 'lokalista', 'localista', 'curatus', 'kurat',
    'dekan', 'administrator', 'adm', 'capellanus', 'capl', 'parochus', 'presbyter', 'expositus', 'expozit', 'knez',
    'vikar', 'pfarrer', 'priest', 'clergy', 'pastor', 'officiant', 'oddavajici', 'krtici'];
/** … and of a midwife ("porodní bába", "zkoušená", "Hebamme", "obstetrix"). */
const MIDWIFE_WORDS = ['porodni', 'baba', 'zkousena', 'nezkousena', 'neskousena', 'obstetrix', 'hebamme', 'midwife'];

const hasWord = (text: string, stems: string[]): boolean =>
    fold(text).split(/[^a-z]+/).some(w => w && stems.some(s => w === s || (s.length >= 5 && w.startsWith(s))));

/**
 * Who stands at an event by office, not by choice (spec 021 K1.1): the
 * officiating priest and the midwife are at every baptism of their parish, so
 * their name recurring says nothing about a family. Known by the role
 * (`officiant`, the research's `Midwife` role kept in the note), and — for
 * older entries that wrote them as a witness or as "other" — by the word the
 * register uses for them in the name or the note.
 */
export function attendsByOffice(part: EventParticipant): boolean {
    if (part.role === 'officiant') return true;
    if (extraParticipantRole(part)?.role === 'midwife') return true;
    const descriptor = `${participantName(part.name ?? '').rest} ${part.note ?? ''}`;
    if (hasWord(descriptor, MIDWIFE_WORDS)) return true;
    // A godparent is chosen; a priest who stood as one stays a godparent.
    return part.role !== 'godparent' && hasWord(descriptor, CLERGY_WORDS);
}

const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`.trim();

/**
 * Everyone reachable from this person by up to three parent/child/partner hops.
 *
 * One hop is not enough: the grandmother at her grandchildren's baptisms is two
 * hops away (parent's parent), and uncles and aunts — the historically most
 * common godparents — are three (parent's sibling, i.e. parent → grandparent →
 * their child). Anyone within that radius is already family, so their recurring
 * appearance is expected, not a lead.
 */
function relativesOf(id: PersonId, data: StromData): Set<PersonId> {
    const out = new Set<PersonId>();
    const visited = new Set<PersonId>([id]);
    let frontier: PersonId[] = [id];
    for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
        const next: PersonId[] = [];
        for (const cur of frontier) {
            const person = data.persons[cur];
            if (!person) continue;
            const step: PersonId[] = [...person.parentIds, ...person.childIds];
            for (const unionId of person.partnerships) {
                const union = data.partnerships[unionId];
                if (!union) continue;
                step.push(union.person1Id, union.person2Id, ...union.childIds);
            }
            for (const n of step) {
                if (visited.has(n)) continue;
                visited.add(n);
                out.add(n);
                next.push(n);
            }
        }
        frontier = next;
    }
    return out;
}

/**
 * Participants who appear at more than one event, most frequent first.
 *
 * `alreadyRelated` marks the ones who are no surprise — a grandmother standing
 * at her grandchildren's baptisms is not a lead. What is left is the interesting
 * part: a name that keeps appearing and has no place in the tree yet.
 */
export function recurringParticipants(
    data: StromData,
    include: (part: EventParticipant) => boolean = () => true,
): RecurringParticipant[] {
    const seen = new Map<string, RecurringParticipant>();
    /** Spellings of each unlinked name, so the one shown is the one written most. */
    const spellings = new Map<string, Map<string, number>>();

    const note = (part: EventParticipant, subject: Person): void => {
        if (!include(part)) return;
        const linked = part.personId ? data.persons[part.personId] : undefined;
        let name: string;
        let key: string;
        if (linked) {
            name = fullName(linked);
            if (!name) return;
            // Linked people count under their id, so two spellings of the
            // same linked godparent are still one person.
            key = linked.id;
        } else {
            const read = participantName(part.name ?? '');
            // A lone given name tells no one apart: never matched with another.
            if (!read.key) return;
            name = read.name;
            key = `name:${read.key}`;
            const forms = spellings.get(key) ?? new Map<string, number>();
            forms.set(name, (forms.get(name) ?? 0) + 1);
            spellings.set(key, forms);
        }

        const entry = seen.get(key) ?? {
            name,
            ...(linked ? { personId: linked.id } : {}),
            count: 0,
            subjects: [],
            alreadyRelated: false,
        };
        entry.count++;
        if (!entry.subjects.some(s => s.id === subject.id)) {
            entry.subjects.push({ id: subject.id, name: shownNameOrEmpty(subject) });
        }
        seen.set(key, entry);
    };

    for (const subject of Object.values(data.persons)) {
        for (const event of subject.events ?? []) {
            for (const part of event.participants ?? []) note(part, subject);
        }
    }
    // Wedding witnesses. A marriage counts ONCE, under the first spouse:
    // counting it for both would make a single wedding look like two separate
    // appearances and manufacture a lead out of nothing.
    for (const union of Object.values(data.partnerships)) {
        const subject = data.persons[union.person1Id] ?? data.persons[union.person2Id];
        if (!subject) continue;
        for (const part of union.participants ?? []) note(part, subject);
        // The couple's events (banns, a contract) the same way: each event once.
        for (const ev of union.events ?? []) {
            for (const part of ev.participants ?? []) note(part, subject);
        }
    }

    const out: RecurringParticipant[] = [];
    for (const [key, entry] of seen) {
        if (entry.count < RECURRING_THRESHOLD) continue;
        const forms = spellings.get(key);
        if (forms) {
            entry.name = [...forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        }
        if (entry.personId) {
            const related = relativesOf(entry.personId, data);
            entry.alreadyRelated = entry.subjects.every(s => related.has(s.id));
        }
        out.push(entry);
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * How many families the people are from: people who share a parent are one
 * sibling group, anyone with no parent in the tree a group of their own.
 */
export function siblingGroupCount(ids: PersonId[], data: StromData): number {
    const root = ids.map((_, n) => n);
    const find = (n: number): number => { while (root[n] !== n) n = root[n] = root[root[n]]; return n; };
    const firstChildOf = new Map<PersonId, number>();   // parent id -> index of the first child seen
    ids.forEach((id, n) => {
        for (const parentId of data.persons[id]?.parentIds ?? []) {
            const first = firstChildOf.get(parentId);
            if (first === undefined) firstChildOf.set(parentId, n);
            else root[find(n)] = find(first);
        }
    });
    return new Set(ids.map((_, n) => find(n))).size;
}

/**
 * The ones worth telling someone about (spec 021 K1.1): recurring, at events
 * where they stood by choice and not by office, not already family, and in more
 * than one family.
 *
 * - The priest and the midwife are left out (attendsByOffice): they are at
 *   every baptism of the parish.
 * - A godparent who stood only at one couple's children (siblings, half
 *   siblings) is the custom of the time — one family's godparent — not a lead.
 * - The two-people rule keeps a lead honest. Someone who witnessed one
 *   person's wedding and stood at that same person's child's baptism recurs,
 *   but says nothing about a wider family tie; an unlinked name is keyed by
 *   its name across the whole tree, so two distinct families also stop a
 *   common name (two unrelated "Jan Novák"s) from looking like one person on
 *   the strength of one family alone.
 */
export function godparentLeads(data: StromData): RecurringParticipant[] {
    return recurringParticipants(data, part => !attendsByOffice(part))
        .filter(p => !p.alreadyRelated
            && p.subjects.length >= 2
            && siblingGroupCount(p.subjects.map(s => s.id), data) >= 2);
}

/** Roles a file names that the app has no own role for: kept as 'other' with the word in front of the note. */
export type ExtraParticipantRole = 'midwife' | 'informant';
const EXTRA_ROLE_WORDS: Record<ExtraParticipantRole, RegExp> = {
    midwife: /^(midwife|hebamme|porodn[ií] b[aá]ba)$/i,
    informant: /^(informant|oznamovatel|anzeigender?)$/i,
};

/**
 * A participant recorded as 'other' whose note starts with a role word the
 * app has no role for ("Midwife", "Midwife — z Týnce" — the form Strom
 * Research and the importer write): that role, and the rest of the note.
 * The data keeps the word, so it goes back to the research as it came.
 */
export function extraParticipantRole(p: { role: string; note?: string }): { role: ExtraParticipantRole; word: string; rest: string } | null {
    if (p.role !== 'other' || !p.note) return null;
    const m = /^([^—]+?)(?:\s+—\s+([\s\S]*))?$/.exec(p.note.trim());
    if (!m) return null;
    for (const role of Object.keys(EXTRA_ROLE_WORDS) as ExtraParticipantRole[]) {
        if (EXTRA_ROLE_WORDS[role].test(m[1].trim())) return { role, word: m[1].trim(), rest: (m[2] ?? '').trim() };
    }
    return null;
}
