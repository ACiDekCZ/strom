/**
 * Linked in the view only ("view links"): a family outside the tree that a
 * variant of an open hypothesis of the research would link, shown in its
 * place as if the link were real — never a change of the tree's data.
 *
 * What the user chose to show is a device setting of the tree (beside the
 * research edge setting): `strom-view-links:{treeId}` holds the records,
 * `strom-view-links-master:{treeId}` the main switch (missing = on). It goes
 * with a backup ("Export all") and with a tree moved to another browser,
 * never with a copy of the tree (HTML, JSON, GEDCOM, CSV, sharing). Records
 * never delete themselves: one that no longer holds resolves `invalid` and
 * draws again when the data come back (a restored state before a load).
 *
 * The research's people are its person numbers (REFN); a record keeps the
 * app's person ids, which stay the same across the research's versions
 * (stabilizeIds). Everything here except the storage functions is pure.
 */

import type { Person, PersonId, ResearchHypothesis, ResearchVariantLink, StromData } from './types.js';

// ==================== MODEL ====================

/** What a view link draws: whose child (`child`: anchor is the child) or whose partner. */
export type ViewLinkKind = 'child' | 'partners';

export interface ViewLink {
    /** The hypothesis ("H0022"). */
    hypo: string;
    /** Its variant ("B"). */
    variant: string;
    kind: ViewLinkKind;
    /** The person it attaches to (`child`: the child; `partners`: the partner on the tree's side). */
    anchorId: PersonId;
    /** The people it attaches: the parents (one or two) or the partner (one). */
    islandIds: PersonId[];
    /** Drawn (with the main switch on); off keeps the row. */
    on: boolean;
    /** When it was chosen (ms): order of the rows and of chained links. */
    addedAt: number;
}

/** A view link to choose: everything but its switch and time. */
export type ViewLinkChoice = Pick<ViewLink, 'hypo' | 'variant' | 'kind' | 'anchorId' | 'islandIds'>;

/** Why a view link no longer holds. */
export type ViewLinkInvalidReason = 'decidedOther' | 'cancelled' | 'gone' | 'noLink' | 'personGone' | 'joined' | 'hasParents';

/**
 * What a view link is against the data now: drawn (as a ghost), real (the
 * tree has the link: decided for it, or linked by hand), or no longer valid.
 */
export type ViewLinkState =
    | { state: 'draw' }
    | { state: 'real' }
    | { state: 'invalid'; reason: ViewLinkInvalidReason };

export type ResolvedViewLink = { link: ViewLink } & ViewLinkState;

// ==================== STORAGE ====================

const LINKS_PREFIX = 'strom-view-links:';
const MASTER_PREFIX = 'strom-view-links-master:';

/** The prefixes of a tree's view link keys (the tree's id follows). */
export const VIEW_LINK_KEY_PREFIXES: readonly string[] = [LINKS_PREFIX, MASTER_PREFIX];

export function viewLinksKey(treeId: string): string {
    return `${LINKS_PREFIX}${treeId}`;
}

export function viewLinksMasterKey(treeId: string): string {
    return `${MASTER_PREFIX}${treeId}`;
}

/** At most this many records are kept (a hypothesis has one). */
const MAX_LINKS = 1000;
const HYPO_ID = /^H\d{1,7}$/;
const VARIANT_ID = /^[A-Z]{1,3}$/;

const isPersonId = (v: unknown): v is PersonId => typeof v === 'string' && v.length > 0 && v.length <= 100;

/**
 * Records as stored (untrusted: storage, a backup, a moved tree) → the valid
 * ones, one per hypothesis (the latest chosen stays), in their order.
 */
export function sanitizeViewLinks(value: unknown): ViewLink[] {
    if (!Array.isArray(value)) return [];
    const out: ViewLink[] = [];
    for (const raw of value.slice(0, MAX_LINKS)) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.hypo !== 'string' || !HYPO_ID.test(r.hypo)) continue;
        if (typeof r.variant !== 'string' || !VARIANT_ID.test(r.variant)) continue;
        if (r.kind !== 'child' && r.kind !== 'partners') continue;
        if (!isPersonId(r.anchorId)) continue;
        if (!Array.isArray(r.islandIds) || !r.islandIds.every(isPersonId)) continue;
        const islandIds = [...new Set(r.islandIds as PersonId[])];
        if (islandIds.length < 1 || islandIds.length > (r.kind === 'child' ? 2 : 1) || islandIds.includes(r.anchorId)) continue;
        const addedAt = typeof r.addedAt === 'number' && Number.isFinite(r.addedAt) && r.addedAt >= 0 ? r.addedAt : 0;
        const link: ViewLink = { hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: r.anchorId, islandIds, on: r.on === true, addedAt };
        const twin = out.findIndex(l => l.hypo === link.hypo);
        if (twin < 0) out.push(link);
        else if (link.addedAt >= out[twin].addedAt) out[twin] = link;
    }
    return out;
}

function storage(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** The tree's records on this device. */
export function loadViewLinks(treeId: string): ViewLink[] {
    try {
        const raw = storage()?.getItem(viewLinksKey(treeId));
        return raw ? sanitizeViewLinks(JSON.parse(raw)) : [];
    } catch { return []; }
}

/** Keep the tree's records (none: the key goes). */
export function saveViewLinks(treeId: string, links: readonly ViewLink[]): void {
    const s = storage();
    if (!s) return;
    try {
        const clean = sanitizeViewLinks(links);
        if (clean.length === 0) s.removeItem(viewLinksKey(treeId));
        else s.setItem(viewLinksKey(treeId), JSON.stringify(clean));
    } catch { /* storage full or blocked: the view keeps working for this session */ }
}

/** The main switch "Show in the tree" (default on). */
export function isViewLinksMaster(treeId: string): boolean {
    try { return storage()?.getItem(viewLinksMasterKey(treeId)) !== 'false'; } catch { return true; }
}

export function setViewLinksMaster(treeId: string, on: boolean): void {
    const s = storage();
    if (!s) return;
    try {
        if (on) s.removeItem(viewLinksMasterKey(treeId));
        else s.setItem(viewLinksMasterKey(treeId), 'false');
    } catch { /* blocked */ }
}

/**
 * The tree whose view links a storage key holds (another window wrote it: a
 * `storage` event), or null for any other key. A cleared storage (key null)
 * concerns every tree: ''.
 */
export function viewLinksTreeOfKey(key: string | null): string | null {
    if (key === null) return '';
    for (const prefix of VIEW_LINK_KEY_PREFIXES) if (key.startsWith(prefix)) return key.slice(prefix.length);
    return null;
}

/** A deleted tree: its view links go with it. */
export function forgetViewLinks(treeId: string): void {
    const s = storage();
    if (!s) return;
    try {
        s.removeItem(viewLinksKey(treeId));
        s.removeItem(viewLinksMasterKey(treeId));
    } catch { /* blocked */ }
}

/** A tree's view links as a backup or a moved tree carries them. */
export interface ViewLinksPayload {
    links: ViewLink[];
    /** The main switch, only when off. */
    master?: false;
}

/** What a backup or a moved tree carries for the tree (null: nothing to carry). */
export function viewLinksPayload(treeId: string): ViewLinksPayload | null {
    const links = loadViewLinks(treeId);
    const master = isViewLinksMaster(treeId);
    if (links.length === 0 && master) return null;
    return { links, ...(master ? {} : { master: false as const }) };
}

/** The view links a backup or a moved tree brought, for the tree made from it (untrusted; invalid ones go). */
export function restoreViewLinks(treeId: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    const links = sanitizeViewLinks(r.links);
    if (links.length > 0) saveViewLinks(treeId, links);
    if (r.master === false) setViewLinksMaster(treeId, false);
}

// ==================== THE RESEARCH IN THE DATA ====================

/** Hypotheses whose `status` closes them: decided for one variant, or given up. */
const DECIDED = 'decided';
const ABANDONED = 'abandoned';

/** The hypotheses of the tree by id (each person it concerns carries a copy; the first stands). */
export function researchHypotheses(data: StromData): Map<string, ResearchHypothesis> {
    const out = new Map<string, ResearchHypothesis>();
    for (const p of Object.values(data.persons ?? {})) {
        for (const h of p?.research?.hypotheses ?? []) if (h.id && !out.has(h.id)) out.set(h.id, h);
    }
    return out;
}

/** An open hypothesis: neither decided nor abandoned (a newer word counts as open). */
export function isOpenHypothesis(h: ResearchHypothesis): boolean {
    return h.status !== DECIDED && h.status !== ABANDONED;
}

/** Everything resolving needs from the data, computed once per drawing. */
export interface ViewLinkContext {
    hypotheses: Map<string, ResearchHypothesis>;
    /** The research's person numbers → the app's ids (numbers held by two people left out). */
    byRefn: Map<string, PersonId>;
    /** Every person → its family group: people joined by real parent, child and couple links. */
    group: Map<PersonId, number>;
}

export function viewLinkContext(data: StromData): ViewLinkContext {
    const byRefn = new Map<string, PersonId>();
    const twice = new Set<string>();
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        const refn = p?.refn?.trim();
        if (!refn) continue;
        if (byRefn.has(refn)) twice.add(refn);
        else byRefn.set(refn, id as PersonId);
    }
    for (const refn of twice) byRefn.delete(refn);
    return { hypotheses: researchHypotheses(data), byRefn, group: familyGroups(data) };
}

/** Connected groups of people over the real links (union–find). */
function familyGroups(data: StromData): Map<PersonId, number> {
    const ids = Object.keys(data.persons ?? {}) as PersonId[];
    const index = new Map(ids.map((id, i) => [id, i]));
    const parent = ids.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const join = (a: string | undefined, b: string | undefined): void => {
        const i = a !== undefined ? index.get(a as PersonId) : undefined;
        const j = b !== undefined ? index.get(b as PersonId) : undefined;
        if (i === undefined || j === undefined) return;
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[ri] = rj;
    };
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        for (const parentId of p?.parentIds ?? []) join(id, parentId);
        for (const childId of p?.childIds ?? []) join(id, childId);
    }
    for (const u of Object.values(data.partnerships ?? {})) {
        if (!u) continue;
        join(u.person1Id, u.person2Id);
        for (const childId of u.childIds ?? []) join(u.person1Id, childId);
    }
    return new Map(ids.map((id, i) => [id, find(i)]));
}

/** The family outside the tree a view link shows: everyone in the groups of its island people. */
export function viewLinkIsland(data: StromData, link: Pick<ViewLink, 'islandIds'>, ctx: ViewLinkContext = viewLinkContext(data)): PersonId[] {
    const groups = new Set(link.islandIds.map(id => ctx.group.get(id)).filter((g): g is number => g !== undefined));
    return (Object.keys(data.persons ?? {}) as PersonId[]).filter(id => groups.has(ctx.group.get(id)!));
}

/** The person lies off the tree as the research sees it (a family nothing links to it yet). */
const offTree = (p: Person | undefined): boolean => !!p?.research?.island;

/**
 * What a variant's link would show, in the app's ids (null: a kind that is
 * only text — same, siblings — or someone not in the tree's data).
 * `partners`: the island side is the partner whose island names the
 * hypothesis; else the one off the tree; else the second.
 */
export function viewLinkShape(data: StromData, hypo: string, link: ResearchVariantLink, ctx: ViewLinkContext): Omit<ViewLinkChoice, 'hypo' | 'variant'> | null {
    const id = (refn: string): PersonId | null => {
        const pid = ctx.byRefn.get(refn);
        return pid && data.persons[pid] ? pid : null;
    };
    if (link.kind === 'child') {
        const anchorId = id(link.child);
        const islandIds = link.parents.map(id);
        if (!anchorId || islandIds.length === 0 || !islandIds.every((x): x is PersonId => !!x)) return null;
        return { kind: 'child', anchorId, islandIds };
    }
    if (link.kind !== 'partners' || link.persons.length !== 2) return null;
    const [a, b] = link.persons.map(id);
    if (!a || !b || a === b) return null;
    const names = (pid: PersonId): boolean => !!data.persons[pid]?.research?.island?.hypos.some(h => h.id === hypo);
    const aIsland = names(a), bIsland = names(b);
    let partner: PersonId;
    if (aIsland !== bIsland) partner = aIsland ? a : b;
    else if (offTree(data.persons[a]) !== offTree(data.persons[b])) partner = offTree(data.persons[a]) ? a : b;
    else partner = b;
    return { kind: 'partners', anchorId: partner === a ? b : a, islandIds: [partner] };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every(x => b.includes(x));

// ==================== RESOLVING ====================

/** The parent's role: father, mother, or either (sex unknown). */
function role(p: Person | undefined): 'father' | 'mother' | 'either' {
    return p?.gender === 'male' ? 'father' : p?.gender === 'female' ? 'mother' : 'either';
}

/**
 * What one view link is against the data now. Checked in this order: someone
 * gone; the link real (decided for it, or made by hand — whatever the
 * hypothesis says); the hypothesis gone, abandoned or decided for another
 * variant; the variant no longer linking these people; the family already in
 * the tree another way; the child already with a real parent in a role a
 * shown parent takes ("?" stand-ins do not count). Else drawn.
 */
export function resolveViewLink(data: StromData, link: ViewLink, ctx: ViewLinkContext = viewLinkContext(data)): ViewLinkState {
    const persons = data.persons ?? {};
    const anchor = persons[link.anchorId];
    if (!anchor || link.islandIds.some(id => !persons[id])) return { state: 'invalid', reason: 'personGone' };

    if (link.kind === 'child') {
        if (link.islandIds.every(id => anchor.parentIds?.includes(id))) return { state: 'real' };
    } else if (Object.values(data.partnerships ?? {}).some(u => u
        && ((u.person1Id === link.anchorId && u.person2Id === link.islandIds[0])
            || (u.person2Id === link.anchorId && u.person1Id === link.islandIds[0])))) {
        return { state: 'real' };
    }

    const h = ctx.hypotheses.get(link.hypo);
    if (!h) return { state: 'invalid', reason: 'gone' };
    if (h.status === ABANDONED) return { state: 'invalid', reason: 'cancelled' };
    if (h.status === DECIDED && h.chosen !== link.variant) return { state: 'invalid', reason: 'decidedOther' };

    const variant = h.variants?.find(v => v.id === link.variant);
    const matches = (variant?.links ?? []).some(l => {
        const shape = viewLinkShape(data, link.hypo, l, ctx);
        return !!shape && shape.kind === link.kind && shape.anchorId === link.anchorId && sameSet(shape.islandIds, link.islandIds);
    });
    if (!matches) return { state: 'invalid', reason: 'noLink' };

    const anchorGroup = ctx.group.get(link.anchorId);
    if (link.islandIds.some(id => ctx.group.get(id) === anchorGroup)) return { state: 'invalid', reason: 'joined' };

    if (link.kind === 'child') {
        const real = (anchor.parentIds ?? []).map(id => persons[id]).filter(p => p && !p.isPlaceholder);
        const shown = link.islandIds.map(id => role(persons[id]));
        const clash = real.some(p => {
            const r = role(p);
            return shown.some(s => s === 'either' || r === 'either' || s === r);
        });
        if (clash) return { state: 'invalid', reason: 'hasParents' };
    }
    return { state: 'draw' };
}

/** Every record against the data now (at each drawing: the research's snapshot is replaced whole). */
export function resolveViewLinks(data: StromData, links: readonly ViewLink[], ctx: ViewLinkContext = viewLinkContext(data)): ResolvedViewLink[] {
    return links.map(link => ({ link, ...resolveViewLink(data, link, ctx) }));
}

/** The group of each island person of a record. */
const islandGroups = (link: Pick<ViewLink, 'islandIds'>, ctx: ViewLinkContext): Set<number> =>
    new Set(link.islandIds.map(id => ctx.group.get(id)).filter((g): g is number => g !== undefined));

/**
 * The view links the tree draws now: drawn, switched on, the main switch on,
 * and attached where the view reaches — an anchor in the tree, or inside the
 * family another drawn link shows (chained). In the order chosen.
 */
export function activeViewLinks(data: StromData, resolved: readonly ResolvedViewLink[], master: boolean, ctx: ViewLinkContext = viewLinkContext(data)): ViewLink[] {
    if (!master) return [];
    const candidates = resolved.filter(r => r.state === 'draw' && r.link.on).map(r => r.link)
        .sort((a, b) => a.addedAt - b.addedAt);
    const active: ViewLink[] = [];
    const shownGroups = new Set<number>();
    let grew = true;
    while (grew) {
        grew = false;
        for (const link of candidates) {
            if (active.includes(link)) continue;
            const g = ctx.group.get(link.anchorId);
            if (offTree(data.persons[link.anchorId]) && (g === undefined || !shownGroups.has(g))) continue;
            active.push(link);
            for (const x of islandGroups(link, ctx)) shownGroups.add(x);
            grew = true;
        }
    }
    return candidates.filter(l => active.includes(l));
}

// ==================== THE LIST ====================

/** The rows of the list "Linked in the view only": drawable rows switched on (n) of the drawable ones (m). */
export function viewLinkCounts(resolved: readonly ResolvedViewLink[]): { on: number; drawable: number; invalid: number } {
    let on = 0, drawable = 0, invalid = 0;
    for (const r of resolved) {
        if (r.state === 'draw') {
            drawable++;
            if (r.link.on) on++;
        } else if (r.state === 'invalid') invalid++;
    }
    return { on, drawable, invalid };
}

/**
 * The list's order: drawable rows by where their person stands in the view
 * (top down, then left to right; not drawn: after those, in the order
 * chosen), then the rows linked for real, then those no longer valid (each
 * in the order chosen).
 */
export function orderViewLinkRows(resolved: readonly ResolvedViewLink[], place: (id: PersonId) => { x: number; y: number } | undefined): ResolvedViewLink[] {
    const rank = (r: ResolvedViewLink): number => r.state === 'draw' ? 0 : r.state === 'real' ? 1 : 2;
    return [...resolved].sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 0) {
            const pa = place(a.link.anchorId), pb = place(b.link.anchorId);
            if (pa && pb && (pa.y !== pb.y || pa.x !== pb.x)) return pa.y !== pb.y ? pa.y - pb.y : pa.x - pb.x;
            if (pa && !pb) return -1;
            if (pb && !pa) return 1;
        }
        return a.link.addedAt - b.link.addedAt;
    });
}

/**
 * The records a load of the research made invalid: invalid against the data
 * after it and valid (drawn or real) before.
 */
export function newlyInvalidViewLinks(before: StromData, after: StromData, links: readonly ViewLink[]): Array<ResolvedViewLink & { state: 'invalid' }> {
    if (links.length === 0) return [];
    const was = resolveViewLinks(before, links);
    return resolveViewLinks(after, links).filter((r, i): r is ResolvedViewLink & { state: 'invalid' } => {
        return r.state === 'invalid' && was[i].state !== 'invalid';
    });
}

// ==================== CHOOSING ====================

/** A change of the records, with what a later notice says. */
export interface ViewLinksChange {
    links: ViewLink[];
    /** Records taken away because their family is now shown elsewhere (one family, one place). */
    removed: ViewLink[];
    /** Records switched off because what they hang on is no longer shown (chained). */
    disconnected: ViewLink[];
}

/**
 * The switched-on records chained to `hypo`'s: their anchor lies in the family
 * it shows, or in the family of one chained to it, and so on. Parents first.
 */
export function viewLinkDependents(data: StromData, links: readonly ViewLink[], hypo: string, ctx: ViewLinkContext = viewLinkContext(data)): ViewLink[] {
    const root = links.find(l => l.hypo === hypo);
    if (!root) return [];
    const out: ViewLink[] = [];
    const ordered = [...links].sort((a, b) => a.addedAt - b.addedAt);
    const queue = [root];
    while (queue.length > 0) {
        const parentGroups = islandGroups(queue.shift()!, ctx);
        for (const l of ordered) {
            if (l === root || !l.on || out.includes(l)) continue;
            const g = ctx.group.get(l.anchorId);
            if (g === undefined || !parentGroups.has(g)) continue;
            out.push(l);
            queue.push(l);
        }
    }
    return out;
}

/** Switch off the chained records of `detached` that `kept` (the family still shown) no longer carries. */
function disconnectDependents(data: StromData, before: readonly ViewLink[], after: ViewLink[], detached: readonly ViewLink[], kept: Set<number>, ctx: ViewLinkContext): ViewLink[] {
    const off: ViewLink[] = [];
    for (const d of detached) {
        for (const dep of viewLinkDependents(data, before, d.hypo, ctx)) {
            const at = after.findIndex(l => l.hypo === dep.hypo);
            if (at < 0 || !after[at].on) continue;
            const g = ctx.group.get(dep.anchorId);
            if (g !== undefined && kept.has(g)) {
                for (const x of islandGroups(dep, ctx)) kept.add(x);
                continue;
            }
            after[at] = { ...after[at], on: false };
            off.push(after[at]);
        }
    }
    return off;
}

/**
 * Show a variant: one hypothesis has one record (another variant of it is
 * rewritten in the same record), one family is shown in one place (a record
 * of another hypothesis showing any of its people goes, returned in
 * `removed`), and what hung on a family no longer shown is switched off
 * (`disconnected`). The input is not changed.
 */
export function showViewLink(data: StromData, links: readonly ViewLink[], choice: ViewLinkChoice, now: number = Date.now(), ctx: ViewLinkContext = viewLinkContext(data)): ViewLinksChange {
    const next: ViewLink = { ...choice, islandIds: [...choice.islandIds], on: true, addedAt: now };
    const groups = islandGroups(next, ctx);
    const removed = links.filter(l => l.hypo !== choice.hypo && [...islandGroups(l, ctx)].some(g => groups.has(g)));
    const previous = links.find(l => l.hypo === choice.hypo);
    const after: ViewLink[] = links.filter(l => !removed.includes(l)).map(l => l.hypo === choice.hypo ? next : l);
    if (!previous) after.push(next);
    const detached = [...removed, ...(previous ? [previous] : [])];
    const disconnected = disconnectDependents(data, links, after, detached, new Set(groups), ctx);
    return { links: after, removed, disconnected };
}

/** Unlink (switch off) a record and everything chained to it; the rows stay. */
export function unlinkViewLink(data: StromData, links: readonly ViewLink[], hypo: string, ctx: ViewLinkContext = viewLinkContext(data)): ViewLinksChange {
    const dependents = viewLinkDependents(data, links, hypo, ctx);
    const off = new Set([hypo, ...dependents.map(d => d.hypo)]);
    const after = links.map(l => off.has(l.hypo) && l.on ? { ...l, on: false } : l);
    return { links: after, removed: [], disconnected: after.filter(l => dependents.some(d => d.hypo === l.hypo)) };
}

/** A record's switch: on is a new choice (the rules of showViewLink), off unlinks it with its chain. */
export function setViewLinkOn(data: StromData, links: readonly ViewLink[], hypo: string, on: boolean, now: number = Date.now(), ctx: ViewLinkContext = viewLinkContext(data)): ViewLinksChange {
    const link = links.find(l => l.hypo === hypo);
    if (!link) return { links: [...links], removed: [], disconnected: [] };
    if (!on) return unlinkViewLink(data, links, hypo, ctx);
    const { hypo: h, variant, kind, anchorId, islandIds } = link;
    return showViewLink(data, links, { hypo: h, variant, kind, anchorId, islandIds }, now, ctx);
}

/** Remove records (× in the list, "Remove invalid", "Remove all"); what hung on them is switched off. */
export function removeViewLinks(data: StromData, links: readonly ViewLink[], hypos: readonly string[], ctx: ViewLinkContext = viewLinkContext(data)): ViewLinksChange {
    const gone = links.filter(l => hypos.includes(l.hypo));
    const after = links.filter(l => !hypos.includes(l.hypo));
    const disconnected = disconnectDependents(data, links, after, gone, new Set(), ctx);
    return { links: after, removed: gone, disconnected };
}

// ==================== WHAT CAN BE SHOWN ====================

/** A variant that could be shown, and what showing it would be now. */
export type ViewLinkCandidate = ViewLinkChoice & ViewLinkState;

/**
 * Every variant of an open hypothesis whose link can be drawn (`child`,
 * `partners`; `same` and `siblings` are text only): the first such link of
 * the variant, with its state as if shown now. For the edge bubble, the
 * card's menu, "What research knows" and the family's own button.
 */
export function viewLinkCandidates(data: StromData, ctx: ViewLinkContext = viewLinkContext(data)): ViewLinkCandidate[] {
    const out: ViewLinkCandidate[] = [];
    for (const h of ctx.hypotheses.values()) {
        if (!h.id || !isOpenHypothesis(h)) continue;
        for (const v of h.variants ?? []) {
            for (const l of v.links) {
                const shape = viewLinkShape(data, h.id, l, ctx);
                if (!shape) continue;
                const choice: ViewLinkChoice = { hypo: h.id, variant: v.id, ...shape };
                out.push({ ...choice, ...resolveViewLink(data, { ...choice, on: true, addedAt: 0 }, ctx) });
                break;
            }
        }
    }
    return out;
}

/** One variant of a hypothesis as the actions offer it (the edge's bubble, the menus, "What research knows"). */
export interface ViewLinkOffer {
    hypo: string;
    variant: string;
    /** The claim (TITL). */
    title?: string;
    /** What it would show (null: nothing to draw — no link, text only, people not in the tree's data). */
    choice: ViewLinkChoice | null;
    /** What showing it would be now (null without a choice); only `draw` can be shown. */
    state: ViewLinkState | null;
    /** The people of the family it shows (0 without a choice). */
    people: number;
    /** It names people, but only as text (same, siblings). */
    textOnly: boolean;
    /** Shown now: its record switched on and the main switch on. */
    shown: boolean;
}

/** Every variant of `hypo` as an action offers it, in the file's order (none: the hypothesis is not in the data). */
export function viewLinkOffers(data: StromData, links: readonly ViewLink[], master: boolean, hypo: string, ctx: ViewLinkContext = viewLinkContext(data)): ViewLinkOffer[] {
    const h = ctx.hypotheses.get(hypo);
    if (!h) return [];
    const record = links.find(l => l.hypo === hypo);
    return (h.variants ?? []).map(v => {
        let choice: ViewLinkChoice | null = null;
        for (const l of v.links) {
            const shape = viewLinkShape(data, hypo, l, ctx);
            if (shape) { choice = { hypo, variant: v.id, ...shape }; break; }
        }
        const state = choice ? resolveViewLink(data, { ...choice, on: true, addedAt: 0 }, ctx) : null;
        return {
            hypo, variant: v.id, ...(v.title ? { title: v.title } : {}),
            choice, state,
            people: choice ? viewLinkIsland(data, choice, ctx).length : 0,
            textOnly: !choice && v.links.length > 0 && v.links.every(l => l.kind === 'same' || l.kind === 'siblings'),
            shown: master && !!record?.on && record.variant === v.id,
        };
    });
}

/** The record of `hypo` that is shown now (switched on, the main switch on), or null. */
export function shownViewLink(links: readonly ViewLink[], master: boolean, hypo: string): ViewLink | null {
    return master ? links.find(l => l.hypo === hypo && l.on) ?? null : null;
}

// ==================== WHEN THE FEATURE SHOWS ====================

/** The bridge's /status feature: its GEDCOM says what each variant would connect. */
export const HYPOTHESIS_LINKS_FEATURE = 'hypothesis.links';

/** The tree's data say what a variant would connect (a variant's link, or a join naming its variant). */
export function hasViewLinkData(data: StromData | null | undefined): boolean {
    return Object.values(data?.persons ?? {}).some(p => {
        const r = p?.research;
        if (!r) return false;
        return !!(r.hypotheses?.some(h => h.variants?.some(v => v.links.length > 0))
            || r.edge?.hypos.some(h => (h.variants?.length ?? 0) > 0)
            || r.island?.hypos.some(h => (h.variants?.length ?? 0) > 0));
    });
}

/**
 * Whether "Linked in the view only" shows for the tree at all (menus, the
 * list, the settings row): its data say what a variant would connect, and a
 * live bridge (given: the tree follows it) says hypothesis.links too. A tree
 * from a file, an archive the same: the data alone.
 */
export function viewLinksAvailable(data: StromData | null | undefined, bridge?: { features: readonly string[] | null } | null): boolean {
    if (!hasViewLinkData(data)) return false;
    return !bridge || !!bridge.features?.includes(HYPOTHESIS_LINKS_FEATURE);
}

// ==================== WHAT A VIEW DRAWS ====================

/** The views that draw the links "linked in the view only"; the others (fan, timeline, map) never see them. */
export const VIEW_LINK_VIEWS: readonly string[] = ['family', 'descendants'];

/**
 * The links a view lays out as if real (src/layout/pipeline/view-layer.ts):
 * none outside the Family and Descendants views, none when the feature is
 * not available for the tree or the main switch is off; else the drawn,
 * switched on records the view reaches (activeViewLinks).
 */
export function viewLinksToDraw(data: StromData, opts: {
    viewMode: string;
    links: readonly ViewLink[];
    master: boolean;
    bridge?: { features: readonly string[] | null } | null;
}): ViewLink[] {
    if (!VIEW_LINK_VIEWS.includes(opts.viewMode) || !opts.master || opts.links.length === 0) return [];
    if (!viewLinksAvailable(data, opts.bridge)) return [];
    const ctx = viewLinkContext(data);
    return activeViewLinks(data, resolveViewLinks(data, opts.links, ctx), opts.master, ctx);
}
