/**
 * Step 5 – What will happen (spec 134 §8, frames 5, 13d, 13e, 14d).
 *
 * The left column lists the whole plan group by group (New, Joined, Detail
 * changes, Couples and links, Sources, Places, Photos and files, Not added,
 * Not taken over); only what is ticked happens: unticking a new person
 * leaves it out ("unticked (step 5)"; one others link to the tree through
 * asks first, K4.3), unticking a detail keeps the tree's value, unticking a
 * couple or a link leaves it out. The right column: Where to write (the
 * tree itself or a new tree, K6.3), the preview around a person (In the
 * tree moves it there, K6.2), the backup line (K6.6) and Save the list…
 * (K6.4). The button with the result is the guide's primary.
 *
 * The step keeps no state of the merge: the ticks go into the choices
 * (`leftOut`, `rules.value`, `offLinks`, `into`), every number comes from
 * the plan. What the view shows (open groups, the search, the preview's
 * person) is the view's, kept per merge state.
 */

import { strings } from '../../strings.js';
import type { MergeState } from '../types.js';
import type { PersonId, StromData } from '../../types.js';
import { yearOf } from '../../dates.js';
import { inferBirthUpperBounds, isLivingPerson } from '../../privacy.js';
import { renderTreeThumbnail } from '../../tree-preview.js';
import { changesValue, planCounts, type MergePlan, type PlanItem, type PlanRules, type RuleChoice, type SkipReason } from '../plan.js';
import { afterText, fieldKind, ruleFor } from '../plan-rules.js';
import { connectedNew, connectionTerm, displayName, familyName, type NewConnection } from '../plan-select.js';
import { newTreeName } from '../write.js';
import type { StepContext, WriteAction, WriteStatus } from './context.js';
import { barHtml } from '../../ui/prog-bar.js';
import { busySpinHtml } from '../../ui/busy.js';
import { escapeHtml, glyph, stepHeading } from './context.js';
import { isCopyOfTarget } from './step2-who.js';
import { fold, relationText, triState, yearsText } from './step3-model.js';
import { tickPeople, untickPeople } from './step3-whom.js';
import { sourceText } from './step4-rules.js';
import { VirtualList } from '../virtual-list.js';

/** The groups of the list, in their order. */
export type PlanGroupKey = 'new' | 'joined' | 'fields' | 'fills' | 'sourcesJoined' | 'links' | 'sources' | 'places' | 'media' | 'skipped' | 'notTaken';

/** One line of the list. */
export interface PlanLine {
    /**
     * Unique within the list: `p:<id>` a new person, `j:<id>` a joined one,
     * `s:<id>` one not added, `f:<treePerson>|<field>` a detail, `l:<id>` a
     * couple or a link the import adds, `c:`/`d:` one a group connects or the
     * tree loses, `r:<kind>:<id>` a record, `x:<tag>` what is not taken over.
     */
    key: string;
    /** Ticked: it happens. */
    on: boolean;
    /** Its box can be changed here (else decided in another step, or it comes along). */
    can: boolean;
    /** A person's name (serif) or the line's subject. */
    name: string;
    years: string;
    /** What happens or where it links. */
    text: string;
    /** The import's person the preview moves to (In the tree). */
    person?: PersonId;
    living?: boolean;
    /** Text the search looks in (folded). */
    find: string;
}

export interface PlanListGroup {
    key: PlanGroupKey;
    title: string;
    /** The group's number (from planCounts where it has one). */
    count: number;
    /** The short line beside the title. */
    summary: string;
    lines: PlanLine[];
    /** Lines kept out of the count but shown on request (Detail changes: the differences that stay as in the tree). */
    kept: PlanLine[];
    /** The sentence before the kept lines ("38 differences stay as in the tree …"). */
    keptText: string;
}

/** Above this many lines an open group shows its first few and "and n more · Show all". */
const FIRST_LINES = 3;

/** Below this width the preview is behind a button, as a sheet (the same as step 3). */
const PREVIEW_SIDE_FROM = 1100;

// ==================== MODEL ====================

function personYears(p: { birthDate?: string; deathDate?: string } | undefined): string {
    return p ? yearsText({ born: yearOf(p.birthDate), died: yearOf(p.deathDate) }) : '';
}

/** Living people of an import or a tree, as the privacy rules judge them. */
function livingOf(data: StromData): (id: PersonId) => boolean {
    const year = new Date().getFullYear();
    let bounds: Map<string, number> | null = null;
    const cache = new Map<PersonId, boolean>();
    return id => {
        let v = cache.get(id);
        if (v === undefined) {
            const p = data.persons[id];
            bounds ??= inferBirthUpperBounds(data);
            v = !!p && !p.isPlaceholder && isLivingPerson(p, year, bounds);
            cache.set(id, v);
        }
        return v;
    };
}

/** The choice the rules give a value when its own choice is set aside. */
function ruleWithout(rules: PlanRules, person: PersonId, field: string): RuleChoice {
    const value = { ...(rules.value ?? {}) };
    delete value[`${person}|${field}`];
    return ruleFor({ ...rules, value }, person, field).choice;
}

/**
 * The plan as step 5 lists it (no DOM; tests read it). `relation` says
 * where a new person links ("son of …"), empty when it is not worked out.
 * Living people's details are not shown (13e), only that they change.
 */
export function planList(plan: MergePlan, state: MergeState, offLinks: readonly string[] = [], relation: (id: PersonId) => string = () => ''): PlanListGroup[] {
    const W = strings.mergeWizard;
    const source = state.incomingData;
    const tree = state.existingData;
    const c = planCounts(plan);
    const living = livingOf(source);
    const treeLiving = livingOf(tree);
    const nameIn = (data: StromData, id: string): string => displayName(data.persons[id as PersonId]) || '?';
    const fieldName = (f: string): string => (W.fieldNames as Record<string, string>)[f] ?? f;
    const groups: PlanListGroup[] = [];
    const add = (key: PlanGroupKey, title: string, count: number, summary: string, lines: PlanLine[], kept: PlanLine[] = [], keptText = ''): void => {
        groups.push({ key, title, count, summary, lines, kept, keptText });
    };
    const byKind = <K extends PlanItem['kind']>(kind: K): Array<PlanItem & { kind: K }> =>
        plan.items.filter((i): i is PlanItem & { kind: K } => i.kind === kind);

    // New, by family name (the largest families in the summary).
    const rods = new Map<string, number>();
    const fresh = byKind('person-add').filter(i => i.on).map(i => {
        const p = source.persons[i.id];
        const rod = familyName(source, p) || W.s3NoSurname;
        rods.set(rod, (rods.get(rod) ?? 0) + 1);
        const own = i.ownTree ? plan.groups?.find(g => g.key === i.ownTree)?.ownTreeName ?? '' : '';
        const name = displayName(p) || '?';
        const text = own ? `→ ${own}` : relation(i.id);
        const line: PlanLine = { key: `p:${i.id}`, on: true, can: true, name, years: personYears(p), text, person: i.id, living: living(i.id), find: fold(`${name} ${text}`) };
        return { line, rod };
    });
    fresh.sort((a, b) => a.rod.localeCompare(b.rod) || a.line.name.localeCompare(b.line.name));
    const rodSummary = [...rods].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ${n.toLocaleString()}`).join(' · ');
    add('new', W.gNew, c.added, rodSummary, fresh.map(l => l.line));

    // Joined (decided in step 2).
    add('joined', W.gJoined, c.joined, W.joinedSum(c.joined, c.fieldChanges), byKind('person-join').filter(i => i.on && !i.standIn).map(i => {
        const name = displayName(source.persons[i.id]) || '?';
        const text = W.joinedWith(nameIn(tree, i.target));
        return { key: `j:${i.id}`, on: true, can: false, name, years: personYears(source.persons[i.id]), text, person: i.id, living: living(i.id), find: fold(`${name} ${text}`) };
    }));

    // Detail changes: the import's values written (and kept alongside); the differences that stay on request.
    const fieldLine = (i: Extract<PlanItem, { kind: 'field' | 'field-both' }>, on: boolean): PlanLine => {
        const name = nameIn(tree, i.person);
        const hide = treeLiving(i.person);
        const gap = i.kind === 'field' && i.before === '' && i.field !== 'notes';
        const from = gap && i.rule.level !== 'value' ? W.gapFill : sourceText(i.rule, fieldKind(i.field));
        const value = i.kind === 'field' ? `${i.before || '—'} → ${afterText(i.field, i.before, i.after) || '—'}` : `+ ${i.value}`;
        const text = hide ? `${fieldName(i.field)} · ${from}` : `${fieldName(i.field)}: ${value} · ${from}`;
        // A protected value is changed in step 4 only.
        const can = !(i.kind === 'field' && i.protected);
        return { key: `f:${i.person}|${i.field}`, on, can, name, years: personYears(tree.persons[i.person]), text, living: hide, find: fold(`${name} ${text}`) };
    };
    const fieldsOn = [
        ...byKind('field').filter(i => i.on && changesValue(i)).map(i => fieldLine(i, true)),
        ...byKind('field-both').filter(i => i.on).map(i => fieldLine(i, true)),
    ];
    const fieldsOff = byKind('field').filter(i => !i.on && changesValue(i)).map(i => fieldLine(i, false));
    const keptText = fieldsOff.length ? W.fieldsKept(fieldsOff.length, plan.target.name) : '';
    add('fields', W.gFields, c.fieldChanges + c.alongside, keptText, fieldsOn, fieldsOff, keptText);

    // The other empty details of joined people the write fills (134 S-N1): shown only when there are some.
    const fills = byKind('fill').map(i => fillLine(tree, i.person, i.field, treeLiving(i.person)));
    if (fills.length) add('fills', W.gFills, c.fieldFills, fillSummary(fills), fills);

    // Sources of the import joined with the tree's same source (134 S-N3): written once; shown only when there are some.
    const sourceTitle = (data: StromData, id: string): string => data.sources?.[id]?.title || id;
    const sourcesJoined = byKind('source').filter(i => i.on && i.joinedWith).map(i => {
        const name = sourceTitle(source, i.id);
        const text = W.joinedWith(sourceTitle(tree, i.joinedWith!));
        return { key: `r:source:${i.id}`, on: true, can: false, name, years: '', text, find: fold(`${name} ${text}`) } satisfies PlanLine;
    });
    if (c.sourcesJoined) add('sourcesJoined', W.gSourcesJoined, c.sourcesJoined, W.sourcesJoinedSum(c.sourcesJoined), sourcesJoined);

    // Couples and links: what the import adds (one left out by a choice of step 4 stays out here), what the tree loses.
    const off = new Set(offLinks);
    const links: PlanLine[] = [];
    const linkLine = (key: string, id: string, on: boolean, name: string): PlanLine => {
        const mine = off.has(id);
        return { key, on, can: on || mine, name, years: '', text: on || mine ? '' : W.relKept, find: fold(name) };
    };
    for (const i of byKind('partnership-add')) {
        const u = source.partnerships[i.id as keyof StromData['partnerships']];
        links.push(linkLine(`l:${i.id}`, i.id, i.on, u ? `${nameIn(source, u.person1Id)} & ${nameIn(source, u.person2Id)}` : i.id));
    }
    for (const i of byKind('link-add')) {
        const [child, parent] = i.id.split('<');
        links.push(linkLine(`l:${i.id}`, i.id, i.on, `${nameIn(source, child)} ← ${nameIn(source, parent)}`));
    }
    for (const i of byKind('connect')) {
        const name = `${nameIn(source, i.person)} ← ${nameIn(i.in === 'tree' ? tree : source, i.to)}`;
        links.push({ key: `c:${i.group}`, on: true, can: false, name, years: '', text: '', find: fold(name) });
    }
    for (const i of byKind('partnership-drop')) {
        const u = tree.partnerships[i.id];
        const name = u ? `${nameIn(tree, u.person1Id)} & ${nameIn(tree, u.person2Id)}` : i.id;
        links.push({ key: `d:${i.id}`, on: true, can: false, name, years: '', text: W.relDrop, find: fold(`${name} ${W.relDrop}`) });
    }
    for (const i of byKind('link-drop')) {
        const name = `${nameIn(tree, i.child)} ← ${nameIn(tree, i.parent)}`;
        links.push({ key: `d:${i.child}<${i.parent}`, on: true, can: false, name, years: '', text: W.relDrop, find: fold(`${name} ${W.relDrop}`) });
    }
    add('links', W.gLinks, c.partnerships + c.links, W.linksSum(c.partnerships, c.links), links);

    // Sources, places, photos and files: they come with the people (joined with the tree's where the same).
    const records = (kind: 'source' | 'place' | 'media', key: PlanGroupKey, title: string, own: (id: string) => string, theirs: (id: string) => string): void => {
        // The joined sources have their group above.
        const items = plan.items.filter((i): i is Extract<PlanItem, { kind: 'source' | 'place' | 'media' }> => i.kind === kind && i.on && !(kind === 'source' && i.joinedWith));
        // Without photos the group is left out (13d).
        if (kind === 'media' && !items.length) return;
        const joinedN = items.filter(i => i.joinedWith).length;
        add(key, title, items.length, W.recordsSum(items.length - joinedN, joinedN), items.map(i => {
            const name = own(i.id);
            const text = i.joinedWith ? W.joinedWith(theirs(i.joinedWith)) : '';
            return { key: `r:${kind}:${i.id}`, on: true, can: false, name, years: '', text, find: fold(`${name} ${text}`) };
        }));
    };
    records('source', 'sources', W.gSources, id => sourceTitle(source, id), id => sourceTitle(tree, id));
    records('place', 'places', W.gPlaces, id => id, id => id);
    records('media', 'media', W.gMedia, id => source.media?.[id]?.name || id, id => tree.media?.[id]?.name || id);

    // Not added, with why and in which step (unticked here: back with its box).
    const why = new Map<string, number>();
    const skipped: PlanLine[] = [];
    const skipLine = (id: PersonId, reason: SkipReason): void => {
        const label = W.skipWhy[reason] ?? reason;
        why.set(label, (why.get(label) ?? 0) + 1);
        const name = displayName(source.persons[id]) || '?';
        skipped.push({ key: `s:${id}`, on: false, can: reason === 'step5', name, years: personYears(source.persons[id]), text: label, person: id, living: living(id), find: fold(`${name} ${label}`) });
    };
    for (const i of plan.items) {
        if (i.kind === 'skip' && !i.standIn) skipLine(i.id, i.reason);
        else if (i.kind === 'person-join' && !i.on && !i.standIn) skipLine(i.id, 'step2');
    }
    add('skipped', W.gSkipped, c.skipped, [...why].map(([l, n]) => `${l} ${n.toLocaleString()}`).join(' · '), skipped);

    // What the tree does not take over (K1.6).
    const dropped = plan.notTaken.filter(d => d.count > 0);
    if (dropped.length) {
        add('notTaken', W.gNotTaken, dropped.length, dropped.map(d => `${d.tag} ${d.count.toLocaleString()}×`).join(' · '), dropped.map(d => {
            const name = W.notTakenItem(d.label ? `${d.tag} – ${d.label}` : d.tag, d.count, d.example);
            return { key: `x:${d.tag}`, on: false, can: false, name, years: '', text: '', find: fold(name) };
        }));
    }
    return groups;
}

// ==================== CHOICES ====================

/**
 * A line's box changed (a group's box: each of its lines that can change).
 * People go out of the plan or back; a detail keeps the tree's value or
 * takes the import's; a couple or a link is left out or back.
 */
export function setLines(ctx: StepContext, lines: readonly PlanLine[], on: boolean, what: string): void {
    const c = ctx.choices;
    const people = lines.filter(l => l.can && (l.key.startsWith('p:') || l.key.startsWith('s:'))).map(l => l.key.slice(2) as PersonId);
    if (people.length) {
        if (on) tickPeople(ctx, people);
        else untickPeople(ctx, people, what, people.length === 1 ? people[0] : null);
        return;
    }
    const value = { ...(c.rules?.value ?? {}) };
    const off = new Set(c.offLinks ?? []);
    let fields = false;
    let rel = false;
    for (const l of lines) {
        if (!l.can) continue;
        if (l.key.startsWith('f:')) {
            fields = true;
            const [person, field] = l.key.slice(2).split('|') as [PersonId, string];
            const key = `${person}|${field}`;
            if (!on) { value[key] = 'mine'; continue; }
            delete value[key];
            // A difference the other rules keep as the tree's: the import's value chosen for it alone.
            const item = ctx.plan?.items.find(i => i.kind === 'field' && i.person === person && i.field === field);
            if (item?.kind === 'field' && item.before !== '' && field !== 'notes' && ruleWithout(c.rules ?? { all: 'mine' }, person, field) === 'mine') value[key] = 'import';
        } else if (l.key.startsWith('l:')) {
            rel = true;
            if (on) off.delete(l.key.slice(2)); else off.add(l.key.slice(2));
        }
    }
    const change: Partial<StepContext['choices']> = {};
    if (fields) change.rules = { ...(c.rules ?? { all: 'mine' }), value };
    if (rel) change.offLinks = [...off];
    if (fields || rel) ctx.update(change);
}

// ==================== VIEW ====================

interface View {
    /** The wizard's state; null for a list read from a merge's record (§9 9b). */
    ctx: StepContext | null;
    root: HTMLElement | null;
    /** Groups opened or closed against their default. */
    toggled: Set<PlanGroupKey>;
    /** Groups showing every line, not only the first few. */
    all: Set<PlanGroupKey>;
    keptShown: boolean;
    query: string;
    /** The import's person the preview is around (In the tree). */
    focus: PersonId | null;
    previewDrawn: string;
    relations: Map<PersonId, string>;
    conns: Map<PersonId, NewConnection> | null;
    groups: PlanListGroup[];
    /** The list's drawn part (§13h: Show all on thousands of lines draws only the rows near the view). */
    list: VirtualList | null;
    /** The list alone, read only (step 6, §9): no boxes, no In the tree, no side column. */
    readOnly: boolean;
    /** The groups when they do not come from the plan (a merge's record, §9 9b). */
    groupsOf: (() => PlanListGroup[]) | null;
}

const views = new WeakMap<MergeState, View>();
/** Step 6's read-only list keeps its own open groups and search. */
const readViews = new WeakMap<MergeState, View>();
/** Lists read from a merge's record, by the key their caller gives. */
const recordViews = new WeakMap<object, View>();
let current: View | null = null;

function viewOf(ctx: StepContext, readOnly = false): View {
    const map = readOnly ? readViews : views;
    let v = map.get(ctx.state);
    if (!v) {
        v = newView(ctx, readOnly);
        map.set(ctx.state, v);
    }
    v.ctx = ctx;
    if (!readOnly) current = v;
    return v;
}

function newView(ctx: StepContext | null, readOnly: boolean): View {
    return { ctx, root: null, toggled: new Set(), all: new Set(), keptShown: false, query: '', focus: null, previewDrawn: '', relations: new Map(), conns: null, groups: [], list: null, readOnly, groupsOf: null };
}

/** Where a new person links ("son of …"), worked out once per drawing. */
function relationOf(view: View, id: PersonId): string {
    let t = view.relations.get(id);
    if (t !== undefined) return t;
    if (!view.ctx) return '';
    const { state, choices } = view.ctx;
    if (choices.mode !== 'add') return '';
    view.conns ??= connectedNew(state, choices);
    const conn = view.conns.get(id);
    t = conn ? relationText(state.incomingData, conn, connectionTerm(state, id, conn)) : '';
    view.relations.set(id, t);
    return t;
}

/** A line of the filled-in details: the tree's person and the detail's name (`i:` person|detail). */
export function fillLine(tree: StromData, person: PersonId, field: string, living: boolean): PlanLine {
    const W = strings.mergeWizard;
    const name = displayName(tree.persons[person]) || '?';
    const text = (W.fieldNames as Record<string, string>)[field] ?? field;
    return { key: `i:${person}|${field}`, on: true, can: false, name, years: personYears(tree.persons[person]), text, living, find: fold(`${name} ${text}`) };
}

/** The most filled details with their counts (the summary of the filled-in details). */
export function fillSummary(lines: readonly PlanLine[]): string {
    const by = new Map<string, number>();
    for (const l of lines) by.set(l.text, (by.get(l.text) ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(' · ');
}

/** On a phone the list starts with every group closed; elsewhere New is open. */
function openByDefault(key: PlanGroupKey): boolean {
    const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches;
    return !phone && key === 'new';
}

function isOpen(view: View, key: PlanGroupKey): boolean {
    if (view.query.trim()) return true;
    return openByDefault(key) !== view.toggled.has(key);
}

export function renderStep5(host: HTMLElement, ctx: StepContext): void {
    const view = viewOf(ctx);
    if (!view.root || !host.contains(view.root)) build(host, view);
    view.relations.clear();
    view.conns = null;
    update(view);
    showWriteStatus(ctx.step5?.status ?? null, ctx);
}

/**
 * Step 5's list read only (step 6, spec 134 §9): the same groups, lines
 * and search, without the boxes, In the tree and the side column.
 */
export function renderPlanListReadOnly(host: HTMLElement, ctx: StepContext): void {
    drawReadOnly(host, viewOf(ctx, true));
}

/**
 * A merge's list read from its record (§9 9b, the Merge history's Open the
 * list): the groups `groupsOf` gives, drawn like step 6's. `key` keeps the
 * open groups and the search while the same list is shown.
 */
export function renderGroupsReadOnly(host: HTMLElement, key: object, groupsOf: () => PlanListGroup[]): void {
    let view = recordViews.get(key);
    if (!view) {
        view = newView(null, true);
        recordViews.set(key, view);
    }
    view.groupsOf = groupsOf;
    drawReadOnly(host, view);
}

function drawReadOnly(host: HTMLElement, view: View): void {
    if (!view.root || !host.contains(view.root)) {
        const W = strings.mergeWizard;
        host.innerHTML = `<div class="merge-s5 is-read">
  <div class="merge-s5-head">
    <input type="search" class="merge-s5-search" placeholder="${escapeHtml(W.planSearch)}" aria-label="${escapeHtml(W.planSearch)}" autocomplete="off" spellcheck="false">
  </div>
  <ul class="merge-s5-list" aria-label="${escapeHtml(W.planList)}"></ul>
</div>`;
        view.root = host.querySelector<HTMLElement>('.merge-s5')!;
        view.list?.destroy();
        const list = view.root.querySelector<HTMLElement>('.merge-s5-list')!;
        view.list = new VirtualList(list, list, () => rowHeight(list), () => '');
        wire(view.root, view);
    }
    view.relations.clear();
    view.conns = null;
    updateList(view);
}

/**
 * Where the write stands (§8 8a–8f), said above the list with no frame:
 * the check and the write with their progress, or why nothing was written
 * and what can be done. Null hides it.
 */
export function showWriteStatus(status: WriteStatus | null, ctx: StepContext): void {
    const view = views.get(ctx.state);
    const box = view?.root?.isConnected ? view.root.querySelector<HTMLElement>('.merge-s5-status') : null;
    if (!box) return;
    box.hidden = !status;
    box.dataset.state = status?.kind ?? '';
    box.innerHTML = status ? statusHtml(status, ctx) : '';
    box.setAttribute('aria-busy', String(!!status && ['checking', 'backup', 'writing'].includes(status.kind)));
}

function statusHtml(st: WriteStatus, ctx: StepContext): string {
    const W = strings.mergeWizard;
    const bt = (act: string, label: string): string =>
        `<button type="button" class="secondary merge-s5-act" data-act="${act}">${escapeHtml(label)}</button>`;
    const acts = (...b: string[]): string => `<div class="merge-s5-acts">${b.join('')}</div>`;
    const spin = (text: string): string =>
        `<p class="merge-s5-st-line">${busySpinHtml(14)}<span>${escapeHtml(text)}</span></p>`;
    const safe = `<p class="merge-s5-note">${escapeHtml(W.writingSafe)}</p>`;
    switch (st.kind) {
        case 'checking':
            return spin(W.checking(st.p, st.l, st.s));
        case 'backup':
            return spin(W.backingUp(st.t)) + barHtml(null, { cls: 'merge-s5-bar' }) + safe;
        case 'writing':
            return spin(W.writing(st.t, st.a, st.n))
                + barHtml(st.n ? st.a / st.n : 0, { cls: 'merge-s5-bar', attrs: `role="progressbar" aria-valuemin="0" aria-valuemax="${st.n}" aria-valuenow="${st.a}"` })
                + safe;
        case 'bad':
            return `<p class="merge-s5-st-err"><b>${escapeHtml(W.badTotals)}</b> ${escapeHtml(st.message)}</p>`
                + acts(`<button type="button" class="secondary merge-s5-act" data-act="show-error" aria-expanded="false">${escapeHtml(W.showError)}</button>`,
                    bt('report', W.saveForReport), bt('whom', W.backToWhom))
                + `<pre class="merge-s5-err-detail" hidden>${escapeHtml(st.detail)}</pre>`;
        case 'changed':
            return `<p class="merge-s5-st-warn">${escapeHtml(st.text)} ${escapeHtml(W.replanned)}</p>`;
        case 'backupFailed':
            return `<p class="merge-s5-st-err"><b>${escapeHtml(W.backupFailed)}</b> <span class="merge-s5-st-why"${st.detail ? ` title="${escapeHtml(st.detail)}"` : ''}>${escapeHtml(st.why)}</span></p>`
                + acts(bt('backups', W.freeSpaceBackups), bt('save-tree', W.saveTreeFile(ctx.plan?.target.name ?? ctx.choices.targetName)), bt('retry', W.tryAgain));
        case 'failed':
            return `<p class="merge-s5-st-err"><b>${escapeHtml(st.message)}</b></p>` + acts(bt('retry', W.tryAgain));
        case 'retention':
            return `<p class="merge-s5-st-warn"><b>${escapeHtml(W.retentionAsk(st.date))}</b></p>`
                + acts(bt('keep-both', W.keepBoth), bt('drop-oldest', W.dropOldest));
    }
}

/** Close the preview sheet of step 5 (Esc); true when it was open. */
export function closeStep5Overlay(): boolean {
    const root = current?.root;
    if (root?.isConnected && root.classList.contains('is-sheet')) {
        setSheet(root, false);
        return true;
    }
    return false;
}

function setSheet(root: HTMLElement, on: boolean): void {
    root.classList.toggle('is-sheet', on);
    root.querySelector<HTMLElement>(on ? '.merge-s5-preview-close' : '.merge-s5-preview-open')?.focus();
}

function build(host: HTMLElement, view: View): void {
    const W = strings.mergeWizard;
    view.previewDrawn = '';
    host.innerHTML = `${stepHeading(5, W.planTitle)}
<div class="merge-s5">
  <div class="merge-s5-main">
    <div class="merge-s5-status" role="status" aria-live="polite" hidden></div>
    <div class="merge-s5-head">
      <span class="merge-s5-sub">${escapeHtml(W.planOnlyTicked)}</span>
      <input type="search" class="merge-s5-search" placeholder="${escapeHtml(W.planSearch)}" aria-label="${escapeHtml(W.planSearch)}" autocomplete="off" spellcheck="false">
    </div>
    <ul class="merge-s5-list" aria-label="${escapeHtml(W.planList)}"></ul>
  </div>
  <div class="merge-s5-side">
    <div class="merge-s5-where" hidden>
      <h4 class="merge-s5-h" id="merge-s5-where-t">${escapeHtml(W.whereTo)}</h4>
      <div class="sel-seg merge-s5-into" role="radiogroup" aria-labelledby="merge-s5-where-t">
        <button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-into="tree"></button>
        <button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-into="new"></button>
      </div>
    </div>
    <p class="merge-s5-note merge-s5-mode"></p>
    <button type="button" class="secondary merge-s5-preview-open">${escapeHtml(W.previewBtn)}</button>
    <aside class="merge-s5-preview" aria-labelledby="merge-s5-preview-t">
      <div class="merge-s5-preview-head"><h4 id="merge-s5-preview-t" class="merge-s5-h">${escapeHtml(W.previewBtn)}</h4>
        <button type="button" class="close-btn merge-s5-preview-close" aria-label="${escapeHtml(strings.buttons.close)}">&times;</button></div>
      <div class="merge-s5-thumb"></div>
      <p class="merge-s5-note merge-s5-preview-cap"></p>
    </aside>
    <p class="merge-s5-note merge-s5-backup" hidden>${escapeHtml(W.backupLine)}</p>
    <p class="merge-s5-note merge-s5-research" hidden></p>
    <button type="button" class="link-button merge-s5-save">${escapeHtml(W.savePlan)}</button>
  </div>
</div>`;
    view.root = host.querySelector<HTMLElement>('.merge-s5')!;
    view.list?.destroy();
    const list = view.root.querySelector<HTMLElement>('.merge-s5-list')!;
    view.list = new VirtualList(list, list, () => rowHeight(list), () => '', () => {
        list.querySelectorAll<HTMLInputElement>('input[data-mixed]').forEach(cb => { cb.indeterminate = true; });
    });
    wire(view.root, view);
}

/** The rows' one height from the stylesheet (taller to touch, and on a phone, where a row has two lines). */
function rowHeight(list: HTMLElement): number {
    const h = parseFloat(getComputedStyle(list).getPropertyValue('--s5-row'));
    return Number.isFinite(h) && h > 0 ? h : 32;
}

function lineHtml(line: PlanLine, group: PlanGroupKey, readOnly = false): string {
    const W = strings.mergeWizard;
    const box = readOnly ? '' : line.can
        ? `<input type="checkbox" class="merge-s5-cb" data-line="${escapeHtml(line.key)}" data-vkey="cb:${escapeHtml(line.key)}"${line.on ? ' checked' : ''} aria-label="${escapeHtml(line.name)}">`
        : `<input type="checkbox" class="merge-s5-cb" disabled${line.on ? ' checked' : ''} aria-label="${escapeHtml(line.name)}">`;
    const mark = group === 'new' ? `<span class="merge-s5-glyph">${glyph('added', 11, 3)}</span>` : '';
    const serif = line.person || group === 'fields' || group === 'fills' ? ' is-person' : '';
    const years = line.years ? `<span class="merge-s5-years">${escapeHtml(line.years)}</span>` : '';
    const living = line.living ? `<span class="merge-s5-tag">${escapeHtml(W.livingTag)}</span>` : '';
    const text = `<span class="merge-s5-text"${line.text ? ` title="${escapeHtml(line.text)}"` : ''}>${escapeHtml(line.text)}</span>`;
    const inTree = !readOnly && line.person && (group === 'new' || group === 'joined')
        ? `<button type="button" class="link-button merge-s5-in" data-in="${escapeHtml(line.person)}" data-vkey="in:${escapeHtml(line.key)}">${escapeHtml(W.inTree)}</button>` : '';
    return `<li class="merge-s5-row${line.on ? '' : ' is-off'}" data-key="${escapeHtml(line.key)}">`
        + `${box}${mark}<span class="merge-s5-name${serif}" title="${escapeHtml(line.name)}">${escapeHtml(line.name)}</span>${years}${living}${text}${inTree}</li>`;
}

/** "and 2 995 more · Show all": the sentence shortens (whole as its title), the button stays. */
function moreHtml(text: string, button: string): string {
    return `<li class="merge-s5-more"><span class="merge-s5-more-t" title="${escapeHtml(text)}">${escapeHtml(text)} ·</span>${button}</li>`;
}

function update(view: View): void {
    if (!updateList(view) || view.readOnly) return;
    updateSide(view);
}

/** The groups and their lines (false: no plan yet). */
function updateList(view: View): boolean {
    const { ctx } = view;
    const W = strings.mergeWizard;
    const plan = ctx?.plan;
    if (view.groupsOf) {
        view.groups = view.groupsOf();
    } else if (!ctx || !plan) {
        view.list?.refresh(0, () => '');
        return false;
    } else {
        view.groups = planList(plan, ctx.state, ctx.choices.offLinks, id => relationOf(view, id));
    }
    const ro = view.readOnly;
    const q = fold(view.query.trim());
    const rows: string[] = [];
    for (const g of view.groups) {
        const lines = q ? g.lines.filter(l => l.find.includes(q)) : g.lines;
        const kept = q ? g.kept.filter(l => l.find.includes(q)) : g.kept;
        if (q && !lines.length && !kept.length) continue;
        const open = isOpen(view, g.key);
        const can = [...g.lines, ...g.kept].filter(l => l.can);
        const tri = can.length ? triState(can.map(l => l.key as PersonId), new Set(can.filter(l => l.on).map(l => l.key as PersonId))) : null;
        const box = ro ? '' : tri
            ? `<input type="checkbox" class="merge-s5-gcb" data-group="${g.key}" data-vkey="g:${g.key}"${tri === 'all' ? ' checked' : ''}${tri === 'some' ? ' data-mixed' : ''} aria-label="${escapeHtml(g.title)}">`
            : '<span class="merge-s5-cb-none" aria-hidden="true"></span>';
        const caret = g.lines.length || g.kept.length
            ? `<button type="button" class="merge-s5-caret" data-toggle="${g.key}" data-vkey="t:${g.key}" aria-expanded="${open}" aria-label="${escapeHtml(g.title)}"><span aria-hidden="true">›</span></button>`
            : '<span class="merge-s5-caret" aria-hidden="true"></span>';
        rows.push(`<li class="merge-s5-gh${open ? ' is-open' : ''}" data-group="${g.key}">${box}${caret}`
            + `<span class="merge-s5-gname">${escapeHtml(g.title)}</span><span class="merge-s5-gcount">${g.count.toLocaleString()}</span>`
            + `<span class="merge-s5-gsum" title="${escapeHtml(g.summary)}">${escapeHtml(g.summary)}</span></li>`);
        if (!open) continue;
        const showAll = !!q || view.all.has(g.key) || lines.length <= FIRST_LINES + 1;
        const shown = showAll ? lines : lines.slice(0, FIRST_LINES);
        for (const l of shown) rows.push(lineHtml(l, g.key, ro));
        if (!showAll) {
            rows.push(moreHtml(W.moreItems(lines.length - shown.length),
                `<button type="button" class="link-button" data-all="${g.key}" data-vkey="a:${g.key}">${escapeHtml(W.showAll)}</button>`));
        }
        if (g.kept.length) {
            if (view.keptShown || q) for (const l of kept) rows.push(lineHtml(l, g.key, ro));
            else rows.push(moreHtml(g.keptText, `<button type="button" class="link-button" data-kept="1" data-vkey="k:${g.key}">${escapeHtml(W.showKept)}</button>`));
        }
    }
    // Show all (and a search) can list thousands of lines: only the rows near the view are drawn.
    view.list?.refresh(rows.length, i => rows[i]);
    return true;
}

/** Where to write, the mode's sentence, the backup and research lines, the preview. */
function updateSide(view: View): void {
    const root = view.root!;
    const ctx = view.ctx!;
    const W = strings.mergeWizard;
    const plan = ctx.plan!;

    // Where to write: only an import added to a tree.
    const adding = plan.mode === 'add';
    root.querySelector<HTMLElement>('.merge-s5-where')!.hidden = !adding;
    const into = ctx.choices.into ?? 'tree';
    if (adding) {
        root.querySelectorAll<HTMLButtonElement>('.merge-s5-into .sel-opt').forEach(b => {
            const on = b.dataset.into === into;
            b.textContent = b.dataset.into === 'tree' ? W.writeInto(plan.target.name) : W.writeNew;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
        });
    }
    const mode = root.querySelector<HTMLElement>('.merge-s5-mode')!;
    mode.textContent = isCopyOfTarget(ctx) && ctx.counts ? W.sameAsTarget(ctx.counts.total, ctx.choices.targetName)
        : adding ? (into === 'new' ? `${W.writeNewDesc(plan.target.name)} ${W.newTreeNamed(newTreeName(plan))}` : '')
        : plan.mode === 'new' ? W.modeNewDesc(newTreeName(plan), ctx.counts?.added ?? 0)
        : W.modeCompareDesc;
    mode.hidden = !mode.textContent;
    root.querySelector<HTMLElement>('.merge-s5-backup')!.hidden = !(adding && into === 'tree');
    const research = root.querySelector<HTMLElement>('.merge-s5-research')!;
    research.hidden = !(adding && into === 'tree' && plan.target.research);
    research.textContent = research.hidden ? '' : W.resStep5(plan.target.name);
    drawPreview(view);
}

/** The preview around the chosen person (or the first new one), its new people dashed. */
function drawPreview(view: View): void {
    const root = view.root!;
    const W = strings.mergeWizard;
    const plan = view.ctx!.plan!;
    const source = view.ctx!.state.incomingData;
    const fresh = plan.items.flatMap(i => i.kind === 'person-add' && i.on ? [i.id] : []);
    const joinedFirst = plan.items.flatMap(i => i.kind === 'person-join' && i.on ? [i.id] : [])[0] ?? null;
    const focus = view.focus && source.persons[view.focus] ? view.focus : fresh[0] ?? joinedFirst;
    const key = `${focus ?? ''}|${fresh.join(',').length}|${fresh.length}`;
    if (key === view.previewDrawn) return;
    view.previewDrawn = key;
    const box = root.querySelector<HTMLElement>('.merge-s5-thumb')!;
    const cap = root.querySelector<HTMLElement>('.merge-s5-preview-cap')!;
    if (!focus) {
        box.innerHTML = `<p class="merge-s5-none">${escapeHtml(W.previewNone)}</p>`;
        cap.textContent = '';
        return;
    }
    cap.textContent = W.planPreviewCap(displayName(source.persons[focus]) || '?');
    try {
        renderTreeThumbnail(box, { data: source, focusPersonId: focus, depthUp: 2, depthDown: 2, labels: true, hits: new Set(fresh) });
    } catch {
        box.innerHTML = `<p class="merge-s5-none">${escapeHtml(W.previewNone)}</p>`;
    }
}

function findLine(view: View, key: string): PlanLine | undefined {
    for (const g of view.groups) {
        const l = g.lines.find(x => x.key === key) ?? g.kept.find(x => x.key === key);
        if (l) return l;
    }
    return undefined;
}

function chooseInto(view: View, into: 'tree' | 'new'): void {
    const ctx = view.ctx!;
    if ((ctx.choices.into ?? 'tree') !== into) ctx.update({ into });
    view.root?.querySelector<HTMLElement>(`.merge-s5-into [data-into="${into}"]`)?.focus();
}

function wire(root: HTMLElement, view: View): void {
    const search = root.querySelector<HTMLInputElement>('.merge-s5-search')!;
    search.value = view.query;
    search.addEventListener('input', () => {
        view.query = search.value;
        update(view);
    });
    root.addEventListener('change', e => {
        const t = e.target as HTMLInputElement;
        if (t.matches('.merge-s5-cb')) {
            const line = findLine(view, t.dataset.line ?? '');
            if (line) setLines(view.ctx!, [line], t.checked, line.name);
            else update(view);
        } else if (t.matches('.merge-s5-gcb')) {
            const g = view.groups.find(x => x.key === t.dataset.group);
            if (g) setLines(view.ctx!, [...g.lines, ...g.kept].filter(l => l.can), t.checked, g.title);
        }
    });
    root.addEventListener('click', e => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('button');
        if (!el || !root.contains(el)) return;
        if (el.dataset.toggle) {
            const k = el.dataset.toggle as PlanGroupKey;
            if (view.toggled.has(k)) view.toggled.delete(k); else view.toggled.add(k);
            update(view);
            root.querySelector<HTMLElement>(`[data-toggle="${k}"]`)?.focus();
        } else if (el.dataset.all) {
            view.all.add(el.dataset.all as PlanGroupKey);
            update(view);
        } else if (el.dataset.kept) {
            view.keptShown = true;
            update(view);
        } else if (el.dataset.in) {
            view.focus = el.dataset.in as PersonId;
            drawPreview(view);
            if (window.innerWidth < PREVIEW_SIDE_FROM) setSheet(root, true);
        } else if (el.dataset.into) {
            chooseInto(view, el.dataset.into as 'tree' | 'new');
        } else if (el.matches('.merge-s5-act')) {
            const act = el.dataset.act ?? '';
            if (act === 'show-error') {
                const pre = root.querySelector<HTMLElement>('.merge-s5-err-detail');
                if (pre) pre.hidden = !pre.hidden;
                el.setAttribute('aria-expanded', String(!!pre && !pre.hidden));
            } else if (act === 'report') {
                view.ctx?.step5?.savePlan();
            } else {
                view.ctx?.step5?.act(act as WriteAction);
            }
        } else if (el.matches('.merge-s5-save')) {
            view.ctx?.step5?.savePlan();
        } else if (el.matches('.merge-s5-preview-open')) {
            setSheet(root, true);
        } else if (el.matches('.merge-s5-preview-close')) {
            setSheet(root, false);
        }
    });
    // The segment's arrows (a radio group of two).
    root.querySelector('.merge-s5-into')?.addEventListener('keydown', e => {
        const k = (e as KeyboardEvent).key;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
        e.preventDefault();
        chooseInto(view, (view.ctx?.choices.into ?? 'tree') === 'tree' ? 'new' : 'tree');
    });
}
