/**
 * What "Customize panel" shows (the popover, the phone's bottom sheet and the
 * group in Settings) and what a section's own menu says: the rows in each
 * place's order and words, their quiet notes ("default, folded to fit · in
 * the overview: Progress"), the state a section without a choice is in now.
 * Pure: the drawing is in live-section-edit-ui.ts.
 */

import { strings } from '../strings.js';
import { DEFAULT_ORDER, PrefKey, SectionPref, SectionPrefs, sectionOrder } from './live-section-prefs.js';

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
