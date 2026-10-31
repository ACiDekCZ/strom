/**
 * The text of a story (or a long note) set as prose. The writer — often a
 * research agent writing a .md file — uses a little markdown; this renders a
 * fixed small set of it and nothing else, without any library:
 *   - a blank line: a paragraph; '\n' inside one: a line break;
 *   - a line `## …` (`#` to `######`): a subheading;
 *   - lines `- …`: a bulleted list (a line without the dash continues the item);
 *   - `**bold**` and `*italic*`.
 * A first line `# …` that only repeats the story's title is left out (the
 * reader and the book show the title already). Everything is escaped first, so
 * the only markup that survives is what is rendered here; any other markdown
 * stays plain text.
 *
 * Deliberately NOT list markers: `* ` (the genealogical birth mark, "* 1831")
 * and `1. ` (a Czech date opens a line: "1. ledna 1831 …").
 */

import type { Partnership, Person, StromData } from './types.js';
import { yearOf } from './dates.js';

/** Where a union's sorting year comes from (partnershipSortKey). */
export type PartnershipSortSource = 'wedding' | 'children' | 'event';

export interface PartnershipSortKey {
    /** null: no year at all (the union goes last). */
    year: number | null;
    from: PartnershipSortSource | null;
}

/**
 * The year a union sorts by among a person's unions (spec 025 §4.5): the
 * wedding; without one, the birth of the couple's first child; without that,
 * the couple's first dated event; else none. `children` are the union's
 * children as the tree has them (missing ones and stand-ins are skipped).
 */
export function partnershipSortKey(u: Partnership, children: readonly (Person | undefined)[]): PartnershipSortKey {
    const wedding = yearOf(u.startDate);
    if (wedding !== null) return { year: wedding, from: 'wedding' };
    const min = (ys: (number | null)[]): number | null => {
        const known = ys.filter((y): y is number => y !== null);
        return known.length ? Math.min(...known) : null;
    };
    const child = min(children.filter((c): c is Person => !!c && !c.isPlaceholder).map(c => yearOf(c.birthDate)));
    if (child !== null) return { year: child, from: 'children' };
    const event = min((u.events ?? []).map(e => yearOf(e.date)));
    if (event !== null) return { year: event, from: 'event' };
    return { year: null, from: null };
}

/** Compare two sorting keys: by year, a union without a wedding date after a dated one of the same year, no year last. */
export function comparePartnershipKeys(a: PartnershipSortKey, b: PartnershipSortKey): number {
    const ya = a.year ?? Infinity, yb = b.year ?? Infinity;
    if (ya !== yb) return ya < yb ? -1 : 1;
    return (a.from === 'wedding' ? 0 : 1) - (b.from === 'wedding' ? 0 : 1);
}

/** Unions in the order of partnershipSortKey; a tie keeps the given order (the person's order in the data). */
export function partnershipsInOrder<T extends Partnership>(data: StromData, unions: readonly T[]): T[] {
    return unions
        .map((u, i) => ({ u, i, k: partnershipSortKey(u, (u.childIds ?? []).map(id => data.persons[id])) }))
        .sort((a, b) => comparePartnershipKeys(a.k, b.k) || a.i - b.i)
        .map(x => x.u);
}

/**
 * The person's couples with a story of their own (Partnership.story), in the
 * order of the marriages (partnershipsInOrder).
 */
export function coupleStories(data: StromData, person: Person): Partnership[] {
    return partnershipsInOrder(data, person.partnerships.map(id => data.partnerships[id])
        .filter((u): u is Partnership => !!u?.story?.text?.trim()));
}

/** How many story chapters the person has: the own story and one per couple's story. */
export function personStoryChapterCount(data: StromData, person: Person): number {
    return (person.story?.text?.trim() ? 1 : 0) + coupleStories(data, person).length;
}

/**
 * The years of a marriage for its story: the wedding → the end of the union,
 * else the death of the first partner to die. "1885–1910", "1885", "until 1910"
 * (no wedding date: `until` words it, never a dangling dash) or "".
 */
export function coupleStoryYears(data: StromData, u: Partnership, until: (year: string) => string): string {
    const from = yearOf(u.startDate);
    const deaths = [u.person1Id, u.person2Id].map(id => yearOf(data.persons[id]?.deathDate)).filter((y): y is number => y !== null);
    const to = yearOf(u.endDate) ?? (deaths.length ? Math.min(...deaths) : null);
    if (from !== null && to !== null) return to > from ? `${from}–${to}` : String(from);
    if (from !== null) return String(from);
    return to !== null ? until(String(to)) : '';
}

/**
 * The two names of a couple's chapter chip ("Jan and Rozálie · 1883"): both
 * first names, never declined; the full names when the first names match.
 * `full` gives the shown full name; a missing partner is "?".
 */
export function coupleChipNames(self: Person, partner: Person | undefined, full: (p: Person) => string): [string, string] {
    const selfFirst = self.firstName?.trim() || full(self);
    if (!partner) return [selfFirst, '?'];
    const partnerFirst = partner.firstName?.trim() || full(partner);
    return selfFirst.toLocaleLowerCase() === partnerFirst.toLocaleLowerCase() ? [full(self), full(partner)] : [selfFirst, partnerFirst];
}

/**
 * The top-level blocks of storyProseHtml's output (paragraphs, lists,
 * subheadings), in order. The renderer never nests a block in another of its
 * kind, so the first closing tag of the same name ends a block.
 */
export function proseBlocks(html: string): string[] {
    const out: string[] = [];
    const re = /<(p|ul|h[1-6])\b[^>]*>[\s\S]*?<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) out.push(m[0]);
    return out;
}

/**
 * The prose split for a folded chapter: the lead up to and including the
 * first paragraph or list (a subheading before it goes with it), and the rest.
 * A single paragraph has no rest (it is never folded).
 */
export function splitProseLead(html: string): { lead: string; rest: string } {
    const blocks = proseBlocks(html);
    const first = blocks.findIndex(b => !/^<h[1-6]/.test(b));
    if (first < 0 || first === blocks.length - 1) return { lead: html, rest: '' };
    return { lead: blocks.slice(0, first + 1).join(''), rest: blocks.slice(first + 1).join('') };
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*-\s+(.*)$/;

/** Bold, then italic: `*` opens before a non-space and closes after one, never inside a word. */
function inline(text: string): string {
    return esc(text)
        .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\p{L}\p{N}])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\p{L}\p{N}])/gu, '$1<em>$2</em>');
}

/** Compare a heading with the title: case, emphasis marks and edge punctuation aside. */
export function sameText(a: string, b: string): boolean {
    const norm = (s: string): string => s.replace(/[*_]/g, '').replace(/\s+/g, ' ')
        .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').toLocaleLowerCase();
    return norm(a) !== '' && norm(a) === norm(b);
}

export interface StoryProseOptions {
    /** The story's title: a leading `# …` repeating it is left out. */
    title?: string;
    /** The heading level of `#`/`##` (`###` and deeper one below); default 4. */
    headingLevel?: number;
    /**
     * A single newline inside a paragraph: a line break (default, the story
     * reader and the person page) or a space (the family book, §5.1: a book
     * paragraph is set as one block of text).
     */
    softBreak?: 'br' | 'space';
    /** Drop `**` and lone `*` marks left unpaired (the book: no markdown reaches the paper). */
    dropStrayMarks?: boolean;
}

/** The prose of a story or a note: the one renderer shared by the person page, the reader and the family book. */
export function proseHtml(text: string, options: StoryProseOptions = {}): string {
    return storyProseHtml(text, options);
}

export function storyProseHtml(text: string, options: StoryProseOptions = {}): string {
    const joiner = options.softBreak === 'space' ? ' ' : '<br>';
    const inl = options.dropStrayMarks
        ? (t: string): string => inline(t).replace(/\*\*/g, '').replace(/(^|\s)\*(?=\s|$)/g, '$1')
        : inline;
    const base = Math.min(Math.max(options.headingLevel ?? 4, 1), 6);
    const out: string[] = [];
    let para: string[] = [];
    let items: string[][] = [];
    let first = true;

    const flushPara = (): void => {
        if (para.length > 0) out.push(`<p>${para.map(inl).join(joiner)}</p>`);
        para = [];
    };
    const flushList = (): void => {
        if (items.length > 0) out.push(`<ul>${items.map(it => `<li>${it.map(inl).join(joiner)}</li>`).join('')}</ul>`);
        items = [];
    };

    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim();
        if (!line) {
            flushPara();
            flushList();
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            flushPara();
            flushList();
            const repeatsTitle = first && heading[1].length === 1 && !!options.title && sameText(heading[2], options.title);
            first = false;
            if (!repeatsTitle && heading[2]) {
                const level = Math.min(heading[1].length <= 2 ? base : base + 1, 6);
                out.push(`<h${level} class="story-subhead">${inl(heading[2])}</h${level}>`);
            }
            continue;
        }
        first = false;
        const bullet = BULLET.exec(raw);
        if (bullet) {
            flushPara();
            items.push([bullet[1].trim()]);
        } else if (items.length > 0) {
            items[items.length - 1].push(line);
        } else {
            para.push(line);
        }
    }
    flushPara();
    flushList();
    return out.join('');
}
