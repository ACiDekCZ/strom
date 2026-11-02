/**
 * The Places dialog's rules (spec 034 §1–§5), without the DOM: which actions
 * a row offers in each state, which places a bulk step takes, the context
 * line over the list, the years a place was used in, the texts of the app's
 * own check and the rows of "Why here". The dialog (ui/places-manager-ui.ts)
 * only draws what these say.
 */

import type { PlaceGeo, PlaceRecordName, StromData } from './types.js';
import type { CheckFinding } from './place-check.js';
import type { PlaceIdentity, PlaceOrigin, PlaceStateFilter, PlaceStateSummary } from './place-identity.js';
import type { PlacesResearchAccess } from './places-bridge.js';
import { forEachPlaceFact, placeKey } from './places.js';
import { yearOf } from './dates.js';
import { getStringsForLang, type Language } from './strings.js';

// ==================== ROW ACTIONS ====================

/**
 * What a row's state frame offers:
 * find / findQuiet: Find on the map (a button / a muted link); look / lookAgain: ◆ Look up;
 * unqueue: Remove from the queue; answer: Answer in Waiting; why / whyQuiet: Why here ▾;
 * keep: Keep (a check mark); change: Change (the search); check: ◆ Check; remove: Remove.
 */
export type PlaceRowAction =
    | 'find' | 'findQuiet' | 'look' | 'lookAgain' | 'unqueue' | 'answer'
    | 'why' | 'whyQuiet' | 'keep' | 'change' | 'check' | 'remove';

export interface RowActionContext {
    /** The ◆ actions go (placesResearchContext().canResearch). */
    canResearch: boolean;
    /** The tree has a location of its own for the place (data.places). */
    hasGeo: boolean;
    /** That location is "by the town" (no Remove: the town's point is shared). */
    byTown?: boolean;
}

/** The actions of a row, in the order they show. */
export function placeRowActions(id: PlaceIdentity, ctx: RowActionContext): PlaceRowAction[] {
    const res = ctx.canResearch;
    switch (id.state) {
        case 'none': return res ? ['find', 'look'] : ['find'];
        case 'queued': return res ? ['unqueue'] : [];
        case 'running': return [];
        case 'confirm': return ['answer', 'findQuiet'];
        case 'undet': return res ? ['why', 'lookAgain', 'findQuiet'] : ['why', 'findQuiet'];
        case 'check': return res ? ['keep', 'change', 'check', 'whyQuiet'] : ['keep', 'change', 'whyQuiet'];
        case 'town': return res ? ['change', 'look'] : ['change'];
        case 'placed':
        case 'verified': {
            const out: PlaceRowAction[] = ['why', 'change'];
            if (res && id.origin !== 'hand') out.push('check');
            if (ctx.hasGeo && !ctx.byTown) out.push('remove');
            return out;
        }
    }
}

/** Can "Look up" take this place (a single row, a selection, the bulk step)? */
export function canLookUp(id: PlaceIdentity): boolean {
    return id.state === 'none' || id.state === 'undet' || id.state === 'town' || id.state === 'check';
}

/** Can "Check" take this place? Located, and not placed by hand. */
export function canCheck(id: PlaceIdentity): boolean {
    return (id.state === 'placed' || id.state === 'verified' || id.state === 'check') && id.origin !== 'hand';
}

/** Does "Why here" have anything to say for this state? */
export function hasWhyHere(id: PlaceIdentity): boolean {
    return id.state === 'undet' || id.state === 'check' || id.state === 'placed' || id.state === 'verified';
}

// ==================== SELECTION ====================

/** A group head's checkbox: all its places, none, or some of them ("mixed"). */
export function groupCheckState(selected: readonly boolean[]): 'true' | 'false' | 'mixed' {
    if (selected.length === 0) return 'false';
    const n = selected.filter(Boolean).length;
    return n === 0 ? 'false' : n === selected.length ? 'true' : 'mixed';
}

/** The counts of the selection bar: what Look up selected / Check selected would take. */
export function selectionCounts(ids: Iterable<PlaceIdentity>): { look: number; check: number; total: number } {
    let look = 0;
    let check = 0;
    let total = 0;
    for (const id of ids) {
        total++;
        if (canLookUp(id)) look++;
        if (canCheck(id)) check++;
    }
    return { look, check, total };
}

// ==================== CONTEXT LINE ====================

export type PlaceContextKind = 'elsewhere' | 'phone' | 'confirm' | 'none' | 'check' | 'queue' | 'old';

export interface PlaceContextInput {
    access: PlacesResearchAccess;
    filter: PlaceStateFilter;
    summary: PlaceStateSummary;
    /** Places queued in the research (not yet running). */
    queued: number;
}

/**
 * The one sentence over the list, by priority: another computer → phone →
 * the "To confirm" filter → "No location" (with the research here) → "Check"
 * → the queue. An old research says so only where a ◆ step would be offered.
 */
export function placeContextLine(o: PlaceContextInput): PlaceContextKind | null {
    const can = o.access === 'ok';
    if (o.access === 'elsewhere') return 'elsewhere';
    if (o.access === 'phone') return 'phone';
    if (o.filter === 'confirm') return 'confirm';
    if (o.filter === 'none' && can) return 'none';
    if (o.filter === 'none' && o.access === 'old') return 'old';
    if (o.filter === 'check') return 'check';
    if (can && o.queued > 0) return 'queue';
    return null;
}

// ==================== YEARS ====================

/** The years each place is used in (placeKey → [first, last]), from the facts' own dates. */
export function placeYearSpans(data: StromData): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    forEachPlaceFact(data, fact => {
        const key = fact.place?.trim() ? placeKey(fact.place) : '';
        const y = yearOf(fact.date);
        if (!key || y === null) return;
        const span = out.get(key);
        if (!span) out.set(key, [y, y]);
        else { if (y < span[0]) span[0] = y; if (y > span[1]) span[1] = y; }
    });
    return out;
}

/** "1820–1871", or "1866" for one year. */
export function formatYearSpan(span: readonly [number, number] | undefined): string {
    if (!span) return '';
    return span[0] === span[1] ? String(span[0]) : `${span[0]}–${span[1]}`;
}

// ==================== TEXTS ====================

/** The sentence of a finding of the app's own check (§5). */
export function checkFindingText(f: CheckFinding, lang: Language): string {
    const d = getStringsForLang(lang).places.dialog;
    switch (f.kind) {
        case 'far': return d.checkFar(f.km, f.family, f.years[0], f.years[1]);
        case 'district': return d.checkDistrict(f.expected, f.actual, f.jurisdiction === 'parish');
        case 'label': return f.type === 'street' ? d.checkStreet : f.type === 'area' ? d.checkArea : d.checkOtherTown;
        case 'multi': return d.checkMulti;
    }
}

/** A country as the UI language names it: a two-letter code through Intl, anything else as written. */
export function countryName(country: string | undefined, lang: Language): string {
    const c = country?.trim() ?? '';
    if (!/^[A-Za-z]{2}$/.test(c)) return c;
    try {
        return new Intl.DisplayNames([lang], { type: 'region' }).of(c.toUpperCase()) ?? c;
    } catch {
        return c;
    }
}

/** A former name with its years: "Lhotau (until 1945)". */
export function formerNameText(n: PlaceRecordName, lang: Language): string {
    const d = getStringsForLang(lang).places.dialog;
    if (n.from !== undefined && n.to !== undefined) return d.span(n.name, n.from, n.to);
    if (n.to !== undefined) return d.until(n.name, n.to);
    if (n.from !== undefined) return d.since(n.name, n.from);
    return n.name;
}

/**
 * The location's label in the state frame: today's name, district and
 * country from the research's record, else the map's label, else the
 * coordinates; '' without a location.
 */
export function placeLocationLabel(id: PlaceIdentity, geo: PlaceGeo | undefined, lang: Language): string {
    if (id.today) {
        const d = getStringsForLang(lang).places.dialog;
        return [id.today.name, id.today.district ? d.district(id.today.district) : '', countryName(id.today.country, lang)]
            .filter(Boolean).join(', ');
    }
    if (!geo) return '';
    return geo.label ?? `${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)}`;
}

/**
 * "formerly Lhotau (until 1945)" when today's name is not what the tree
 * writes (the place lies in another country now, or was renamed): the
 * record's former names the tree writes, else all of them. '' otherwise.
 */
export function placeFormerLine(id: PlaceIdentity, display: string, lang: Language): string {
    if (!id.today || !id.former?.length || placeKey(id.today.name) === placeKey(display)) return '';
    const written = id.former.filter(n => placeKey(n.name) === placeKey(display));
    const names = (written.length ? written : id.former).map(n => formerNameText(n, lang));
    return getStringsForLang(lang).places.dialog.formerly(names.join(' · '));
}

/** A row of "Why here". `origin`: the Who row carries the origin badge. */
export interface PlaceWhyRow {
    kind: 'today' | 'before' | 'who' | 'why' | 'decide' | 'check' | 'source';
    /** The row's label ('' = a continuation of the row above). */
    label: string;
    text: string;
    tone?: 'warn' | 'muted';
    origin?: PlaceOrigin;
    at?: string;
    /** A source's address (http/https only). */
    url?: string;
}

const safeUrl = (u: string | undefined): string | undefined => u && /^https?:\/\//i.test(u) ? u : undefined;

/** The rows of "Why here" — only the rows that have something to say. */
export function placeWhyRows(id: PlaceIdentity, geo: PlaceGeo | undefined, lang: Language): PlaceWhyRow[] {
    const d = getStringsForLang(lang).places.dialog;
    const out: PlaceWhyRow[] = [];
    const today = placeLocationLabel(id, id.located ? geo : undefined, lang);
    if (today && id.state !== 'undet') out.push({ kind: 'today', label: d.dToday, text: today });
    if (id.former?.length) out.push({ kind: 'before', label: d.dBefore, text: id.former.map(n => formerNameText(n, lang)).join(' · ') });
    if (id.origin) {
        out.push({ kind: 'who', label: d.dWho, text: '', origin: id.origin, ...(id.at ? { at: id.at } : {}) });
        if (id.origin === 'hand') out.push({ kind: 'who', label: '', text: d.whoHand, tone: 'muted' });
    }
    const why = id.why ?? id.checkWhy;
    if (why) out.push({ kind: 'why', label: d.dWhy, text: why });
    if (id.decide) out.push({ kind: 'decide', label: d.dDecide, text: id.decide });
    (id.checks ?? []).forEach((f, i) => out.push({
        kind: 'check', label: i === 0 ? d.dCheck : '', text: checkFindingText(f, lang), tone: f.kind === 'multi' ? 'muted' : 'warn',
    }));
    if (id.source?.title) {
        const url = safeUrl(id.source.url);
        out.push({ kind: 'source', label: d.dSource, text: id.source.title, ...(url ? { url } : {}) });
    }
    return out;
}
