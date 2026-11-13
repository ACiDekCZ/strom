/**
 * A shared event in the life of each of its persons (spec 085 §2): the
 * "with Terezie, Bohumil, Anežka" line under an event, the family book's
 * "Family together" block, the family timeline's one mark per shared event.
 *
 * Pure: everything is read from a tree and the index of its shared events
 * (src/shared-events.ts), which the caller builds once per state of the tree
 * (DataManager.getSharedEventIndex, or sharedIndexOf for a protected copy),
 * never while drawing. The tree is the one the reader sees: after the
 * privacy filter of an export (src/privacy.ts) a living person has no events
 * left, so a living person of a shared event is simply not in its index and
 * is never named, counted or replaced by initials (§2i).
 */

import { LifeEvent, Person, PersonId, StromData } from './types.js';
import { SharedEventIndex, buildSharedEventIndex, sharedWith } from './shared-events.js';
import { shownNameOrEmpty, shownNameParts } from './person-name.js';
import { sharedEventMarkSvg } from './icons.js';
import { formatFlexDate, parseFlexDate, yearOf } from './dates.js';
import { lifeEventLabel } from './person-sources.js';
import type { getStringsForLang } from './strings.js';

/** One person named in a "with …" line. */
export interface SharedWithName {
    personId: PersonId;
    /** What the line shows: the given name, or the whole name (print, the same given name twice). */
    text: string;
    /** The whole name (the link's title). */
    full: string;
    /** The age written in that person's copy ('' none). */
    age: string;
}

/** The "with …" line of one event of one person. */
export interface SharedWithLine {
    shareId: string;
    /** The persons the line names, in the order of the event's "Shared with". */
    names: SharedWithName[];
    /** How many more the line leaves out ("and 8 more"); 0 when it names all. */
    more: number;
    /** The age written in the viewer's own copy ('' none). */
    ownAge: string;
}

export interface SharedWithLineOptions {
    /** The tree as the reader sees it (protected for an export). */
    data: StromData;
    /** The index of `data`'s shared events. */
    index: SharedEventIndex;
    /** Whole names instead of given names (print has no titles to hover). */
    fullNames?: boolean;
    /** Name everybody (the family book's block); default: up to 3, else the first 2 and "and N more". */
    all?: boolean;
    /** A person the reader must not see (a living person under privacy): left out altogether. */
    hidden?: (personId: PersonId) => boolean;
}

/** Up to this many other persons are all named; more: the first 2 and "and N more" (§2, 8c). */
export const SHARED_LINE_MAX = 3;
const SHARED_LINE_HEAD = 2;

/** A person's given name as shown (without titles), '' for none. */
export function givenNameOf(person: Person): string {
    return shownNameParts(person, '', false).given.trim();
}

/** The age written in a person's copy of a share. */
function copyAge(data: StromData, index: SharedEventIndex, personId: PersonId, shareId: string): string {
    const ref = index.shares.get(shareId)?.find(c => c.personId === personId);
    const ev = ref ? data.persons[personId]?.events?.find(e => e.id === ref.eventId) : undefined;
    return ev?.age?.trim() ?? '';
}

/**
 * Names for a list of persons: the given name, the whole name for every
 * person whose given name another person of the list has too (or who has
 * none), the whole name for all with `fullNames`.
 */
export function sharedNames(data: StromData, ids: readonly PersonId[], fullNames = false): { personId: PersonId; text: string; full: string }[] {
    const people = ids.map(id => data.persons[id]).filter((p): p is Person => !!p);
    const given = people.map(p => givenNameOf(p));
    const count = new Map<string, number>();
    for (const g of given) if (g) count.set(g.toLocaleLowerCase(), (count.get(g.toLocaleLowerCase()) ?? 0) + 1);
    return people.map((p, i) => {
        const full = shownNameOrEmpty(p) || '?';
        const g = given[i];
        const text = fullNames || !g || (count.get(g.toLocaleLowerCase()) ?? 0) > 1 ? full : g;
        return { personId: p.id, text, full };
    });
}

/**
 * The "with …" line of a person's event (spec 085 §2): the other persons of
 * its share the reader may see, in the order of "Shared with". null when the
 * event is not shared or nobody else is left to name.
 */
export function sharedWithLine(event: LifeEvent, viewerId: PersonId, opts: SharedWithLineOptions): SharedWithLine | null {
    const shareId = event.shareId;
    if (!shareId) return null;
    const { data, index } = opts;
    const others = sharedWith(index, viewerId, event.id)
        .filter(id => !!data.persons[id] && !data.persons[id].isPlaceholder && !opts.hidden?.(id));
    if (!others.length) return null;
    const cut = !opts.all && others.length > SHARED_LINE_MAX;
    const shown = cut ? others.slice(0, SHARED_LINE_HEAD) : others;
    const names = sharedNames(data, others, opts.fullNames)
        .filter(n => shown.includes(n.personId))
        .map(n => ({ ...n, age: copyAge(data, index, n.personId, shareId) }));
    return { shareId, names, more: others.length - shown.length, ownAge: event.age?.trim() ?? '' };
}

/** How a surface writes the line (src/ui/person-events.ts, the person page, print). */
export interface SharedWithLineHtmlOptions {
    /** "with" (strings.events.sharedLine). */
    lead: string;
    /** "and {n} more" (strings.events.sharedLineMore). */
    more: (n: number) => string;
    /** A named person's HTML: a link to the person, or the escaped name. */
    nameHtml: (name: SharedWithName) => string;
    esc: (text: string) => string;
    /** The circles' mark before the text (none in print). */
    mark?: boolean;
    /** Extra attributes of the line's element (the event to open, its title). */
    attrs?: string;
    /** The line opens something (a pointer over it). */
    open?: boolean;
}

/**
 * The line's HTML: the circles, "with", the names (", " between them) and
 * "and N more" (no link). The class `shared-line` is styled by the app and
 * by the person page's own CSS.
 */
export function sharedWithLineHtml(line: SharedWithLine, o: SharedWithLineHtmlOptions): string {
    // Each name keeps its comma (a link never leaves it at the start of the next line).
    const last = line.names.length - 1;
    const names = line.names.map((n, i) => `<span class="shared-line-item">${o.nameHtml(n)}${i < last ? ',' : ''}</span>`).join(' ');
    const more = line.more > 0 ? ` <span class="shared-line-more">${o.esc(o.more(line.more))}</span>` : '';
    const mark = o.mark === false ? '' : `<span class="shared-line-mark" aria-hidden="true">${sharedEventMarkSvg(16)}</span>`;
    return `<span class="shared-line${o.open ? ' shared-line--open' : ''}"${o.attrs ?? ''}>${mark}<span class="shared-line-text">${o.esc(o.lead)} ${names}${more}</span></span>`;
}

/** One shared event of a family: everyone in it is on the family's page (the book's "Family together", §2h). */
export interface FamilyTogetherEvent {
    shareId: string;
    /** The copy the common fields are read from (the first person's). */
    event: LifeEvent;
    /** Everyone of the event, in the order of its "Shared with", with the age in their copy. */
    persons: SharedWithName[];
}

/**
 * The shared events all of whose persons (as far as the reader sees them)
 * are on one page: the members' events whose every other person is a member
 * too, each once, in the order of the members' lives (the first member's
 * events first). Only events of at least two persons.
 */
export function familyTogetherEvents(
    data: StromData, index: SharedEventIndex, memberIds: readonly PersonId[],
    opts: { hidden?: (personId: PersonId) => boolean; fullNames?: boolean } = {},
): FamilyTogetherEvent[] {
    const members = new Set(memberIds);
    const seen = new Set<string>();
    const out: FamilyTogetherEvent[] = [];
    for (const pid of memberIds) {
        for (const ev of data.persons[pid]?.events ?? []) {
            const shareId = ev.shareId;
            if (!shareId || seen.has(shareId)) continue;
            const copies = index.shares.get(shareId);
            if (!copies || index.shareOf.get(`${pid}\u0000${ev.id}`) !== shareId) continue;
            seen.add(shareId);
            const ids: PersonId[] = [];
            for (const c of copies) {
                const p = data.persons[c.personId];
                if (!p || p.isPlaceholder || opts.hidden?.(c.personId) || ids.includes(c.personId)) continue;
                ids.push(c.personId);
            }
            if (ids.length < 2 || !ids.every(id => members.has(id))) continue;
            const first = copies.find(c => c.personId === ids[0]);
            const event = data.persons[ids[0]]?.events?.find(e => e.id === first?.eventId) ?? ev;
            const persons = sharedNames(data, ids, opts.fullNames)
                .map(n => ({ ...n, age: copyAge(data, index, n.personId, shareId) }));
            out.push({ shareId, event, persons });
        }
    }
    return out;
}

/**
 * One line of "Family together" without its full stop and footnote (§2h):
 * "<strong>Census 1921</strong>, 15 Feb 1921, Dolní Smyšlenice No. 14:
 * Kvido 42 years, Radegunda 38, Bohuchval 15, Zbyhněv 11". The exact date
 * only when it has more than the year (the year is in the title); the first
 * numeric age with its unit, the next ones bare; an age that is not a
 * number as written. `nameHtml` writes a person (a link or the escaped name).
 */
export function familyTogetherLineHtml(
    ft: FamilyTogetherEvent, S: ReturnType<typeof getStringsForLang>, lang: 'cs' | 'en' | 'de' | 'pl',
    esc: (text: string) => string, nameHtml: (name: SharedWithName) => string = n => esc(n.text),
): string {
    const ev = ft.event;
    const year = yearOf(ev.date);
    const title = [lifeEventLabel(ev, S), year !== null ? String(year) : ''].filter(Boolean).join(' ');
    const exact = parseFlexDate(ev.date)?.month ? formatFlexDate(ev.date, lang) : '';
    const where = [ev.place?.trim(), ev.address?.trim()].filter(Boolean).join(' ');
    let unit = false;
    const people = ft.persons.map(n => {
        let age = n.age;
        if (age && /^\d+$/.test(age) && !unit) { age = S.book.togetherYears(Number(age)); unit = true; }
        return `${nameHtml(n)}${age ? ` ${esc(age)}` : ''}`;
    }).join(', ');
    const head = [`<strong>${esc(title)}</strong>`, exact ? esc(exact) : '', where ? esc(where) : ''].filter(Boolean).join(', ');
    return `${head}: ${people}`;
}

/**
 * The index of a tree that is never changed once made (a protected copy for
 * an export, the person page, the book): built on first use, kept with it.
 * The open tree's own index is DataManager.getSharedEventIndex.
 */
const frozenIndexes = new WeakMap<StromData, SharedEventIndex>();
export function sharedIndexOf(tree: StromData): SharedEventIndex {
    let index = frozenIndexes.get(tree);
    if (!index) {
        index = buildSharedEventIndex(tree);
        frozenIndexes.set(tree, index);
    }
    return index;
}
