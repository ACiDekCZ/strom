/**
 * A live load of the research's tree for the screen reader (spec 055 §5):
 * one polite announcement per load of who came, changed, went or was merged,
 * at most one in 3 s (loads in between are merged into the next one). Said
 * with the motion off too.
 */

import type { PersonId, StromData } from '../types.js';
import type { LiveDiff } from '../live-diff.js';
import { strings } from '../strings.js';
import { shownNameFull } from '../person-name.js';

/** At most one announcement this often (ms). */
export const ANNOUNCE_GAP_MS = 3000;
/** Names said per kind of change; the rest is a count. */
const NAMES_SAID = 3;

/** The words of one load's change ('' when nothing a person sees changed). */
export function liveAnnouncement(diff: LiveDiff, previous: StromData, data: StromData): string {
    const L = strings.live;
    const nameIn = (d: StromData, id: PersonId): string => {
        const p = d.persons[id];
        return p ? shownNameFull(p, '?') : '?';
    };
    const listed = (names: string[]): string => {
        const said = names.slice(0, NAMES_SAID).join(', ');
        return names.length > NAMES_SAID ? `${said} ${L.srMore(names.length - NAMES_SAID)}` : said;
    };
    const parts: string[] = [];
    const added = diff.added.map(id => nameIn(data, id));
    if (added.length === 1) parts.push(L.srAdded(added[0]));
    else if (added.length > 1) parts.push(L.srAddedMany(added.length, listed(added)));
    const changed = [...diff.changed.keys()];
    if (changed.length === 1) parts.push(L.srChanged(nameIn(data, changed[0])));
    else if (changed.length > 1) parts.push(L.srChangedMany(changed.length));
    const removed = diff.removed.map(id => nameIn(previous, id));
    removed.slice(0, NAMES_SAID).forEach(n => parts.push(L.srRemoved(n)));
    if (removed.length > NAMES_SAID) parts.push(L.srMore(removed.length - NAMES_SAID));
    const merged = [...diff.merged];
    merged.slice(0, NAMES_SAID).forEach(([gone, kept]) => parts.push(L.srMerged(nameIn(previous, gone), nameIn(data, kept))));
    if (merged.length > NAMES_SAID) parts.push(L.srMore(merged.length - NAMES_SAID));
    return parts.join('. ');
}

let lastAt = 0;
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function region(): HTMLElement {
    let el = document.getElementById('live-announce');
    if (!el) {
        el = document.createElement('div');
        el.id = 'live-announce';
        el.className = 'visually-hidden';
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    return el;
}

function say(): void {
    timer = null;
    if (pending.length === 0) return;
    const text = pending.join('. ');
    pending = [];
    lastAt = Date.now();
    const el = region();
    // A new text node each time: the same words twice are announced again.
    el.textContent = '';
    el.textContent = text;
}

/** Announce a live load (merged with the ones of the next 3 s). */
export function announceLive(diff: LiveDiff, previous: StromData, data: StromData): void {
    if (typeof document === 'undefined') return;
    const text = liveAnnouncement(diff, previous, data);
    if (!text) return;
    pending.push(text);
    if (timer) return;
    const wait = lastAt + ANNOUNCE_GAP_MS - Date.now();
    if (wait <= 0) say();
    else timer = setTimeout(say, wait);
}

/** Tests: forget the timing. */
export function resetLiveAnnounce(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = [];
    lastAt = 0;
}
