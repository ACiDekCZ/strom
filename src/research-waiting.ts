/**
 * "Awaiting action": what the research waits on, put in order for the app —
 * to do and sent (awaiting a reply), by chip (section), by the place it is
 * done at (group), and which of the task link's actions an item offers.
 * Pure: the items come checked from research-link.ts (sanitizeWaiting); an
 * older research (no `waiting.groups`) has no phases, sections or groups.
 */

import {
    LiveWaiting, WAITING_SECTIONS, WaitingGroup, WaitingInbox, WaitingLinkAction, WaitingSection, imageNumber, researchTaskRef,
} from './research-link.js';
import type { WaitingWrites } from './research-waiting-write.js';

export type WaitingPhase = 'todo' | 'sent';
/** The chip filter: all, or one section. */
export type WaitingFilter = 'all' | WaitingSection;

/** Items the small panel lists before "N more in the overview". */
export const PANEL_WAITING = 5;
/** The group items without a place of their own go to (always at the bottom). */
export const OTHER_GROUP = 'other';
/** The group every question about places goes under (spec 034 §9). */
export const PLACES_GROUP = 'places';

export function waitingPhase(w: LiveWaiting): WaitingPhase {
    return w.phase === 'sent' ? 'sent' : 'todo';
}

/** What the user can do something about now: everything but what was sent and waits for a reply. */
export function todoWaiting<T extends LiveWaiting>(items: readonly T[]): T[] {
    return items.filter(w => waitingPhase(w) === 'todo');
}

/** The count the menu, the heading, the state and the cards go by. */
export function waitingTodoCount(items: readonly LiveWaiting[]): number {
    return todoWaiting(items).length;
}

/** The item's chip: as the research says, else by its kind (a story or an archive's question is a decision). */
export function waitingSection(w: LiveWaiting): WaitingSection {
    if (w.section) return w.section;
    return w.kind === 'story' || w.kind === 'permission' || w.kind === 'place' || w.kind === 'takeover' || w.kind === 'check' || w.kind === 'hypothesis' ? 'decide' : 'other';
}

/** The research's order; `order` only settles what a filter left (the list comes sorted). */
export function orderWaiting<T extends LiveWaiting>(items: readonly T[]): T[] {
    return items.map((w, i) => ({ w, i }))
        .sort((a, b) => (a.w.order ?? Number.MAX_SAFE_INTEGER) - (b.w.order ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
        .map(x => x.w);
}

/** The chips with their counts, in their fixed order: only sections present; none unless two or more. */
export function waitingChips(items: readonly LiveWaiting[]): { section: WaitingSection; count: number }[] {
    const counts = new Map<WaitingSection, number>();
    for (const w of items) counts.set(waitingSection(w), (counts.get(waitingSection(w)) ?? 0) + 1);
    const chips = WAITING_SECTIONS.filter(s => counts.has(s)).map(section => ({ section, count: counts.get(section)! }));
    return chips.length >= 2 ? chips : [];
}

/** The filter in force: a section no item (or no chip) has any more falls back to all. */
export function effectiveWaitingFilter(items: readonly LiveWaiting[], filter: WaitingFilter): WaitingFilter {
    if (filter === 'all') return 'all';
    return waitingChips(items).some(c => c.section === filter) ? filter : 'all';
}

export function filterWaiting<T extends LiveWaiting>(items: readonly T[], filter: WaitingFilter): T[] {
    return filter === 'all' ? [...items] : items.filter(w => waitingSection(w) === filter);
}

export interface WaitingGroupRows<T extends LiveWaiting = LiveWaiting> {
    key: string;
    /** The place (null: an item without one, in "Other"). */
    group: WaitingGroup | null;
    items: T[];
}

/**
 * Items by their place, each group where its first item stands (in the
 * research's order); items without a place and the "other" group at the bottom.
 */
export function groupWaiting<T extends LiveWaiting>(items: readonly T[]): WaitingGroupRows<T>[] {
    const groups = new Map<string, WaitingGroupRows<T>>();
    for (const w of orderWaiting(items)) {
        // The research's questions about places go under one group "Places", whatever group they name.
        const place = w.kind === 'place';
        const key = place ? PLACES_GROUP : w.group?.key ?? OTHER_GROUP;
        let g = groups.get(key);
        if (!g) {
            g = { key, group: place ? null : w.group ?? null, items: [] };
            groups.set(key, g);
        }
        // An item without a place joins "other" under the research's name for it, when one came.
        if (!g.group && w.group && !place) g.group = w.group;
        g.items.push(w);
    }
    const list = [...groups.values()];
    return [...list.filter(g => g.key !== OTHER_GROUP), ...list.filter(g => g.key === OTHER_GROUP)];
}

/** Both phases (after the filter), each in groups. */
export function waitingPhases<T extends LiveWaiting>(items: readonly T[], filter: WaitingFilter): Record<WaitingPhase, WaitingGroupRows<T>[]> {
    const shown = filterWaiting(items, filter);
    return {
        todo: groupWaiting(shown.filter(w => waitingPhase(w) === 'todo')),
        sent: groupWaiting(shown.filter(w => waitingPhase(w) === 'sent')),
    };
}

/**
 * Whether a place's group in the overview is open until it is folded by hand:
 * under a filter, with a new item, or a lone item (its heading is there to
 * say its place, not to hide one row behind a click); else folded.
 */
export function waitingGroupOpenByDefault(items: readonly LiveWaiting[], filter: WaitingFilter, fresh: ReadonlySet<string>): boolean {
    return items.length === 1 || filter !== 'all' || items.some(w => fresh.has(w.id));
}

/**
 * The first `n` items to do, in order, and how many more there are (the small
 * panel). Items in `focus` (one person's, from the card's !) come first and
 * are all shown, however many; the rest fill the panel up to `n` rows.
 */
export function panelWaiting<T extends LiveWaiting>(items: readonly T[], n = PANEL_WAITING,
    focus: ReadonlySet<string> = new Set()): { shown: T[]; more: number } {
    const todo = orderWaiting(todoWaiting(items));
    const first = todo.filter(w => focus.has(w.id));
    const shown = [...first, ...todo.filter(w => !focus.has(w.id))].slice(0, Math.max(n, first.length));
    return { shown, more: todo.length - shown.length };
}

/**
 * What waits on one person (their `refn`), in order: the items to do naming
 * them, and a story's new version of a couple they are part of — the same
 * items their card's ! counts.
 */
export function personWaiting<T extends LiveWaiting>(items: readonly T[], refn: string | undefined): T[] {
    if (!refn) return [];
    return orderWaiting(todoWaiting(items)).filter(w => w.person === refn || (w.kind === 'story' && w.partner === refn));
}

/** The order the actions stand in: Chat right next to Answer, never tucked away. */
const ACTION_ORDER: readonly WaitingLinkAction[] = ['answer', 'chat', 'file', 'note', 'folder', 'sent'];
/** Images are saved by hand: Chat leads (it is the way to talk about them). */
const IMAGES_LINK_ORDER: readonly WaitingLinkAction[] = ['chat', 'answer', 'folder', 'file', 'note', 'sent'];

/**
 * The task link's actions an item offers, in their order: only those the
 * research named at it (`actions`); null when it named none (an older
 * research: "Answer" as before). A story, an archive's question or a takeover
 * never goes by the task link. What was sent is not marked sent again.
 */
export function waitingTaskActions(w: LiveWaiting): WaitingLinkAction[] | null {
    if (!w.actions || w.kind === 'story' || w.kind === 'permission' || w.kind === 'takeover' || w.kind === 'hypothesis') return null;
    return (w.kind === 'images' ? IMAGES_LINK_ORDER : ACTION_ORDER).filter(a => w.actions!.includes(a) && !(a === 'sent' && waitingPhase(w) === 'sent'));
}

/**
 * The task a group's "Chat" opens: of its items that offer a chat, the one
 * first in the research's order (the research's chat takes up the group's
 * other waiting tasks itself); null when none offers one.
 */
export function waitingGroupChatTask(items: readonly LiveWaiting[]): string | null {
    const chat = orderWaiting(items).find(w => researchTaskRef(w.id) && waitingTaskActions(w)?.includes('chat'));
    return chat ? researchTaskRef(chat.id) : null;
}

/** Chat is the detail's main button where nothing is answered there (images are saved by hand). */
export function waitingChatLeads(w: LiveWaiting): boolean {
    return w.kind === 'images';
}

/** How long ago, in days for anything older than today ("9 days ago"), in the UI language. */
export function waitingDaysAgo(ts: number, now: number, lang: string): string {
    const day = 86_400_000;
    const days = Math.max(0, Math.floor((now - ts) / day));
    try {
        return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
    } catch {
        return `${days}`;
    }
}

/** The task link's `do` for an action (answer: none). */
export function waitingActionDo(action: WaitingLinkAction): Exclude<WaitingLinkAction, 'answer'> | undefined {
    return action === 'answer' ? undefined : action;
}

/** A piece of text: plain, or an http(s) address to be a link. */
export type TextPiece = { text: string; url?: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/g;
/** More closing than opening brackets: the last one closes the text around the address. */
const unbalanced = (t: string): boolean => (t.match(/\)/g)?.length ?? 0) > (t.match(/\(/g)?.length ?? 0);

/**
 * Split text into plain pieces and http(s) addresses (closing punctuation
 * stays outside the link). Only addresses the URL parser takes as http(s)
 * become links; the caller sets every piece as text, never as HTML.
 */
export function textWithLinks(text: string): TextPiece[] {
    const out: TextPiece[] = [];
    let last = 0;
    for (const m of text.matchAll(URL_IN_TEXT)) {
        let raw = m[0];
        // "(see https://x.example/a)." keeps ")." out of the address.
        while (/[.,;:!?\]}»“”]$/.test(raw) || (raw.endsWith(')') && unbalanced(raw))) raw = raw.slice(0, -1);
        let url: string | null = null;
        try {
            const u = new URL(raw);
            url = u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
        } catch { /* not an address */ }
        if (!url) continue;
        const at = m.index ?? 0;
        if (at > last) out.push({ text: text.slice(last, at) });
        out.push({ text: raw, url });
        last = at + raw.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
}

// ==================== AN ITEM'S ACTIONS (spec 048 U6) ====================

/**
 * What an item waiting for images, a website or a check offers: images sent
 * from the app, its website, an answer, a talk with the agent, its folder.
 */
export type WaitAction = 'images' | 'web' | 'answer' | 'chat' | 'folder';

/**
 * One action as shown: how it goes (its mark: `bridge` none, `terminal` the
 * terminal mark, `web` "↗" in its text) and whether an agent starts working
 * (the AI badge beside the terminal mark).
 */
export interface WaitActionView {
    key: WaitAction;
    via: 'bridge' | 'terminal' | 'web';
    ai: boolean;
}

/** Images of a book: "Add images" leads, its website right beside (UIX O2 = A, Milan 4 Nov 2026). */
export const IMAGES_ORDER: readonly WaitAction[] = ['images', 'web', 'answer', 'chat', 'folder'];
/** A website without a book and a check: the answer leads. */
export const ANSWER_ORDER: readonly WaitAction[] = ['answer', 'web', 'chat', 'folder'];
/** Actions shown beside the main one (the rest under "More actions"); a wide item (≥ 760 px) one more. */
export const MAX_SECONDARY = 2;
export const MAX_SECONDARY_WIDE = 3;
/** A phone shows the main action and one more, nothing under "More actions". */
export const PHONE_SECONDARY = 1;

export interface WaitActionsContext {
    /** What the bridge takes here now (none when no bridge answers on this page). */
    writes: Pick<WaitingWrites, 'answer' | 'images'>;
    /** The research's task links open from here (this computer, its own research). */
    links: boolean;
    /** The phone layout (the overview's sheet). */
    phone: boolean;
    /** The order of an item waiting for images (default IMAGES_ORDER). */
    order?: readonly WaitAction[];
}

/** An item waits for images of a book: kind 'images', or a website with one book (its `inbox`). */
export function waitingForImages(w: LiveWaiting): boolean {
    return w.kind === 'images' || (w.kind === 'web' && !!w.inbox);
}

/**
 * The actions of an item waiting for images, a website or a check, in their
 * order (the first is the main one); each only when the research offers it
 * (`actions`) and it can go from here: images and an answer through the
 * bridge only with `accepts.media.taskImages` / `waiting.answer`, otherwise
 * the answer by the task link as before; the terminal's actions only where
 * the task links open (never on a phone); a check is answered in the
 * terminal. An older research that names no actions: the answer by the task
 * link and the website. Null for any other kind (its actions stay as they are).
 */
export function waitingActions(w: LiveWaiting, ctx: WaitActionsContext): WaitActionView[] | null {
    const images = waitingForImages(w);
    if (!images && w.kind !== 'web' && w.kind !== 'check') return null;
    const task = researchTaskRef(w.id);
    const said = w.actions;
    const offers = (a: 'answer' | 'images' | 'chat' | 'folder'): boolean => !!task && (said ? said.includes(a) : a === 'answer');
    const terminal = ctx.links && !ctx.phone;
    const out: WaitActionView[] = [];
    for (const key of images ? ctx.order ?? IMAGES_ORDER : ANSWER_ORDER) {
        if (key === 'web') {
            if (w.url) out.push({ key, via: 'web', ai: false });
        } else if (key === 'images') {
            if (images && ctx.writes.images && !ctx.phone && offers('images')) out.push({ key, via: 'bridge', ai: false });
        } else if (key === 'answer') {
            if (!offers('answer')) continue;
            // A check goes on in the terminal (the bridge says 409 waiting.no-answer).
            if (w.kind !== 'check' && ctx.writes.answer) out.push({ key, via: 'bridge', ai: false });
            else if (terminal) out.push({ key, via: 'terminal', ai: false });
        } else if (terminal && offers(key)) {
            out.push({ key, via: 'terminal', ai: key === 'chat' });
        }
    }
    return out;
}

/**
 * The actions as they stand: the main one and those beside it, the rest
 * under "More actions" (none on a phone: what does not fit is not offered there).
 */
export function splitWaitingActions<T = WaitActionView>(list: readonly T[], opts: { phone: boolean; wide?: boolean }):
    { shown: T[]; more: T[] } {
    const n = 1 + (opts.phone ? PHONE_SECONDARY : opts.wide ? MAX_SECONDARY_WIDE : MAX_SECONDARY);
    return { shown: list.slice(0, n), more: opts.phone ? [] : list.slice(n) };
}

// ==================== IMAGES OF A BOOK ====================

/** Most image numbers read out of a text ("57–58"). */
const MAX_LISTED_IMAGES = 1000;

/** The numbers of a text such as "57–58", "57, 59" or "112" (ascending, each once); null when it names none or too many. */
export function parseImageRanges(text: string | undefined): number[] | null {
    if (!text) return null;
    const out = new Set<number>();
    for (const m of text.matchAll(/(\d{1,6})(?:\s*[–—-]\s*(\d{1,6}))?/g)) {
        const a = imageNumber(Number(m[1]));
        const b = m[2] !== undefined ? imageNumber(Number(m[2])) : a;
        if (a === null || b === null || b < a || b - a >= MAX_LISTED_IMAGES) return null;
        for (let n = a; n <= b; n++) out.add(n);
        if (out.size > MAX_LISTED_IMAGES) return null;
    }
    return out.size ? [...out].sort((x, y) => x - y) : null;
}

/** Numbers as runs: [57, 58, 60] → "57–58, 60". */
export function imageRanges(nums: readonly number[]): string {
    const s = [...new Set(nums)].sort((a, b) => a - b);
    const out: string[] = [];
    for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
        out.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`);
        i = j + 1;
    }
    return out.join(', ');
}

/**
 * What the research says of an item's images: 'full' — the missing numbers
 * are known (research 1.27); 'old' — only how many of how many; 'unknown' —
 * how many it wants is not known (a website looked at for one book).
 */
export type ImagesDetail = 'full' | 'old' | 'unknown';

export interface ImagesState {
    have: number;
    want?: number;
    missing?: number[];
    book?: string;
    images?: string;
    detail: ImagesDetail;
    /** The numbers asked for and those saved, when they can be told (from `images` and `missing`). */
    wanted?: number[];
    saved?: number[];
}

/** The numbers asked for and those saved of an inbox, as far as they can be told. */
export function inboxNumbers(inbox: WaitingInbox): { wanted: number[]; saved: number[] } | null {
    if (inbox.want === undefined) return null;
    const missing = inbox.missing ?? null;
    let wanted = parseImageRanges(inbox.images);
    if (wanted && (wanted.length !== inbox.want || (missing && missing.some(n => !wanted!.includes(n))))) wanted = null;
    // Nothing saved yet: what is missing is all it asks for.
    if (!wanted && missing && inbox.have === 0 && missing.length === inbox.want) wanted = [...missing];
    if (!wanted) return missing ? { wanted: [...missing], saved: [] } : null;
    return { wanted, saved: missing ? wanted.filter(n => !missing.includes(n)) : [] };
}

/** The state of an item's images (its inbox); null when it waits for no images of a book. */
export function imagesState(w: LiveWaiting): ImagesState | null {
    const inbox = w.inbox;
    if (!inbox || !waitingForImages(w)) return null;
    const detail: ImagesDetail = inbox.want === undefined ? 'unknown' : inbox.missing ? 'full' : 'old';
    const nums = detail === 'full' ? inboxNumbers(inbox) : null;
    return {
        have: inbox.have,
        ...(inbox.want !== undefined ? { want: inbox.want } : {}),
        ...(inbox.missing ? { missing: [...inbox.missing] } : {}),
        ...(inbox.book ? { book: inbox.book } : {}),
        ...(inbox.images ? { images: inbox.images } : {}),
        detail,
        ...(nums ? { wanted: nums.wanted, saved: nums.saved } : {}),
    };
}

/** The numbers that arrived between two states of one item (missing before, not now). */
export function imagesArrived(before: ImagesState | null, now: ImagesState | null): number[] {
    if (!before?.missing || !now?.missing) return [];
    return before.missing.filter(n => !now.missing!.includes(n));
}

/** How many images a place's items miss together; null when none says (an older research) or none is missing. */
export function waitingGroupMissing(items: readonly LiveWaiting[]): number | null {
    let sum = 0;
    for (const w of items) sum += waitingForImages(w) ? w.inbox?.missing?.length ?? 0 : 0;
    return sum > 0 ? sum : null;
}

/** Files a task takes as images of its book (`<input accept>`; the research reads PDF page by page). */
export const TASK_IMAGE_EXT: readonly string[] = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'pdf'];
export const TASK_IMAGE_ACCEPT = TASK_IMAGE_EXT.map(e => `.${e}`).join(',');

/** A file's extension, lower case ('' = none). */
export function fileExt(name: string): string {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
    return m ? m[1].toLowerCase() : '';
}

/** Why a file cannot go before it is sent: not a kind the task takes, or larger than the research takes. */
export function taskImageProblem(file: { name: string; size?: number }, maxBytes: number): 'format' | 'size' | null {
    if (!TASK_IMAGE_EXT.includes(fileExt(file.name))) return 'format';
    return (file.size ?? 0) > maxBytes ? 'size' : null;
}

/** The image number a file's name says: its last group of digits ("DA_4-12_0058.tif" → 58), or null. */
export function imageNumberOfName(name: string): number | null {
    const base = name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
    const groups = base.match(/\d+/g);
    if (!groups) return null;
    const last = groups[groups.length - 1];
    return last.length <= 6 ? imageNumber(Number(last)) : null;
}

/**
 * How a file got its number: by its name, in order to the missing ones (the
 * counts match), by hand; 'pdf' — a lone PDF the research spreads over the
 * missing numbers itself; 'unknown' — the task does not know which images it
 * wants (sent without a number).
 */
export type ImageAssignHow = 'name' | 'order' | 'hand' | 'pdf' | 'unknown';

export interface ImageAssignment {
    /** The file's place in the list given. */
    index: number;
    /** The number it goes as (`X-Strom-Image`); null: none (see `how`). */
    num: number | null;
    /** null: it needs a number before anything is sent. */
    how: ImageAssignHow | null;
    /** The number its name says (null: none). */
    nameNum: number | null;
    /** Its name says a number the task does not ask for. */
    unwanted: boolean;
    /** Its number is saved already: 'ask' — found by itself, Replace or Keep the saved one; 'yes' — chosen by hand (`X-Strom-Replace`). */
    replace: 'no' | 'ask' | 'yes';
    /** It is not sent at all (checked before): not a kind the task takes, too large. */
    problem?: 'format' | 'size';
}

export interface ImagesAssigned {
    files: ImageAssignment[];
    /** Files without a number that need one (sending waits). */
    needAssign: number;
    /** Files whose number is saved already, not decided yet (sending waits). */
    needDecide: number;
    /** Files that will be sent. */
    sendable: number;
}

/**
 * Give files their image numbers (spec 048 §3). `want`: the numbers the task
 * asks for (null: not known — every file goes without a number); `have`:
 * those saved already. In turn: a number chosen by hand (`chosen`, by the
 * file's index; a saved one = replace it); the number of the file's name
 * when asked for and free; the files left, by name, in order to the missing
 * numbers left — only when they are as many; a lone PDF left goes without a
 * number (the research spreads its pages); the rest stay without one.
 */
export function assignImages(files: readonly { name: string; size?: number }[], want: readonly number[] | null, have: readonly number[],
    opts: { chosen?: readonly (number | null | undefined)[]; maxBytes?: number } = {}): ImagesAssigned {
    const wanted = want ? new Set(want) : null;
    const saved = new Set(have);
    const out: ImageAssignment[] = files.map((f, index) => {
        const problem = opts.maxBytes !== undefined ? taskImageProblem(f, opts.maxBytes) : TASK_IMAGE_EXT.includes(fileExt(f.name)) ? null : 'format';
        const nameNum = imageNumberOfName(f.name);
        return {
            index, num: null, how: null, nameNum, unwanted: !!wanted && nameNum !== null && !wanted.has(nameNum), replace: 'no',
            ...(problem ? { problem } : {}),
        };
    });
    const valid = out.filter(a => !a.problem);
    if (!wanted) {
        for (const a of valid) a.how = 'unknown';
        return summary(out);
    }
    const taken = new Set<number>();
    const give = (a: ImageAssignment, n: number, how: ImageAssignHow): void => {
        a.num = n;
        a.how = how;
        taken.add(n);
        a.replace = saved.has(n) ? (how === 'hand' ? 'yes' : 'ask') : 'no';
    };
    for (const a of valid) {
        const n = opts.chosen?.[a.index];
        if (typeof n === 'number' && wanted.has(n) && !taken.has(n)) give(a, n, 'hand');
    }
    const byName = [...valid].sort((x, y) => compareNames(files[x.index].name, files[y.index].name));
    for (const a of byName) {
        if (a.how === null && a.nameNum !== null && wanted.has(a.nameNum) && !taken.has(a.nameNum)) give(a, a.nameNum, 'name');
    }
    const left = byName.filter(a => a.how === null);
    const free = [...wanted].filter(n => !saved.has(n) && !taken.has(n)).sort((x, y) => x - y);
    if (left.length > 0 && left.length === free.length) {
        left.forEach((a, i) => give(a, free[i], 'order'));
    } else if (left.length === 1 && free.length > 1 && fileExt(files[left[0].index].name) === 'pdf') {
        left[0].how = 'pdf';
    }
    return summary(out);
}

function summary(files: ImageAssignment[]): ImagesAssigned {
    const valid = files.filter(a => !a.problem);
    return {
        files,
        needAssign: valid.filter(a => a.how === null).length,
        needDecide: valid.filter(a => a.replace === 'ask').length,
        sendable: valid.length,
    };
}

const compareNames = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/** One number a file may be given ("— choose number —" list): saved already (replaces it), or at another file. */
export interface ImageSlotOption {
    n: number;
    saved: boolean;
    /** The index of the other file that has it (the option is disabled). */
    takenBy?: number;
}

/** The numbers a file may be given, ascending: every one asked for, marked saved / at another file. */
export function imageSlotOptions(assigned: ImagesAssigned, index: number, want: readonly number[], have: readonly number[]): ImageSlotOption[] {
    const at = new Map<number, number>();
    for (const a of assigned.files) if (a.num !== null && a.index !== index) at.set(a.num, a.index);
    return [...new Set(want)].sort((x, y) => x - y).map(n => ({
        n, saved: have.includes(n), ...(at.has(n) ? { takenBy: at.get(n)! } : {}),
    }));
}
