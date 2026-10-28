/**
 * History of places — the manager (#history-modal, spec 020 K4.3/K4.4).
 *
 * Pure model of the dialog: the regions grouped as the research takes them
 * (or derived from the events for an older research), the places with their
 * regions and states, the tree's hidings and the events deleted on this
 * computer, the header's sentence and the search without diacritics. Which
 * action a row offers goes only by `/status.features` and a running bridge.
 * The DOM half is `src/ui/history-manage-ui.ts`.
 */

import {
    computePersonHistory, HISTORY_KINDS, type PersonHistoryEnv,
    effectiveHidden, historyHiddenCount, historyWaiting, pickHistoryText,
    type HistoryPayload, type HistoryRegion, type HistoryHideOp, type HistoryEvent, type HistoryText,
    type EffectiveHidden, type HistoryPlace, type HistoryPlaceRegion,
} from './history.js';
import {
    HISTORY_FIRST_FEATURE, HISTORY_HIDE_ALL_FEATURE, HISTORY_SKIP_FEATURE, HISTORY_DELETE_FEATURE,
    HISTORY_MAP_FEATURE, HISTORY_PLACE_FEATURE, HISTORY_HIDE_FEATURE, type HistoryPace,
} from './research-link.js';
import { getStringsForLang, joinAnd, type Language } from './strings.js';
import type { StromData } from './types.js';

export type ManageTab = 'regions' | 'places' | 'hidden' | 'deleted';

/** What the manager knows besides the payload. */
export interface ManageEnv {
    lang: Language;
    /** `/status.features` of the bridge's last status ([] when none is known). */
    features: readonly string[];
    /** The research's bridge answers now. */
    bridgeUp: boolean;
    /** Hidings waiting for the bridge. */
    queue?: readonly HistoryHideOp[];
    /** `tree.state` (`research`, `archive`, `waiting`) when known. */
    treeState?: string;
    /** `/status.experiments.history` while the bridge runs. */
    searchOn?: boolean;
    /** The search was switched off from here. */
    offDone?: boolean;
    /** "Switch the search on" may be offered (the `experiment` link). */
    canLinkOn?: boolean;
    /** `/status.experiments.historyPace`. */
    pace?: HistoryPace;
    formatDate: (iso: string) => string;
    formatTime: (iso: string) => string;
}

/** Names the tree gives (its spelling of a place, a person's shown name). */
export interface ManageNames {
    /** The tree's spelling of a payload place key (the key itself when the tree has none). */
    place: (key: string) => string;
    /** A person by REFN or tree id ('' unknown). */
    person: (refn?: string, id?: string) => string;
}

export type ManageAction = 'first' | 'hideAll' | 'skip' | 'delete' | 'map' | 'place' | 'hide';

/** An action of the manager is offered (§0 gates): its feature, and a running bridge unless it can wait in the queue. */
export function manageCan(env: Pick<ManageEnv, 'features' | 'bridgeUp'>, action: ManageAction): boolean {
    const f = env.features;
    switch (action) {
        // Hidings go to the queue without the bridge (the features of the last status).
        case 'hide': return f.includes(HISTORY_HIDE_FEATURE);
        case 'hideAll': return f.includes(HISTORY_HIDE_ALL_FEATURE);
        case 'first': return env.bridgeUp && f.includes(HISTORY_FIRST_FEATURE);
        case 'skip': return env.bridgeUp && f.includes(HISTORY_SKIP_FEATURE);
        case 'delete': return env.bridgeUp && f.includes(HISTORY_DELETE_FEATURE);
        case 'map': return env.bridgeUp && f.includes(HISTORY_MAP_FEATURE);
        case 'place': return env.bridgeUp && f.includes(HISTORY_PLACE_FEATURE);
    }
}

/** The research searches for the tree (the status's word while the bridge runs, else the copy's). */
export function manageSearchOn(p: HistoryPayload, env: Pick<ManageEnv, 'bridgeUp' | 'searchOn' | 'offDone'>): boolean {
    if (env.offDone) return false;
    return env.bridgeUp && env.searchOn !== undefined ? env.searchOn : p.state.on;
}

// ─── Search ────────────────────────────────────────────────────────────────

/** Lower case without diacritics ("Čáslav" → "caslav"). */
export function foldSearch(s: string): string {
    return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Every word of the query is in the row's search text (both folded). */
export function matchesQuery(haystack: string, query: string): boolean {
    const words = foldSearch(query).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    return words.every(w => haystack.includes(w));
}

function searchText(...parts: (string | undefined | null)[]): string {
    return foldSearch(parts.filter(Boolean).join(' \u0001 '));
}

function allTexts(t: HistoryText | undefined): string[] {
    return t ? Object.values(t) : [];
}

// ─── Regions ───────────────────────────────────────────────────────────────

/** A region's name in the UI language (then English, then any, then its id). */
export function regionName(r: { id: string; name?: HistoryText }, lang: string): string {
    const n = r.name;
    if (!n) return r.id;
    return n[lang] || n.en || Object.values(n).find(Boolean) || r.id;
}

/**
 * The tree's regions: R1 `regions`, or (an older research) the regions the
 * events name, without state (`derived`).
 */
export function manageRegions(p: HistoryPayload): { regions: HistoryRegion[]; derived: boolean } {
    if (p.regions) return { regions: Object.values(p.regions), derived: false };
    const byId = new Map<string, HistoryRegion>();
    for (const ev of p.events) {
        if (ev.scope !== 'region' || !ev.region) continue;
        const r = byId.get(ev.region.id);
        if (r) {
            r.events = (r.events ?? 0) + 1;
            if (!r.name && ev.region.name) r.name = ev.region.name;
        } else {
            byId.set(ev.region.id, { id: ev.region.id, ...(ev.region.name ? { name: ev.region.name } : {}), state: 'none', events: 1 });
        }
    }
    return { regions: [...byId.values()], derived: true };
}

/** A region's parent (R1 has none): the region whose `covered` names it (a state over its lands). */
export function regionParents(regions: readonly HistoryRegion[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of regions) {
        for (const child of r.covered ?? []) {
            if (child !== r.id && !out.has(child)) out.set(child, r.id);
        }
    }
    return out;
}

/** "1870–1913, 1920–1935". */
export function gapsLabel(gaps: readonly { from: number; to: number }[]): string {
    return gaps.map(g => (g.from === g.to ? String(g.from) : `${g.from}–${g.to}`)).join(', ');
}

export type ManageTone = 'primary' | 'light' | 'accent' | 'faint';
export type RegionRowAction = 'first' | 'hideAll' | 'skip';

export interface RegionRow {
    /** Region id, `local` (from research sources) or `place:<payload key>` (a place's own history). */
    key: string;
    kind: 'region' | 'local' | 'place';
    name: string;
    /** The parent region's name, or "Local history" for a place ('' none). */
    parent: string;
    /** "12 places · 40 people" / "state above its lands" / a description. */
    meta: string;
    /** "years without events 1870–1913 · filling queued" ('' none). */
    gaps: string;
    /** The state's mark and text ('' none: an older research or `none`). */
    glyph: string;
    tone: ManageTone;
    state: string;
    /** waiting: the research's sentence. */
    why: string;
    /** A link under the state: search again (skipped) or show again (everything hidden). */
    link: 'searchAgain' | 'showAgain' | null;
    /** Events of the catalogue (hidden ones too); null shows "–" (queued, nothing yet). */
    events: number | null;
    /** Hidden in this tree. */
    hidden: number;
    /** Dimmed (skipped, everything hidden). */
    dim: boolean;
    /** Has events: "›" and a click opens its detail. */
    open: boolean;
    /** The "⋯" menu's items (empty: no "⋯"). */
    actions: RegionRowAction[];
    search: string;
}

export interface RegionGroup {
    /** queue / done / skip / noRegion; `all` for an older research (one list without state). */
    key: 'queue' | 'done' | 'skip' | 'noRegion' | 'all';
    rows: RegionRow[];
    /** The research does not search (archive, waits): the queue's note says so. */
    archive?: boolean;
}

function regionEventCounts(p: HistoryPayload): Map<string, number> {
    const out = new Map<string, number>();
    for (const ev of p.events) {
        if (ev.scope === 'region' && ev.region) out.set(ev.region.id, (out.get(ev.region.id) ?? 0) + 1);
    }
    return out;
}

/** Distinct hidden events by what they belong to (`r:<region>`, `local`, `p:<place key>`). */
function hiddenEventCounts(p: HistoryPayload, hidden: readonly EffectiveHidden[]): Map<string, number> {
    const byId = new Map(p.events.map(e => [e.id, e]));
    const seen = new Set<string>();
    const out = new Map<string, number>();
    const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
    for (const h of hidden) {
        if (!h.event || seen.has(h.event)) continue;
        const ev = byId.get(h.event);
        if (!ev) continue;
        seen.add(h.event);
        add(eventOwner(ev));
    }
    return out;
}

function eventOwner(ev: HistoryEvent): string {
    if (ev.scope === 'region') return `r:${ev.region?.id ?? ''}`;
    if (ev.scope === 'place') return `p:${ev.place?.key ?? ''}`;
    return 'local';
}

/** Region ids hidden as a whole in this tree (R2). */
export function hiddenRegionIds(p: HistoryPayload, queue: readonly HistoryHideOp[] = []): Set<string> {
    return new Set(effectiveHidden(p, queue).filter(h => !h.event && h.region).map(h => h.region!));
}

const QUEUE_RANK: Record<string, number> = { running: 0, first: 1, queued: 2, waiting: 3, none: 4 };

function queueRank(r: HistoryRegion): number {
    if (r.state === 'queued' && r.first) return QUEUE_RANK.first;
    return QUEUE_RANK[r.state] ?? 5;
}

/** The Regions tab (§1.4): queue, done, not searched, without region. */
export function regionGroups(p: HistoryPayload, env: ManageEnv, names: ManageNames): RegionGroup[] {
    const s = getStringsForLang(env.lang).history;
    const lang = env.lang;
    const { regions, derived } = manageRegions(p);
    const parents = regionParents(regions);
    const byId = new Map(regions.map(r => [r.id, r]));
    const counts = regionEventCounts(p);
    const hidden = effectiveHidden(p, env.queue ?? []);
    const hiddenCounts = hiddenEventCounts(p, hidden);
    const wholeHidden = new Set(hidden.filter(h => !h.event && h.region).map(h => h.region!));
    const archive = historyWaiting(p, env.treeState);
    const collator = new Intl.Collator(lang);
    // Search off: "Find first" leads nowhere (the header offers switching it on).
    const canFirst = manageCan(env, 'first') && !derived && manageSearchOn(p, env);
    const canHideAll = manageCan(env, 'hideAll');
    const canSkip = manageCan(env, 'skip') && !derived;

    const rowOf = (r: HistoryRegion): RegionRow => {
        const name = regionName(r, lang);
        const parentId = parents.get(r.id);
        const parent = parentId ? regionName(byId.get(parentId) ?? { id: parentId }, lang) : '';
        const events = r.events ?? counts.get(r.id) ?? 0;
        const inQueue = ['queued', 'running', 'waiting'].includes(r.state);
        const hiddenAll = wholeHidden.has(r.id);
        const row: RegionRow = {
            key: r.id, kind: 'region', name, parent,
            meta: r.state === 'covered' ? s.regionOver
                : r.places !== undefined || r.persons !== undefined ? s.regionMeta(r.places ?? 0, r.persons ?? 0) : '',
            gaps: '',
            glyph: '', tone: 'light', state: '', why: '', link: null,
            events: events === 0 && inQueue ? null : events,
            hidden: r.hidden ?? hiddenCounts.get(`r:${r.id}`) ?? 0,
            dim: false,
            open: events > 0,
            actions: [],
            search: searchText(name, ...allTexts(r.name), parent, r.id),
        };
        if (r.state === 'done' && r.gaps?.length) {
            row.gaps = s.regionGaps(gapsLabel(r.gaps))
                + (r.fill === 'queued' ? ` ${s.gapsFillQueued}` : r.fill === 'running' ? ` ${s.gapsFillRunning}` : '');
        } else if (r.state === 'done' && r.fill) {
            // A task for new years without gaps: the region is not complete yet.
            row.gaps = r.fill === 'running' ? s.fillOnlyRunning : s.fillOnlyQueued;
        }
        const set = (glyph: string, tone: ManageTone, state: string) => { row.glyph = glyph; row.tone = tone; row.state = state; };
        if (hiddenAll) {
            set('–', 'faint', s.rsHiddenAll);
            row.dim = true;
            if (canHideAll) row.link = 'showAgain';
        } else if (archive && inQueue) {
            // The research does not search: the queue waits (its sentence is the header's).
            set('‖', 'accent', s.rsWaiting);
        } else {
            switch (r.state) {
                case 'running': set('●', 'primary', s.rsRunning); break;
                case 'queued':
                    if (r.first) set('↑', 'primary', s.rsFirst);
                    else set('–', 'light', r.order === 1 ? s.rsNext : r.order ? s.rsQueued(r.order) : s.rsQueuedPlain);
                    break;
                case 'waiting':
                    set('‖', 'accent', s.rsWaiting);
                    row.why = r.why ?? '';
                    break;
                case 'done': set('✓', 'light', s.rsDone(r.at ? env.formatDate(r.at) : '')); break;
                case 'covered':
                    set('⊂', 'faint', s.rsCovered(joinAnd(lang, (r.covered ?? []).map(id => regionName(byId.get(id) ?? { id }, lang)))));
                    break;
                case 'skipped':
                    set('–', 'faint', s.rsSkipped);
                    row.dim = true;
                    if (canSkip) row.link = 'searchAgain';
                    break;
                default: break;
            }
        }
        if (canFirst && !archive && !hiddenAll && ((r.state === 'queued' && !r.first) || r.state === 'waiting')) row.actions.push('first');
        if (canHideAll && !hiddenAll && (events > 0 || inQueue)) row.actions.push('hideAll');
        if (canSkip && inQueue) row.actions.push('skip');
        return row;
    };

    const groups: RegionGroup[] = [];
    if (derived) {
        const rows = regions.map(rowOf).sort((a, b) => collator.compare(a.name, b.name));
        if (rows.length) groups.push({ key: 'all', rows });
    } else {
        const queue = regions.filter(r => ['running', 'queued', 'waiting', 'none'].includes(r.state))
            .sort((a, b) => queueRank(a) - queueRank(b)
                || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
                || collator.compare(regionName(a, lang), regionName(b, lang)));
        const byName = (a: HistoryRegion, b: HistoryRegion) => collator.compare(regionName(a, lang), regionName(b, lang));
        const done = regions.filter(r => r.state === 'done').sort(byName);
        const skip = regions.filter(r => r.state === 'covered' || r.state === 'skipped')
            .sort((a, b) => Number(a.state === 'skipped') - Number(b.state === 'skipped') || byName(a, b));
        if (queue.length) groups.push({ key: 'queue', rows: queue.map(rowOf), ...(archive ? { archive: true } : {}) });
        if (done.length) groups.push({ key: 'done', rows: done.map(rowOf) });
        if (skip.length) groups.push({ key: 'skip', rows: skip.map(rowOf) });
    }

    // Without region: the tree's own findings, and every place with its own history.
    const noRegion: RegionRow[] = [];
    const localEvents = p.events.filter(e => e.scope === 'local').length;
    if (localEvents > 0) {
        noRegion.push({
            key: 'local', kind: 'local', name: s.kindLocal, parent: '', meta: s.localDesc, gaps: '',
            glyph: '', tone: 'light', state: '', why: '', link: null,
            events: localEvents, hidden: hiddenCounts.get('local') ?? 0, dim: false, open: true, actions: [],
            search: searchText(s.kindLocal, s.localDesc),
        });
    }
    const placeEvents = new Map<string, number>();
    for (const ev of p.events) if (ev.scope === 'place' && ev.place) placeEvents.set(ev.place.key, (placeEvents.get(ev.place.key) ?? 0) + 1);
    const placeRows: RegionRow[] = [];
    for (const [key, place] of Object.entries(p.places)) {
        const n = placeEvents.get(key) ?? 0;
        const st = place.history;
        if (!(n > 0 || st === 'first' || st === 'running')) continue;
        const name = s.placeAround(names.place(key));
        const area = pickHistoryText(place.area, lang, p.lang)?.text ?? '';
        const row: RegionRow = {
            key: `place:${key}`, kind: 'place', name, parent: s.kindPlace, meta: area, gaps: '',
            glyph: '', tone: 'light', state: '', why: '', link: null,
            events: n, hidden: hiddenCounts.get(`p:${key}`) ?? 0, dim: false, open: n > 0, actions: [],
            search: searchText(name, key, ...(place.also ?? []), area),
        };
        if (st === 'first') { row.glyph = '↑'; row.tone = 'primary'; row.state = s.rsFirst; }
        else if (st === 'running') { row.glyph = '●'; row.tone = 'primary'; row.state = s.rsRunning; }
        else if (st === 'done') { row.glyph = '✓'; row.state = s.rsDone(place.at ? env.formatDate(place.at) : ''); }
        else if (st === 'waiting') { row.glyph = '‖'; row.tone = 'accent'; row.state = s.rsWaiting; row.why = place.why ?? ''; }
        else if (st === 'empty') { row.glyph = '–'; row.tone = 'faint'; row.state = s.placeHistEmpty; }
        placeRows.push(row);
    }
    placeRows.sort((a, b) => collator.compare(a.name, b.name));
    noRegion.push(...placeRows);
    if (noRegion.length) groups.push({ key: 'noRegion', rows: noRegion });
    return groups;
}

// ─── Places ────────────────────────────────────────────────────────────────

export type PlaceSort = 'persons' | 'alpha';
export type PlaceRowAction = 'changeRegion' | 'placeFind' | 'skip' | 'openInPlaces';

export interface PlaceRow {
    /** The payload's place key. */
    key: string;
    name: string;
    /** Regions with years · people ('' an older research). */
    meta: string;
    /** unlocated: the research's sentence. */
    why: string;
    persons: number;
    state: string;
    tone: ManageTone;
    /** searchAgain: skipped; auto: regions set by hand, back to the research's choice (R5 `do: "auto"`). */
    link: 'searchAgain' | 'auto' | null;
    /** Events through the place (null: not shown). */
    events: number | null;
    dim: boolean;
    /** Unassigned: "Assign region". */
    assign: boolean;
    /** Suggested: "Find local history…". */
    find: boolean;
    actions: PlaceRowAction[];
    search: string;
}

export interface PlaceGroup {
    key: 'unassigned' | 'suggest' | 'all';
    rows: PlaceRow[];
}

function placeRegionsLabel(place: HistoryPlace, regions: Map<string, HistoryRegion>, lang: Language): string {
    const s = getStringsForLang(lang).history;
    const parts = (place.regions ?? []).map(r => {
        const name = regionName(regions.get(r.id) ?? { id: r.id }, lang);
        if (r.from !== undefined && r.to !== undefined) return s.placeRegionYears(name, r.from, r.to);
        if (r.from !== undefined) return s.placeRegionFrom(name, r.from);
        if (r.to !== undefined) return s.placeRegionTo(name, r.to);
        return name;
    });
    if (!parts.length) return '';
    return parts.join(' · ') + (place.manual ? ` ${s.mapManual}` : '');
}

/** The Places tab (§1.5): unassigned, suggested for their own history, all. */
export function placeGroups(p: HistoryPayload, env: ManageEnv, names: ManageNames, sort: PlaceSort = 'persons'): PlaceGroup[] {
    const s = getStringsForLang(env.lang).history;
    const lang = env.lang;
    const collator = new Intl.Collator(lang);
    const r1 = !!p.regions;
    const regions = new Map(Object.entries(p.regions ?? {}));
    const placeEvents = new Map<string, number>();
    for (const ev of p.events) if (ev.scope === 'place' && ev.place) placeEvents.set(ev.place.key, (placeEvents.get(ev.place.key) ?? 0) + 1);
    const canMap = r1 && manageCan(env, 'map');
    const canPlace = r1 && manageCan(env, 'place') && manageSearchOn(p, env);
    const canSkip = r1 && manageCan(env, 'skip');

    const rowOf = (key: string, place: HistoryPlace): PlaceRow => {
        const name = names.place(key);
        const regionText = r1 ? placeRegionsLabel(place, regions, lang) : '';
        const persons = place.persons ?? 0;
        const meta = r1 ? [regionText, place.persons !== undefined ? s.placePersons(persons) : ''].filter(Boolean).join(' · ') : '';
        const row: PlaceRow = {
            key, name, meta, why: '', persons, state: '', tone: 'light', link: null,
            events: place.events.length, dim: false, assign: false, find: false, actions: [],
            search: searchText(name, key, ...(place.also ?? []), regionText),
        };
        if (place.skip) {
            row.state = s.rsSkipped;
            row.tone = 'faint';
            row.dim = true;
            if (canSkip) row.link = 'searchAgain';
        } else if (r1 && place.redo) {
            // Waits to be placed again (§4.2): no way back — the research keeps no earlier choice.
            row.state = s.redoState;
            row.tone = 'accent';
            if (place.note) row.why = s.redoNoteShown(place.note);
        } else if (!r1) {
            if (place.state === 'pending') row.state = s.placeStatePending;
            else if (place.state === 'unlocated') row.state = s.placeStateUnlocated;
        } else if (place.state === 'unlocated') {
            row.state = s.placeStateUnlocated;
            row.tone = 'faint';
        } else if (place.state === 'pending') {
            if (place.regions?.length) { row.state = s.placeStateRegionWaits; row.tone = 'accent'; }
            else row.state = s.placeStateMapping;
        } else {
            switch (place.history) {
                case 'first': row.state = s.placeHistFirst; row.tone = 'primary'; break;
                case 'running': row.state = s.placeHistRunning; row.tone = 'primary'; break;
                case 'done': row.state = s.placeHistDone(placeEvents.get(key) ?? 0); break;
                case 'empty': row.state = s.placeHistEmpty; row.tone = 'faint'; break;
                case 'waiting': row.state = s.placeHistWaiting; row.tone = 'accent'; break;
                default: break;
            }
        }
        if (r1 && place.manual && place.regions?.length && !place.skip) {
            // Set by hand (§4.3): what happens next, and the way back to the research's choice.
            if (!place.events.length) row.why = mapResultText(p, place.regions.map(r => r.id), lang);
            if (canMap) row.link = 'auto';
        }
        if (r1) {
            if (canMap && !place.skip) row.actions.push('changeRegion');
            if (canPlace && place.id && (!place.history || place.history === 'none') && !place.skip) row.actions.push('placeFind');
            if (canSkip && !place.skip) row.actions.push('skip');
            row.actions.push('openInPlaces');
        }
        return row;
    };

    const entries = Object.entries(p.places);
    const groups: PlaceGroup[] = [];
    if (r1) {
        const unassigned = entries.filter(([, pl]) => (pl.state === 'unlocated' || (pl.state === 'pending' && pl.redo)) && !pl.skip)
            .map(([k, pl]) => {
                const row = rowOf(k, pl);
                if (pl.redo) {
                    // "The research will decide again · 3 people", the note below (§4.2, 4e).
                    row.meta = [s.redoState, row.meta].filter(Boolean).join(' · ');
                    row.state = '';
                    return row;
                }
                row.why = pl.why ?? '';
                row.state = '';
                row.assign = canMap;
                row.actions = row.actions.filter(a => a !== 'changeRegion');
                return row;
            })
            .sort((a, b) => b.persons - a.persons || collator.compare(a.name, b.name));
        if (unassigned.length) groups.push({ key: 'unassigned', rows: unassigned });
        if (canPlace && p.suggest?.length) {
            const byId = new Map(entries.filter(([, pl]) => pl.id).map(([k, pl]) => [pl.id!, k]));
            const rows: PlaceRow[] = [];
            for (const id of p.suggest) {
                const k = byId.get(id);
                if (!k) continue;
                const pl = p.places[k];
                if ((pl.history && pl.history !== 'none') || pl.skip) continue;
                const row = rowOf(k, pl);
                row.find = true;
                row.state = '';
                row.events = null;
                row.actions = [];
                rows.push(row);
                if (rows.length >= 5) break;
            }
            if (rows.length) groups.push({ key: 'suggest', rows });
        }
    }
    const all = entries.map(([k, pl]) => rowOf(k, pl));
    if (!r1) all.sort((a, b) => (b.events ?? 0) - (a.events ?? 0) || collator.compare(a.name, b.name));
    else if (sort === 'alpha') all.sort((a, b) => collator.compare(a.name, b.name));
    else all.sort((a, b) => b.persons - a.persons || collator.compare(a.name, b.name));
    if (all.length) groups.push({ key: 'all', rows: all });
    return groups;
}

// ─── Region of a place by hand (R5, §4) ────────────────────────────────────

/** A region in the picker's list: a state over its lands first, its lands indented under it. */
export interface PickerRegion {
    id: string;
    name: string;
    /** The parent's name ('' a top region). */
    parent: string;
    /** "state" / "87 places". */
    meta: string;
    indent: boolean;
    search: string;
}

/** A chosen region with its years as typed. */
export interface PickerChoice {
    id: string;
    from: string;
    to: string;
}

export interface RegionPicker {
    /** The tree's spelling of the place. */
    place: string;
    /** "Research: several places of that name · 3 people". */
    why: string;
    list: PickerRegion[];
    /** The place's regions now. */
    chosen: PickerChoice[];
    /** The note's placeholder (the research's sentence). */
    notePh: string;
}

/** The picker for a place (null: no R1 regions or no such place). */
export function regionPicker(p: HistoryPayload, lang: Language, names: ManageNames, key: string): RegionPicker | null {
    const place = p.places[key];
    if (!place || !p.regions) return null;
    const s = getStringsForLang(lang).history;
    const regions = Object.values(p.regions);
    const parents = regionParents(regions);
    const byId = new Map(regions.map(r => [r.id, r]));
    const collator = new Intl.Collator(lang);
    const children = new Map<string, HistoryRegion[]>();
    for (const r of regions) {
        const parent = parents.get(r.id);
        if (parent && byId.has(parent)) children.set(parent, [...(children.get(parent) ?? []), r]);
    }
    const weight = (r: HistoryRegion): number => (r.places ?? 0) + (children.get(r.id) ?? []).reduce((n, c) => n + (c.places ?? 0), 0);
    const order = (a: HistoryRegion, b: HistoryRegion) => weight(b) - weight(a) || collator.compare(regionName(a, lang), regionName(b, lang));
    const item = (r: HistoryRegion, indent: boolean): PickerRegion => {
        const name = regionName(r, lang);
        const parentId = parents.get(r.id);
        const parent = parentId && byId.has(parentId) ? regionName(byId.get(parentId)!, lang) : '';
        const isState = (children.get(r.id) ?? []).length > 0 || r.state === 'covered';
        return {
            id: r.id, name, parent, indent,
            meta: isState ? s.mapStateRegion : r.places !== undefined ? s.mapPlaces(r.places) : '',
            search: searchText(name, ...allTexts(r.name), parent, r.id),
        };
    };
    const list: PickerRegion[] = [];
    for (const r of regions.filter(x => !parents.has(x.id) || !byId.has(parents.get(x.id)!)).sort(order)) {
        list.push(item(r, false));
        for (const c of (children.get(r.id) ?? []).sort(order)) list.push(item(c, true));
    }
    const label = place.regions?.length ? placeRegionsLabel({ ...place, manual: false }, byId, lang) : '';
    const persons = place.persons ?? 0;
    const why = label ? s.mapWhy(label, persons)
        : place.why ? s.mapWhy(place.why, persons)
            : persons ? s.mapWhyPersons(persons) : '';
    return {
        place: names.place(key),
        why,
        list,
        chosen: (place.regions ?? []).filter(r => byId.has(r.id))
            .map(r => ({ id: r.id, from: r.from !== undefined ? String(r.from) : '', to: r.to !== undefined ? String(r.to) : '' })),
        notePh: place.note ?? place.why ?? '',
    };
}

/** A typed year: undefined empty, null not a year of 100–9999 (3–4 digits). */
export function pickerYear(v: string): number | undefined | null {
    const t = v.trim();
    if (!t) return undefined;
    if (!/^\d{3,4}$/.test(t)) return null;
    const n = Number(t);
    return n >= 100 && n <= 9999 ? n : null;
}

export type PickerProblem = 'years' | 'overlap' | null;

/**
 * The chosen regions' years (§4.1): each a year of 100–9999 with from ≤ to;
 * two regions (not a state and its land) must not share a period — touching
 * ends ("Moravia until 1850 · Bohemia from 1850") do not overlap.
 */
export function pickerCheck(p: HistoryPayload, chosen: readonly PickerChoice[]): { rows: PickerProblem[]; ok: boolean } {
    const parents = regionParents(Object.values(p.regions ?? {}));
    const related = (a: string, b: string) => parents.get(a) === b || parents.get(b) === a;
    const spans = chosen.map(c => ({ from: pickerYear(c.from), to: pickerYear(c.to) }));
    const rows: PickerProblem[] = spans.map(x =>
        x.from === null || x.to === null || (x.from !== undefined && x.to !== undefined && x.from > x.to) ? 'years' : null);
    for (let i = 0; i < chosen.length; i++) {
        for (let j = i + 1; j < chosen.length; j++) {
            if (rows[i] === 'years' || rows[j] === 'years' || related(chosen[i].id, chosen[j].id)) continue;
            const a = spans[i], b = spans[j];
            const lo = (y: number | null | undefined) => y ?? -Infinity;
            const hi = (y: number | null | undefined) => y ?? Infinity;
            if (lo(a.from) < hi(b.to) && lo(b.from) < hi(a.to)) {
                rows[i] = rows[i] ?? 'overlap';
                rows[j] = rows[j] ?? 'overlap';
            }
        }
    }
    return { rows, ok: chosen.length > 0 && rows.every(r => r === null) };
}

/** The body of `POST /history/map` for the chosen regions (valid years only). */
export function pickerBody(chosen: readonly PickerChoice[]): HistoryPlaceRegion[] {
    return chosen.map(c => {
        const from = pickerYear(c.from), to = pickerYear(c.to);
        return { id: c.id, ...(typeof from === 'number' ? { from } : {}), ...(typeof to === 'number' ? { to } : {}) };
    });
}

/** What happens to the place with these regions (§4.1): done, searched now, queued; not searched for the tree. */
export function mapResultText(p: HistoryPayload, ids: readonly string[], lang: Language): string {
    const s = getStringsForLang(lang).history;
    const byState = new Map<string, string[]>();
    for (const id of ids) {
        const r = p.regions?.[id];
        if (!r) continue;
        const k = r.state === 'done' || r.state === 'covered' ? 'done' : r.state === 'running' ? 'running'
            : r.state === 'skipped' ? 'skipped' : 'queued';
        byState.set(k, [...(byState.get(k) ?? []), regionName(r, lang)]);
    }
    const out: string[] = [];
    const done = byState.get('done'), running = byState.get('running'), queued = byState.get('queued'), skipped = byState.get('skipped');
    if (running) out.push(s.mapResultRunning(joinAnd(lang, running)));
    if (done) out.push(s.mapResultDone(joinAnd(lang, done), done.length));
    if (queued) out.push(s.mapResultQueued(joinAnd(lang, queued), queued.length));
    for (const r of skipped ?? []) out.push(s.toastSkipped(r));
    return out.join(' ');
}

// ─── The History line of a place in Places (§4.6) ──────────────────────────

export interface PlacesHistoryLine {
    /** "Bohemia · done · 52 events · Local history: done · 12". */
    text: string;
    /** manage: the manager on this place; assign: the region picker at once. */
    action: 'manage' | 'assign';
    /** An older research: the whole line is the link "History: 64 events ›". */
    legacy: boolean;
}

/** The History line for a payload place (null: the payload has no such place). */
export function placesHistoryLine(p: HistoryPayload, env: ManageEnv, key: string): PlacesHistoryLine | null {
    const place = p.places[key];
    if (!place) return null;
    const s = getStringsForLang(env.lang).history;
    const lang = env.lang;
    const n = place.events.length;
    if (!p.regions) return { text: s.placesRowLegacy(n), action: 'manage', legacy: true };
    if (place.state === 'unlocated' && !place.skip) {
        return { text: s.placesRowUnassigned(place.why ?? ''), action: manageCan(env, 'map') ? 'assign' : 'manage', legacy: false };
    }
    const byId = new Map(Object.entries(p.regions));
    const lower = (t: string) => t.charAt(0).toLocaleLowerCase(lang) + t.slice(1);
    let state: string;
    if (place.skip) state = lower(s.rsSkipped);
    else if (place.redo) state = lower(s.redoState);
    else if (place.state === 'pending') state = lower(place.regions?.length ? s.placeStateRegionWaits : s.placeStateMapping);
    else {
        const states = (place.regions ?? []).map(r => byId.get(r.id)?.state);
        state = states.includes('running') ? s.placesRowRunning
            : states.some(x => x === 'queued' || x === 'waiting' || x === 'none') ? s.placesRowQueued : s.placesRowDone;
    }
    const own = p.events.filter(e => e.scope === 'place' && e.place?.key === key).length;
    const parts = [placeRegionsLabel(place, byId, lang), state, s.placeEvents(Math.max(0, n - own))];
    const hist = place.history === 'done' ? s.placeHistDone(own) : place.history === 'first' ? s.placeHistFirst
        : place.history === 'running' ? s.placeHistRunning : place.history === 'empty' ? s.placeHistEmpty
            : place.history === 'waiting' ? s.placeHistWaiting : '';
    return { text: [...parts.filter(Boolean), hist].filter(Boolean).join(' · '), action: 'manage', legacy: false };
}

// ─── Hidden ────────────────────────────────────────────────────────────────

export interface HiddenRow {
    hide: EffectiveHidden;
    /** Everything of a region (R2): "Show again". */
    region: boolean;
    year: string;
    text: string;
    /** Language of `text` (a `lang` attribute when it differs from the UI). */
    textLang: string;
    /** "{region} · {scope}" (+ "so far only in this browser"). */
    meta: string;
    search: string;
}

function yearLabel(from: number | undefined, to: number | undefined): string {
    if (from === undefined) return '';
    return to !== undefined && to !== from ? `${from}–${to}` : String(from);
}

function eventGroupName(ev: { scope: string; region?: { id: string; name?: HistoryText }; place?: { key: string; name?: HistoryText } },
    lang: Language, regions: Map<string, HistoryRegion>, names: ManageNames, payloadLang?: string): string {
    const s = getStringsForLang(lang).history;
    if (ev.scope === 'local') return s.kindLocal;
    if (ev.scope === 'place' && ev.place) {
        return pickHistoryText(ev.place.name, lang, payloadLang)?.text ?? names.place(ev.place.key);
    }
    if (ev.region) return regionName(regions.get(ev.region.id) ?? ev.region, lang);
    return '';
}

/** The Hidden tab (§3.6): newest first, each with its scope. */
export function hiddenRows(p: HistoryPayload, env: ManageEnv, names: ManageNames): HiddenRow[] {
    const s = getStringsForLang(env.lang).history;
    const lang = env.lang;
    const byId = new Map(p.events.map(e => [e.id, e]));
    const { regions: list } = manageRegions(p);
    const regions = new Map(list.map(r => [r.id, r]));
    const counts = regionEventCounts(p);
    const out: (HiddenRow & { at: number; order: number })[] = [];
    effectiveHidden(p, env.queue ?? []).forEach((h, order) => {
        const at = h.at ? Date.parse(h.at) : NaN;
        const pending = h.queued ? ` · ${s.pendingSync}` : '';
        if (!h.event) {
            if (!h.region) return;
            const r = regions.get(h.region) ?? { id: h.region, state: 'none' as const };
            const name = regionName(r, lang);
            out.push({
                hide: h, region: true, year: '', text: s.hiddenRegionRow(name), textLang: lang,
                meta: s.hiddenRegionMeta(r.events ?? counts.get(h.region) ?? 0) + pending,
                search: searchText(name, ...allTexts(r.name)), at, order,
            });
            return;
        }
        const ev = byId.get(h.event);
        if (!ev) return;
        const t = pickHistoryText(ev.text, lang, p.lang);
        if (!t) return;
        const group = eventGroupName(ev, lang, regions, names, p.lang);
        const scope = h.tree ? s.hiddenScopeTree
            : h.place ? s.scopePlace(names.place(h.place))
                : s.scopePersonNamed(names.person(h.person, h.personId) || h.person || '');
        out.push({
            hide: h, region: false, year: yearLabel(ev.from, ev.to), text: t.text, textLang: t.lang,
            meta: [group, scope].filter(Boolean).join(' · ') + pending,
            search: searchText(t.text, group, scope), at, order,
        });
    });
    // Newest first; without a time in the research's order, after the dated ones.
    out.sort((a, b) => {
        const ta = Number.isFinite(a.at) ? a.at : -Infinity;
        const tb = Number.isFinite(b.at) ? b.at : -Infinity;
        return tb - ta || b.order - a.order;
    });
    return out.map(({ at: _a, order: _o, ...row }) => row);
}

// ─── Deleted ───────────────────────────────────────────────────────────────

export interface DeletedRow {
    event: string;
    year: string;
    text: string;
    textLang: string;
    /** "{region} · deleted {date} · from all trees on this computer". */
    meta: string;
    search: string;
}

/** The Deleted tab (§3.2 A): newest first; without the event's copy only its id and the date. */
export function deletedRows(p: HistoryPayload, env: ManageEnv, names: ManageNames): DeletedRow[] {
    const s = getStringsForLang(env.lang).history;
    const lang = env.lang;
    const { regions: list } = manageRegions(p);
    const regions = new Map(list.map(r => [r.id, r]));
    return [...(p.deleted ?? [])]
        .map((d, i) => ({ d, i, at: d.at ? Date.parse(d.at) : NaN }))
        .sort((a, b) => (Number.isFinite(b.at) ? b.at : -Infinity) - (Number.isFinite(a.at) ? a.at : -Infinity) || a.i - b.i)
        .map(({ d }) => {
            const t = pickHistoryText(d.text, lang, p.lang);
            const group = eventGroupName(d, lang, regions, names, p.lang);
            const meta = [group, d.at ? s.deletedAt(env.formatDate(d.at)) : '', d.scope === 'local' ? s.deleteSubLocal : s.deleteSub]
                .filter(Boolean).join(' · ');
            return {
                event: d.event, year: yearLabel(d.from, d.to), text: t?.text ?? d.event, textLang: t?.lang ?? lang,
                meta, search: searchText(t?.text, group, d.event),
            };
        });
}

// ─── Header ────────────────────────────────────────────────────────────────

export interface ManageHeader {
    /** The state's sentence. */
    text: string;
    /** "Switch the search on in the research" after the sentence. */
    link: 'enable' | null;
    /** How often the research looks ('' not said). */
    pace: string;
    /** Notes in the accent colour (no bridge, incomplete result). */
    notes: string[];
    summary: string;
}

/** Counts for the summaries: regions, places, events (hidden too), hidden. */
export function manageCounts(p: HistoryPayload, queue: readonly HistoryHideOp[] = []): { regions: number; places: number; events: number; hidden: number } {
    return {
        regions: manageRegions(p).regions.length,
        places: Object.keys(p.places).length,
        events: p.events.length,
        hidden: historyHiddenCount(p, queue),
    };
}

/**
 * Places of the tree still waiting for the search: pending, not skipped, with a
 * region that is not skipped for the tree (`state.pending` counts those too).
 * Without R1 places (no regions on any place) the research's own count.
 */
export function waitingPlaces(p: HistoryPayload): number {
    const places = Object.values(p.places);
    if (!p.regions || !places.some(pl => pl.regions !== undefined || pl.persons !== undefined)) return p.state.pending ?? 0;
    let n = 0;
    for (const pl of places) {
        if (pl.state !== 'pending' || pl.skip) continue;
        const ids = pl.regions ?? [];
        if (ids.length && ids.every(r => p.regions![r.id]?.state === 'skipped')) continue;
        n++;
    }
    return n;
}

/** The header (§1.2): the state, the pace while it searches, the notes and the summary. */
export function manageHeader(p: HistoryPayload, env: ManageEnv): ManageHeader {
    const s = getStringsForLang(env.lang).history;
    const c = manageCounts(p, env.queue ?? []);
    const summary = s.manageSummaryFull(c.regions, c.places, c.events, c.hidden);
    const notes: string[] = [];
    let text: string;
    let link: ManageHeader['link'] = null;
    let searching = false;
    const searchOn = manageSearchOn(p, env);
    if (!env.bridgeUp) {
        text = `${s.statusAsOf(env.formatTime(p.cachedAt))} ${s.manageNoBridge}`;
        notes.push(s.manageNoBridgeNote);
    } else if (historyWaiting(p, env.treeState)) {
        text = `${s.statusWaiting(p.state.why)} ${s.statusFoundKept}`;
    } else if (!searchOn) {
        if (env.offDone) text = s.manageTreeOff;
        else if (env.canLinkOn) { text = s.manageOff; link = 'enable'; }
        else text = s.manageOffElsewhere;
    } else if (p.state.mapping) {
        text = s.manageMapping(p.state.mapping.mapped, p.state.mapping.mappable);
        searching = true;
    } else if (p.regions) {
        const list = Object.values(p.regions);
        const lang = env.lang;
        const running = list.find(r => r.state === 'running');
        const next = list.filter(r => r.state === 'queued')
            .sort((a, b) => Number(!!b.first) - Number(!!a.first) || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))[0];
        if (running) text = s.manageRunning(regionName(running, lang), waitingPlaces(p));
        else if (next) text = s.manageQueued(regionName(next, lang));
        else if (list.some(r => r.state === 'waiting')) text = s.stateSearching;
        else text = s.manageDone;
        searching = true;
    } else {
        // An older research: the sentences of the card's layer, without region or count.
        const pending = (p.state.pending ?? 0) > 0 || p.state.search === 'running' || Object.values(p.places).some(pl => pl.state === 'pending');
        text = pending ? s.stateSearching : s.manageDone;
        searching = true;
    }
    if (p.state.truncated) notes.push(s.statusTruncated);
    const pace = searching && env.pace
        ? env.pace === 'rare' ? s.paceRare : env.pace === 'idle' ? s.paceIdle : s.paceSometimes
        : '';
    return { text, link, pace, notes, summary };
}

/** The row "History of places ›" under Settings → Person card, and the research menu's summary. */
export function manageSummaries(p: HistoryPayload, lang: Language, queue: readonly HistoryHideOp[] = []): { settings: string; menu: string } {
    const s = getStringsForLang(lang).history;
    const c = manageCounts(p, queue);
    return { settings: s.manageSettingsSub(c.regions, c.events, c.hidden), menu: s.manageSummary(c.regions, c.events) };
}

// ─── Detail: a region's, the local findings' or a place's events (§2) ──────

/** What a detail shows: a region id, `local`, or `place:<key>`. */
export function detailOwner(key: string): { kind: 'region' | 'local' | 'place'; id: string } {
    if (key === 'local') return { kind: 'local', id: '' };
    if (key.startsWith('place:')) return { kind: 'place', id: key.slice(6) };
    return { kind: 'region', id: key };
}

export type DetailHide = 'none' | 'partial' | 'tree' | 'region';

export interface DetailEvent {
    ev: HistoryEvent;
    /** "1866" or "1914–1918". */
    year: string;
    text: string;
    textLang: string;
    tip?: string;
    tipLang?: string;
    /** Local detail: the tree's spelling of the event's place(s). */
    place?: string;
    /** Local detail: the payload's place keys of the event. */
    placeKeys: string[];
    hide: DetailHide;
    /** "Hidden at Čáslav" … ('' without a hiding). */
    hideNote: string;
    /** The hidings "Undo" takes back (for `region`, the region's hiding). */
    hidings: EffectiveHidden[];
    search: string;
}

/** The payload's place keys of each event. */
export function eventPlaceKeys(p: HistoryPayload): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [key, place] of Object.entries(p.places)) {
        for (const id of place.events) {
            const list = out.get(id);
            if (list) { if (!list.includes(key)) list.push(key); } else out.set(id, [key]);
        }
    }
    return out;
}

/** The events of a detail in time order, each with its hiding state (§2.2, §2.3). */
export function detailEvents(p: HistoryPayload, env: ManageEnv, names: ManageNames, key: string): DetailEvent[] {
    const s = getStringsForLang(env.lang).history;
    const owner = detailOwner(key);
    const hidden = effectiveHidden(p, env.queue ?? []);
    const regionHides = new Map(hidden.filter(h => !h.event && h.region).map(h => [h.region!, h]));
    const placesOf = eventPlaceKeys(p);
    const mine = p.events.filter(ev => owner.kind === 'region' ? ev.scope === 'region' && ev.region?.id === owner.id
        : owner.kind === 'local' ? ev.scope === 'local'
            : ev.scope === 'place' && ev.place?.key === owner.id);
    const out: DetailEvent[] = [];
    for (const ev of mine) {
        const t = pickHistoryText(ev.text, env.lang, p.lang);
        if (!t) continue;
        const tip = pickHistoryText(ev.tip?.text, env.lang, p.lang);
        const own = hidden.filter(h => h.event === ev.id);
        const pending = (list: EffectiveHidden[]) => list.some(h => h.queued) ? ` · ${s.pendingSync}` : '';
        let hide: DetailHide = 'none';
        let hideNote = '';
        let hidings: EffectiveHidden[] = [];
        const tree = own.filter(h => h.tree);
        const regionHide = ev.scope === 'region' && ev.region ? regionHides.get(ev.region.id) : undefined;
        if (tree.length) {
            hide = 'tree'; hidings = tree; hideNote = s.hiddenTree + pending(tree);
        } else if (regionHide) {
            hide = 'region'; hidings = [regionHide]; hideNote = s.hiddenRegionAll + pending(hidings);
        } else if (own.length) {
            hide = 'partial'; hidings = own;
            const places = [...new Set(own.filter(h => h.place).map(h => h.place!))];
            if (places.length === 1) hideNote = s.hiddenAt(names.place(places[0]));
            else if (places.length > 1) hideNote = s.hiddenAtN(places.length);
            else {
                const h = own[0];
                hideNote = s.hiddenPerson(names.person(h.person, h.personId) || h.person || h.personId || '');
            }
            hideNote += pending(own);
        }
        const placeKeys = owner.kind === 'local' ? (placesOf.get(ev.id) ?? []) : [];
        const place = placeKeys.length ? joinAnd(env.lang, placeKeys.map(k => names.place(k))) : undefined;
        const row: DetailEvent = {
            ev, year: yearLabel(ev.from, ev.to), text: t.text, textLang: t.lang, placeKeys, hide, hideNote, hidings,
            search: searchText(...allTexts(ev.text), ev.source?.title, ev.source?.quote, ev.local?.cite, place, ...allTexts(ev.tip?.text)),
        };
        if (tip) { row.tip = tip.text; row.tipLang = tip.lang; }
        if (place) row.place = place;
        out.push(row);
    }
    return out.sort((a, b) => a.ev.from - b.ev.from || (a.ev.to ?? a.ev.from) - (b.ev.to ?? b.ev.from));
}

/** The detail's filter (kept while the dialog is open). Kinds and places: none = all. */
export interface DetailFilter {
    kinds: string[];
    places: string[];
    /** A period (a century or a custom range), inclusive. */
    from?: number;
    to?: number;
    query: string;
    hiddenOnly: boolean;
}

export function emptyDetailFilter(): DetailFilter {
    return { kinds: [], places: [], query: '', hiddenOnly: false };
}

/** The filter narrows anything (Clear filter, active chips). */
export function detailFilterActive(f: DetailFilter): boolean {
    return f.kinds.length > 0 || f.places.length > 0 || f.from !== undefined || f.to !== undefined || f.query.trim() !== '' || f.hiddenOnly;
}

function inPeriod(ev: HistoryEvent, from: number | undefined, to: number | undefined): boolean {
    const a = ev.from;
    const b = ev.to !== undefined && ev.to > ev.from ? ev.to : ev.from;
    return (from === undefined || b >= from) && (to === undefined || a <= to);
}

/** The events the filter keeps; `skip` leaves one part out (the counts on its own chips). */
export function filterDetailEvents(rows: readonly DetailEvent[], f: DetailFilter, skip?: 'kinds' | 'places'): DetailEvent[] {
    const q = f.query.trim();
    return rows.filter(r =>
        (skip === 'kinds' || !f.kinds.length || f.kinds.includes(r.ev.kind))
        && (skip === 'places' || !f.places.length || r.placeKeys.some(k => f.places.includes(k)))
        && inPeriod(r.ev, f.from, f.to)
        && (!q || matchesQuery(r.search, q))
        && (!f.hiddenOnly || r.hide !== 'none'));
}

/** Chips with counts: kinds in the catalogue's order, or the local detail's places by count. */
export function detailFacets(rows: readonly DetailEvent[], f: DetailFilter, by: 'kinds' | 'places', names: ManageNames): { key: string; label: string; count: number }[] {
    const pool = filterDetailEvents(rows, f, by);
    const counts = new Map<string, number>();
    for (const r of pool) {
        const keys = by === 'kinds' ? [r.ev.kind] : r.placeKeys;
        for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // A chosen chip stays even when the rest of the filter leaves none of it.
    for (const k of by === 'kinds' ? f.kinds : f.places) if (!counts.has(k)) counts.set(k, 0);
    const keys = [...counts.keys()];
    if (by === 'kinds') {
        const order = HISTORY_KINDS as readonly string[];
        keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    } else {
        const collator = new Intl.Collator();
        keys.sort((a, b) => (counts.get(b)! - counts.get(a)!) || collator.compare(names.place(a), names.place(b)));
    }
    return keys.map(k => ({ key: k, label: by === 'kinds' ? k : names.place(k), count: counts.get(k)! }));
}

/** "1800–1899" for the century of a year. */
export function centuryLabel(c: number): string {
    return `${c * 100}–${c * 100 + 99}`;
}

export function centuryOf(year: number): number {
    return Math.floor(year / 100);
}

/** The centuries the events fall in (oldest first): the period choices. */
export function detailCenturies(rows: readonly DetailEvent[]): number[] {
    return [...new Set(rows.map(r => centuryOf(r.ev.from)))].sort((a, b) => a - b);
}

export interface CenturyGroup {
    century: number;
    label: string;
    rows: DetailEvent[];
    /** Unfolded unless the viewer folded it (or, above 40 events, all but the largest). */
    open: boolean;
}

/** Folding above this many events (§2.3). */
export const CENTURY_FOLD_ABOVE = 40;

/**
 * The list by centuries (§2.3). Above 40 events only the most numerous
 * century is unfolded; `toggled` holds the centuries the viewer flipped.
 */
export function centuryGroups(rows: readonly DetailEvent[], toggled: ReadonlySet<number> = new Set()): CenturyGroup[] {
    const by = new Map<number, DetailEvent[]>();
    for (const r of rows) {
        const c = centuryOf(r.ev.from);
        const list = by.get(c);
        if (list) list.push(r); else by.set(c, [r]);
    }
    const centuries = [...by.keys()].sort((a, b) => a - b);
    let largest = centuries[0];
    for (const c of centuries) if (by.get(c)!.length > by.get(largest)!.length) largest = c;
    const fold = rows.length > CENTURY_FOLD_ABOVE;
    return centuries.map(c => {
        const byDefault = !fold || c === largest;
        return { century: c, label: centuryLabel(c), rows: by.get(c)!, open: toggled.has(c) ? !byDefault : byDefault };
    });
}

// ─── Who sees an event (§2.2, the card layer's computation) ─────────────────

export interface AudienceEntry {
    personId: string;
    /** The tree's spelling of the place the event reaches the person through. */
    place: string;
    /** The payload's key of that place. */
    placeKey: string;
}

export interface EventAudience {
    /** Persons whose card shows the event now. */
    sees: AudienceEntry[];
    /** Persons whose card would show it but a hiding keeps it off. */
    hidden: AudienceEntry[];
}

/**
 * Who sees each event on a card: every person of the tree through
 * `computePersonHistory`, so the numbers are the card layer's.
 */
export function historyAudience(data: StromData, p: HistoryPayload, lang: Language, env: PersonHistoryEnv = {}): Map<string, EventAudience> {
    const out = new Map<string, EventAudience>();
    const get = (id: string) => {
        let a = out.get(id);
        if (!a) { a = { sees: [], hidden: [] }; out.set(id, a); }
        return a;
    };
    if (!p.events.length) return out;
    for (const personId of Object.keys(data.persons)) {
        const h = computePersonHistory(data, personId, p, lang, env);
        for (const i of h.items) get(i.ev.id).sees.push({ personId, place: i.place, placeKey: i.placeKey });
        for (const i of h.hidden) get(i.ev.id).hidden.push({ personId, place: i.place, placeKey: i.placeKey });
    }
    return out;
}

/** The places where someone sees the event, most persons first (Hide at a place ›). */
export function audiencePlaces(a: EventAudience | undefined, names: ManageNames): { key: string; name: string; persons: number }[] {
    const by = new Map<string, number>();
    for (const e of a?.sees ?? []) by.set(e.placeKey, (by.get(e.placeKey) ?? 0) + 1);
    const collator = new Intl.Collator();
    return [...by.entries()]
        .map(([key, persons]) => ({ key, name: names.place(key), persons }))
        .sort((x, y) => y.persons - x.persons || collator.compare(x.name, y.name));
}
