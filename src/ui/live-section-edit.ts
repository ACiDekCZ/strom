/**
 * What "Customize panel" shows (the popover, the phone's bottom sheet and the
 * group in Settings) and what a section's own menu says: the rows in each
 * place's order and words, their quiet notes ("default, folded to fit · in
 * the overview: Progress"), the state a section without a choice is in now.
 * Pure: the drawing is in live-section-edit-ui.ts.
 */

import { strings } from '../strings.js';
import {
    DEFAULT_ORDER, PrefKey, SectionPref, SectionPrefs, TopKey, panelSectionOrder, sectionOrder, topTileShown,
} from './live-section-prefs.js';
import { FOLLOW_VIEWS } from '../live-follow-prefs.js';

/** Where the choices are made: the small panel's ⋯, the overview's ⋯, Settings. */
export type EditSurface = 'panel' | 'overview' | 'settings';

/** The three states, in the segment's order. */
export const SECTION_STATES: readonly SectionPref[] = ['expanded', 'collapsed', 'hidden'];

/** The default order: Now, Awaiting action, Directions, Progress, Queue, What the research knows. */
export const OVERVIEW_ORDER: readonly PrefKey[] = DEFAULT_ORDER;

/** How a section shows now without a choice, and whether the panel folded it for lack of room. */
export interface SectionNow { current: SectionPref; autoFolded: boolean }

/** One row of the editor. */
export interface SectionEditRow {
    key: PrefKey;
    label: string;
    /** "default[, folded to fit] · alias" ('' = nothing to say). */
    note: string;
    /** The stored choice (none: the default). */
    chosen: SectionPref | undefined;
    /** The state shown dashed when there is no choice (null in Settings: the default differs by place). */
    current: SectionPref | null;
}

/** "Follow in: Family / Fan / Map": the top row named with the views it offers (the row itself says only "Follow in"). */
function followInLabel(): string {
    return strings.live.topFollowIn(FOLLOW_VIEWS.map(v => strings.viewModeSwitch[v]).join(' / '));
}

/** A section's title where it is drawn (the panel's words, or the overview's). */
export function sectionTitle(surface: EditSurface, key: PrefKey): string {
    const r = strings.research;
    const L = strings.live;
    if (surface === 'overview') {
        switch (key) {
            case 'working': return L.now;
            case 'waiting': return r.waiting;
            case 'changes': return L.timeline;
            case 'queue': return L.queueTitle;
            case 'directions': return L.dirTitleEmpty;
            case 'knows': return L.knowsTitle;
        }
    }
    switch (key) {
        case 'working': return r.atWork;
        case 'waiting': return r.waiting;
        case 'changes': return r.changes;
        case 'queue': return r.queue;
        case 'directions': return L.dirTitleEmpty;
        case 'knows': return L.knowsTitle;
    }
}

/** The other place's name of a section, or that only the overview has it ('' = the same name). */
function sectionAlias(surface: EditSurface, key: PrefKey): string {
    const L = strings.live;
    if (surface === 'overview') {
        if (key === 'working' || key === 'changes') return L.inPanel(sectionTitle('panel', key));
        return '';
    }
    if (key === 'working' || key === 'changes') return L.inOverview(sectionTitle('overview', key));
    if (key === 'directions' || key === 'knows') return L.onlyInOverview;
    return '';
}

/** "default" or "default, folded to fit" for a section without a choice ('' with one). */
export function sectionDefaultNote(chosen: SectionPref | undefined, autoFolded: boolean): string {
    if (chosen) return '';
    const L = strings.live;
    return autoFolded ? `${L.sectionDefault}, ${L.autoFoldedNote}` : L.sectionDefault;
}

/**
 * The editor's rows, all six in the sections' order (one for every place;
 * in the panel and Settings the two the overview alone has say so in their
 * note), in each place's words. `now` says how a section shows at the
 * moment (not asked in Settings).
 */
export function sectionEditRows(surface: EditSurface, prefs: SectionPrefs, now: (key: PrefKey) => SectionNow,
    order: readonly PrefKey[] = sectionOrder()): SectionEditRow[] {
    return order.map((key) => {
        const chosen = prefs[key];
        const state = surface === 'settings' || chosen ? null : now(key);
        const note = [sectionDefaultNote(chosen, !!state?.autoFolded), sectionAlias(surface, key)].filter(Boolean).join(' · ');
        return {
            key,
            label: sectionTitle(surface, key),
            note,
            chosen,
            current: state ? state.current : null,
        };
    });
}

/** The head of a section's menu: its title, with "· default[, folded to fit]" while it has no choice. */
export function sectionMenuHead(title: string, chosen: SectionPref | undefined, autoFolded: boolean): string {
    const note = sectionDefaultNote(chosen, autoFolded);
    return note ? `${title} · ${note}` : title;
}

/** The label of a state in the segment and the menu. */
export function sectionStateLabel(v: SectionPref): string {
    const L = strings.live;
    return v === 'expanded' ? L.sectionExpanded : v === 'collapsed' ? L.sectionCollapsed : L.sectionHidden;
}

/**
 * The radio an arrow key moves to in a segment of `count` (roving
 * focus, wrapping); null: not an arrow.
 */
export function segmentArrowTarget(key: string, index: number, count: number): number | null {
    if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return null;
}

// ==================== The order (spec 057 §4) ====================

/**
 * Whether a section's menu offers Move up / Move down: where it stands in
 * the order of the place it is drawn in (the panel skips the two the
 * overview alone has).
 */
export function sectionMoves(order: readonly PrefKey[], key: PrefKey, surface: EditSurface): { up: boolean; down: boolean } {
    const shown: readonly PrefKey[] = surface === 'panel' ? panelSectionOrder(order) : order;
    const i = shown.indexOf(key);
    return { up: i > 0, down: i >= 0 && i < shown.length - 1 };
}

/**
 * The order after a section is dragged (pure): `at` is its new place among
 * the others (0 = first, their count = last).
 */
export function droppedOrder(order: readonly PrefKey[], key: PrefKey, at: number): PrefKey[] {
    const others = order.filter(k => k !== key);
    if (others.length === order.length) return [...order];
    others.splice(Math.max(0, Math.min(at, others.length)), 0, key);
    return others;
}

/** What a screen reader hears after a section moved in the editor (all six listed there). */
export function movedNote(surface: EditSurface, order: readonly PrefKey[], key: PrefKey): string {
    return strings.live.movedSr(sectionTitle(surface, key), order.indexOf(key) + 1, order.length);
}

// ==================== The top (spec 057 §2, §5) ====================

/** One part of a tile: a checkbox chip. */
export interface TopEditPart { key: TopKey; label: string; on: boolean; disabled: boolean }

/** A row of the card "At the top": the state (always shown), the two tiles with their parts, "Follow in". */
export interface TopEditRow {
    key: 'state' | 'day' | 'month' | 'followIn';
    label: string;
    /** The quiet line under the name ('' = none). */
    help: string;
    /** No switch: always shown. */
    locked: boolean;
    on: boolean;
    /** The switch cannot be used (this month on a phone). */
    disabled: boolean;
    parts: TopEditPart[];
}

/**
 * The card "At the top" (pure). `phone`: this month is not shown there (the
 * row greyed, saying so); `long`: Settings' longer word about the cost.
 */
export function topEditRows(top: Readonly<Record<TopKey, boolean>>, opts: { phone: boolean; long: boolean }): TopEditRow[] {
    const L = strings.live;
    const day = topTileShown(top, 'day');
    const month = topTileShown(top, 'month');
    const part = (key: TopKey, label: string, off: boolean): TopEditPart => ({ key, label, on: top[key], disabled: off });
    const priceNote = top['month.price'] ? '' : opts.long ? L.priceHelpLong : L.priceHelp;
    return [
        { key: 'state', label: L.state, help: '', locked: true, on: true, disabled: false, parts: [] },
        {
            key: 'day', label: L.topDay, help: '', locked: false, on: day, disabled: false,
            parts: [part('day.persons', L.partPersons, !day), part('day.sources', L.partSources, !day)],
        },
        {
            key: 'month', label: L.topMonth, help: opts.phone ? L.monthPhoneNote : priceNote, locked: false, on: month, disabled: opts.phone,
            parts: [part('month.sessions', L.partSessions, !month || opts.phone), part('month.price', L.partPrice, !month || opts.phone)],
        },
        { key: 'followIn', label: followInLabel(), help: L.followInHelp, locked: false, on: top.followIn, disabled: false, parts: [] },
    ];
}
