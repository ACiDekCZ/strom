/**
 * A person's contact (Person.emails, data version 26, spec 134 K0.10).
 *
 * GEDCOM keeps a contact in an address structure under an event: MyHeritage
 * writes a person's e-mail as `1 RESI` / `2 EMAIL x@y` (the standard place),
 * some programs as `1 EMAIL x@y` right under the person. Such a RESI says
 * nothing about where the person lived: it is the person's contact, not a
 * residence. One rule, on import and for trees made before it:
 *
 * - a RESI that carries a contact alone (EMAIL, PHON, WWW, FAX, an empty ADDR
 *   or one with only the label "Email" as its part; no date, place, real
 *   address, note, source or file) is the person's contact, no event;
 * - a RESI with something of its own stays a residence, its e-mail goes to
 *   the contact (no longer a line of the note);
 * - `1 EMAIL` under the person is the contact too.
 *
 * A contact goes out as `1 RESI` / `2 EMAIL` (GEDCOM's own form); "Back to
 * {prog}" writes a `1 EMAIL` the file had in that form again.
 */

import type { LifeEvent, Person, PersonId, StromData } from './types.js';
import { notedStructures } from './import-origin.js';
import { allMedia } from './media.js';

/** Longest e-mail address kept (RFC 5321's path limit; anything longer is not one). */
const EMAIL_MAX = 254;

/** One address as kept: trimmed, one token, no control characters. Null: not one. */
export function cleanEmail(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v || v.length > EMAIL_MAX || /[\s\u0000-\u001f\u007f]/.test(v)) return null;
    return v;
}

/** Two addresses are the same address whatever their case. */
export function sameEmail(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The valid addresses of a stored value, each once (the first spelling kept); undefined when none. */
export function cleanEmails(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: string[] = [];
    for (const item of value) {
        const email = cleanEmail(item);
        if (email && !out.some(e => sameEmail(e, email))) out.push(email);
    }
    return out.length > 0 ? out : undefined;
}

/** The addresses typed into one field: separated by commas, semicolons or spaces. */
export function emailsFromInput(text: string): string[] {
    return cleanEmails(text.split(/[\s,;]+/)) ?? [];
}

/** The person's contact with these addresses added (none twice); true when it changed. */
export function addEmails(person: Person, emails: readonly string[]): boolean {
    const before = person.emails ?? [];
    const next = cleanEmails([...before, ...emails]);
    if ((next?.length ?? 0) === before.length) return false;
    person.emails = next;
    return true;
}

/** The label an address part carries in place of a value (`3 ADR1 Email`, MyHeritage). */
export const CONTACT_ADDRESS_LABEL = /^e-?mail$/i;

/**
 * What a GEDCOM RESI carries, as far as the contact rule asks (see
 * isContactResidence): its own parts, and the contact lines under it.
 */
export interface ResidenceParts {
    date?: string;
    place?: string;
    /** The address read from its ADDR (a label alone gives none). */
    address?: string;
    cause?: string;
    age?: string;
    /** Its note, a value on its own line, a TYPE: anything said in words. */
    note?: string;
    sources?: number;
    files?: number;
    participants?: number;
    /** A share of another's event, a part at one, a label of its own. */
    other?: boolean;
    emails?: readonly string[];
}

/**
 * A RESI that carries a contact alone (see the module): nothing of a
 * residence — no date, place, address (a label "Email" is none), cause, age,
 * note, source, file, participant or other mark. Its e-mails are the person's
 * contact; with none (PHON, WWW or an empty ADDR alone) there is nothing to
 * keep of it.
 */
export function isContactResidence(r: ResidenceParts): boolean {
    const address = r.address?.trim();
    return !r.date && !r.place?.trim() && (!address || CONTACT_ADDRESS_LABEL.test(address))
        && !r.cause?.trim() && !r.age?.trim() && !r.note?.trim()
        && !r.sources && !r.files && !r.participants && !r.other;
}

/**
 * A line of a note that is an address of the event's `2 EMAIL` as the import
 * of an older app wrote it ("E-mail: x@y", the label in the language of the
 * import): its address when it is one of `emails`.
 */
function labelledEmail(line: string, emails?: readonly string[]): string | null {
    const at = line.indexOf(': ');
    if (at <= 0 || line.slice(0, at).includes('@')) return null;
    const value = line.slice(at + 2).trim();
    if (emails) return emails.some(e => e === value) ? value : null;
    return null;
}

/** "E-mail: x@y" / "E-Mail: x@y" (the label of every language the import wrote it in). */
const EMAIL_NOTE_LINE = /^(?:E-?mail|E-Mail):\s*(\S+@\S+)$/i;
/** The research's word of the status a fact had, which an older research wrote into the note. */
const STATUS_WORD_LINE = /^\[?(?:lead|stopa|vodítko|hinweis|wskazówka)\]?\.?$/i;

/** Keys of an event that say nothing of a residence (its id and kind, the research's status of a lead). */
const CONTACT_EVENT_KEYS = new Set(['id', 'type', 'note', 'gedcomEmails', 'status']);

/** The event has nothing besides its id, kind and a lead's status (its note looked at by the caller). */
function emptyBesidesNote(event: LifeEvent): boolean {
    if (event.status && event.status !== 'lead') return false;
    return Object.entries(event).every(([k, v]) => CONTACT_EVENT_KEYS.has(k) || v === undefined
        || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim()));
}

/** The person's own marks of the event (a confirmation by hand, a change made in the research). */
function eventKeptByPerson(person: Person, eventId: string): boolean {
    const key = `event:${eventId}`;
    return !!person.confirmed?.[key] || person.researchOrigins?.[key]?.kind === 'user';
}

/** The fact entries of an event that is gone. */
function dropEventKeys(person: Person, eventId: string): void {
    const key = `event:${eventId}`;
    for (const field of ['importedValues', 'researchOrigins', 'researchVerify', 'confirmed'] as const) {
        const map = person[field] as Record<string, unknown> | undefined;
        if (!map) continue;
        for (const k of Object.keys(map)) if (k === key || k.startsWith(`${key}.`)) delete map[k];
        if (Object.keys(map).length === 0) delete person[field];
    }
}

/**
 * An empty residence (no date, place, address, note, source, participant or
 * file): what an older import made of MyHeritage's `2 ADDR` / `3 ADR1 Email`.
 * It is not taken away (nobody can tell it from one made by hand), only not
 * shown in the person's list of events.
 */
export function isEmptyResidence(event: LifeEvent, hasFiles = false): boolean {
    return event.type === 'residence' && !hasFiles && !event.note?.trim() && emptyBesidesNote(event);
}

/**
 * The e-mails a tree keeps elsewhere, moved into the people's contact (data
 * version 26): run at every load, so it changes nothing the second time and
 * catches a residence that a research version brings back.
 *
 * - (a) a residence whose `2 EMAIL` an older import kept (LifeEvent.gedcomEmails):
 *   the note's lines of those addresses ("E-mail: x@y") move to the contact;
 * - (b) a residence with no such record (one back from the research): when its
 *   note is only such lines (and perhaps the word of a lead's status) and it
 *   has nothing else, the addresses move to the contact;
 * - a residence left with nothing at all is taken away; one with a date, a
 *   place, an address, a note of its own, a source, a file, a confirmation or
 *   the research's record of a person's change stays (only the lines of (a)
 *   leave its note);
 * - `1 EMAIL` under the person that an older import wrote into the person's
 *   note (its line kept with the file's lines, NOTED_TAG): that line moves too.
 *
 * Nothing a person wrote is changed: only lines that are exactly what an
 * import wrote. Returns whether anything changed.
 */
export function moveContactsIntoPeople(data: StromData): boolean {
    let changed = false;
    let eventsWithFiles: Set<string> | null = null;
    const filesAt = (personId: PersonId, eventId: string): boolean => {
        if (!eventsWithFiles) {
            eventsWithFiles = new Set();
            for (const att of allMedia(data)) {
                for (const pl of att.places ?? []) {
                    if ('personId' in pl && pl.eventId) eventsWithFiles.add(`${pl.personId}\u001f${pl.eventId}`);
                }
            }
        }
        return eventsWithFiles.has(`${personId}\u001f${eventId}`);
    };
    for (const person of Object.values(data.persons ?? {})) {
        if (!person || typeof person !== 'object') continue;
        if ('emails' in person) {
            const kept = cleanEmails(person.emails);
            if (!kept) { delete person.emails; changed = true; }
            else if (JSON.stringify(kept) !== JSON.stringify(person.emails)) { person.emails = kept; changed = true; }
        }
        if (Array.isArray(person.events) && person.events.some(e => e?.type === 'residence' && e.note)) {
            const events: LifeEvent[] = [];
            for (const event of person.events) {
                if (!event || event.type !== 'residence' || !event.note) { events.push(event); continue; }
                const moved: string[] = [];
                let lines = event.note.split('\n');
                if (event.gedcomEmails?.length) {
                    // (a) The lines the import wrote of the file's EMAIL.
                    const left: string[] = [];
                    for (const line of lines) {
                        const email = labelledEmail(line.trimEnd(), event.gedcomEmails);
                        if (email && !moved.includes(email)) moved.push(email);
                        else left.push(line);
                    }
                    lines = left;
                } else if (emptyBesidesNote(event) && !filesAt(person.id, event.id) && !eventKeptByPerson(person, event.id)) {
                    // (b) A note of such lines alone (back from the research).
                    const own = lines.map(l => l.trim()).filter(Boolean);
                    const found = own.map(l => EMAIL_NOTE_LINE.exec(l)?.[1] ?? null);
                    const words = own.filter((l, i) => !found[i] && STATUS_WORD_LINE.test(l));
                    if (found.some(Boolean) && found.filter(f => !f).length === words.length && words.length <= 1) {
                        moved.push(...found.filter((f): f is string => !!f));
                        lines = [];
                    }
                }
                if (moved.length === 0) { events.push(event); continue; }
                addEmails(person, moved);
                changed = true;
                const note = lines.join('\n').trim();
                const rest: LifeEvent = { ...event };
                if (note) rest.note = note; else delete rest.note;
                if (!note && emptyBesidesNote(rest) && !filesAt(person.id, event.id) && !eventKeptByPerson(person, event.id)) {
                    dropEventKeys(person, event.id);
                    continue;
                }
                events.push(rest);
            }
            if (events.length !== person.events.length || events.some((e, i) => e !== person.events![i])) {
                if (events.length > 0) person.events = events; else delete person.events;
            }
        }
        if (person.notes && person.gedcomExtra?.length) {
            // `1 EMAIL` under the person: its line of the note, exactly as the import wrote it.
            let noteLines = person.notes.split('\n');
            const moved: string[] = [];
            for (const extra of person.gedcomExtra) {
                if (!extra || !Array.isArray(extra.lines)) continue;
                for (const st of notedStructures(extra.lines)) {
                    const email = emailOfLine(st.lines[0]);
                    if (!email || st.texts.length !== 1) continue;
                    const at = noteLines.findIndex(l => l.trimEnd() === st.texts[0]);
                    if (at < 0) continue;
                    noteLines = [...noteLines.slice(0, at), ...noteLines.slice(at + 1)];
                    moved.push(email);
                }
            }
            if (moved.length > 0) {
                addEmails(person, moved);
                const notes = noteLines.join('\n').trim();
                if (notes) person.notes = notes; else delete person.notes;
                changed = true;
            }
        }
    }
    return changed;
}

/** The address of a GEDCOM line `1 EMAIL x@@y` (its `@@` read as `@`), null for another line. */
export function emailOfLine(line: string | undefined): string | null {
    const m = /^1 EMAIL (.+)$/.exec(line ?? '');
    return m ? cleanEmail(m[1].replace(/@@/g, '@')) : null;
}
