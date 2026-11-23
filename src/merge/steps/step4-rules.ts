/**
 * Step 4 – Who is right (spec 134 §7, frames 7a–7e). The rule for the whole
 * merge as five tiles (each with its count and an example on one person),
 * the details a bulk rule never overwrites, the rules by kind of detail, by
 * person (with where each result comes from; a value chosen by a click) and
 * the conflicts of relations, each decided on its own. Scopes a) and b) only
 * show the conflicts of relations, or say why the step is skipped (7e).
 * The rules and choices live in WizardChoices (rules, relations); the plan
 * (plan-rules.ts) works out what they do.
 */

import { strings } from '../../strings.js';
import type { StepContext } from './context.js';
import { escapeHtml, stepHeading } from './context.js';
import type { MergeState } from '../types.js';
import type { FieldKind, MergePlan, PlanRules, RuleChoice, RuleSource } from '../plan.js';
import {
    FIELD_KINDS, mergeDifferences, relationConflicts, resolveField, ruleCounts,
    type EndOf, type FieldDifference, type Protection, type RelChoice, type RelConflict, type RuleExample,
} from '../plan-rules.js';
import { step4Need } from '../wizard-steps.js';
import type { PartnershipStatus, Person, PersonId } from '../../types.js';
import { shownName } from '../../person-name.js';
import { formatFlexDate } from '../../dates.js';
import { reliabilityHtml } from '../../ui/fact-status.js';
import { isGender } from '../../model-values.js';
import { pendingImageOf } from '../../research-image-refs.js';
import { imgStateOf, smallPortraitHtml, type ImgState } from '../../ui/image-slot.js';
import { personPhotoKey } from '../../ui/person-photo-model.js';
import { personInitials } from '../../initials.js';
import { imageLoads } from '../../image-loads.js';

const RULES: readonly RuleChoice[] = ['mine', 'import', 'both', 'precise', 'each'];
/** How many persons "By person" draws before "Show n more". */
const PAGE = 40;

type Tab = 'kinds' | 'persons' | 'rels';

interface View {
    tab: Tab;
    exceptions: boolean;
    query: string;
    shown: number;
    diffsOpen: boolean;
}

/** The view of one comparison (the plan is built anew at every change). */
const views = new WeakMap<MergeState, View>();
let view: View | null = null;

function viewOf(state: MergeState): View {
    let v = views.get(state);
    if (!v) { v = { tab: 'kinds', exceptions: false, query: '', shown: PAGE, diffsOpen: false }; views.set(state, v); }
    view = v;
    return v;
}

// ==================== TEXTS ====================

export function ruleName(c: RuleChoice): string {
    const W = strings.mergeWizard;
    return { mine: W.rMine, import: W.rImport, both: W.rBoth, precise: W.rPrecise, each: W.rEach }[c];
}

function kindName(k: FieldKind): string {
    return strings.mergeWizard.kinds[FIELD_KINDS.indexOf(k)] ?? k;
}

function fieldLabel(field: string): string {
    if (field === 'marriage') return kindName('marriage');
    return (strings.mergeWizard.fieldNames as Record<string, string>)[field] ?? field;
}

function nameOf(p: Person | undefined): string {
    return p ? shownName(p, '?') : '?';
}

/** A value of a detail as it reads (a date in words, the sex by its name, a long note cut). */
function valueText(field: string, v: string): string {
    if (!v) return '—';
    if (field.endsWith('Date')) return formatFlexDate(v) || v;
    if (field === 'gender') return isGender(v) ? strings.gender[v] : v;
    if (field === 'notes') return v.length > 80 ? `${v.slice(0, 79)}…` : v;
    return v;
}

/** Where a result comes from ("whole merge: My tree wins", "Places: The import wins", …). */
export function sourceText(s: RuleSource, kind: FieldKind): string {
    const W = strings.mergeWizard;
    switch (s.level) {
        case 'value': return W.fromValue;
        case 'person': return W.fromPerson(ruleName(s.choice));
        case 'kind': return W.fromKind(kindName(kind), ruleName(s.choice));
        default: return W.fromAll(ruleName(s.choice));
    }
}

/** The pill of a protected value (the marks of reliability: Proven, Confirmed; the research's in words). */
function protectionMark(p: Protection): string {
    if (p === 'proven') return reliabilityHtml({ step: 'proven', dots: 1 }, strings.reliability.proven, { inert: true });
    if (p === 'human') return reliabilityHtml({ step: 'human' }, strings.reliability.titleHuman, { inert: true });
    return `<span class="merge-s4-research">${escapeHtml(strings.mergeWizard.protResearch)}</span>`;
}

/** A tile's example on one person ("Josef Modřín, Born: 1871 → 1872"). */
function exampleText(state: MergeState, ex: RuleExample | null): string {
    if (!ex) return '';
    const W = strings.mergeWizard;
    const p = nameOf(state.existingData.persons[ex.person]);
    const f = fieldLabel(ex.field);
    const a = valueText(ex.field, ex.before);
    const b = valueText(ex.field, ex.after);
    if (ex.result === 'import') return W.exChange(p, f, a, b);
    if (ex.result === 'both') return W.exSide(p, f, b);
    if (ex.result === 'walk') return '';
    return W.exStays(p, f, a);
}

/** A portrait of a "photo against photo" difference (moved here from the old conflict dialog). */
export function conflictPhotoHtml(v: string | undefined, initials: string, state: ImgState): string {
    const pending = state === 'loading' || state === 'refresh' || state === 'failed';
    const standIn = v ? pendingImageOf(v) : null;
    if (pending || standIn) {
        const shown = pending ? state : imageLoads.stateOfSha(standIn!.sha)?.state === 'pending' ? 'loading' : 'failed';
        return smallPortraitHtml('conflict-photo', v, initials, shown, strings.photos.failed) || '—';
    }
    if (v && v.startsWith('data:')) {
        return `<img class="conflict-photo" src="${escapeHtml(v)}" alt="${escapeHtml(strings.labels.photo)}">`;
    }
    return '—';
}

// ==================== DATA ====================

function rulesOf(ctx: StepContext): PlanRules {
    return ctx.choices.rules ?? { all: 'mine' };
}

/** Where the import's persons end by the plan (joined: the tree's id, added: 'new'). */
function planEnds(plan: MergePlan, state: MergeState): EndOf {
    const ends = new Map<PersonId, PersonId | 'new'>();
    for (const i of plan.items) {
        if (i.kind === 'person-join' && i.on) ends.set(i.id, i.target);
        else if (i.kind === 'person-add' && i.on && !i.ownTree) ends.set(i.id, 'new');
        else if (i.kind === 'skip' && i.standIn) ends.set(i.id, 'new');
    }
    return id => ends.get(id) ?? (state.incomingData.persons[id]?.isPlaceholder ? 'new' : undefined);
}

/** The plan's conflicts of relations with what each is about, and the choice that holds. */
function planRelations(plan: MergePlan, state: MergeState): Array<{ c: RelConflict; choice: RelChoice }> {
    const chosen = new Map<string, RelChoice>();
    for (const i of plan.items) if (i.kind === 'relation') chosen.set(i.key, i.choice);
    if (!chosen.size) return [];
    return relationConflicts(state, planEnds(plan, state), plan.scope === 'c' || plan.scope === 'd')
        .filter(c => chosen.has(c.key)).map(c => ({ c, choice: chosen.get(c.key)! }));
}

/** A difference is an exception when a narrower rule than the whole merge's decides it, or it is protected from it. */
function isException(d: FieldDifference, rules: PlanRules): boolean {
    const r = resolveField(d, rules);
    return r.source.level !== 'all' || !!r.held;
}

// ==================== RENDER ====================

export function renderStep4(host: HTMLElement, ctx: StepContext): void {
    const plan = ctx.plan;
    if (!plan) {
        host.innerHTML = stepHeading(4);
        return;
    }
    const v = viewOf(ctx.state);
    const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-fk]')?.dataset.fk;
    const scroll = host.querySelector<HTMLElement>('.merge-s4-panel')?.scrollTop ?? 0;
    const need = step4Need(plan);
    const rels = planRelations(plan, ctx.state);
    let html: string;
    if (need === 'skip') html = skippedHtml(ctx, v);
    else if (need === 'relations-only') {
        const W = strings.mergeWizard;
        const n = mergeDifferences(ctx.state).length;
        html = stepHeading(4)
            + `<div class="merge-s4 is-rels-only"><p class="merge-s4-note">${escapeHtml(W.step4Skipped(scopeLabel(plan), n))} ${escapeHtml(W.relOnly)}</p>`
            + `${relationsHtml(ctx, rels)}</div>`;
    } else html = fullHtml(ctx, v, rels);
    host.innerHTML = html;
    wire(host, ctx, v);
    const panel = host.querySelector<HTMLElement>('.merge-s4-panel');
    if (panel) panel.scrollTop = scroll;
    if (focusKey) host.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function scopeLabel(plan: MergePlan): string {
    const W = strings.mergeWizard;
    return plan.scope === 'b' ? W.scopeB : W.scopeA;
}

/** 7e: the step is skipped by the scope; the differences can be read. */
function skippedHtml(ctx: StepContext, v: View): string {
    const W = strings.mergeWizard;
    const diffs = mergeDifferences(ctx.state);
    const list = v.diffsOpen ? `<ul class="merge-s4-diffs">${diffs.map(d =>
        `<li><span class="merge-s4-pname">${escapeHtml(nameOf(ctx.state.existingData.persons[d.person]))}</span>, ${escapeHtml(fieldLabel(d.field))}: `
        + `<span class="tnum">${escapeHtml(valueText(d.field, d.before))} → ${escapeHtml(valueText(d.field, d.after))}</span></li>`).join('')}</ul>` : '';
    return stepHeading(4)
        + `<div class="merge-s4 is-skipped"><h4 class="merge-s4-skip-t">${escapeHtml(W.s4SkippedTitle)}</h4>`
        + `<p class="merge-s4-note">${escapeHtml(W.step4Skipped(scopeLabel(ctx.plan!), diffs.length))}`
        + (diffs.length && !v.diffsOpen ? ` <button type="button" class="link-button merge-s4-showdiffs" data-fk="showdiffs">${escapeHtml(W.showDiffs)}</button>` : '')
        + `</p>${list}<p class="merge-s4-note">${escapeHtml(W.noRelConf)}</p></div>`;
}

function fullHtml(ctx: StepContext, v: View, rels: Array<{ c: RelConflict; choice: RelChoice }>): string {
    const W = strings.mergeWizard;
    const { state } = ctx;
    const rules = rulesOf(ctx);
    const counts = ruleCounts(state, rules);
    const all = mergeDifferences(state);
    const diffs = all.filter(d => d.field !== 'marriage');
    const persons = personsOf(diffs);
    const tile = (c: RuleChoice): string => {
        const t = counts.tiles[c];
        const n = c === 'mine' ? `${W.rDefault} · ${W.rStays(t.stays)}`
            : c === 'import' || c === 'precise' ? W.rChanges(t.changes, t.protected)
            : c === 'both' ? W.rSide(t.side) : W.rWalk(t.walk);
        const ex = exampleText(state, t.example);
        return `<button type="button" class="sel-opt merge-s4-tile" data-sel-form="tile" role="radio" aria-checked="${rules.all === c}" data-rule="${c}" data-fk="rule-${c}">`
            + `<span class="merge-s4-tile-t">${escapeHtml(ruleName(c))}</span><span class="merge-s4-tile-n">${escapeHtml(n)}</span>`
            + (ex ? `<span class="merge-s4-tile-ex">${escapeHtml(ex)}</span>` : '') + '</button>';
    };
    const marks = [...new Set(all.flatMap(d => d.protection ? [d.protection] : []))];
    const prot = counts.protected > 0
        ? `<p class="merge-s4-prot"><span>${escapeHtml(W.protectedLine(counts.protected))}</span> ${marks.map(protectionMark).join(' ')} `
            + `<button type="button" class="link-button merge-s4-protshow" data-fk="protshow">${escapeHtml(W.s4Show)}</button></p>` : '';
    const tab = (t: Tab, label: string, n?: number): string =>
        `<button type="button" class="merge-tab sel-tab" role="tab" data-sel-dir="down" data-tab="${t}" id="merge-s4-tab-${t}" aria-controls="merge-s4-${t}" aria-selected="${v.tab === t}" tabindex="${v.tab === t ? 0 : -1}" data-fk="tab-${t}">`
        + `<span class="merge-tab-label">${escapeHtml(label)}</span>${n !== undefined ? ` <span class="cnt">${n.toLocaleString()}</span>` : ''}</button>`;
    let panel: string;
    if (v.tab === 'kinds') panel = kindsHtml(counts.byKind, rules);
    else if (v.tab === 'persons') panel = personsHtml(ctx, v, diffs, persons, rules);
    else panel = relationsHtml(ctx, rels);
    return stepHeading(4)
        + `<div class="merge-s4">`
        + `<div class="merge-s4-head"><span class="merge-s4-h" id="merge-s4-all-l">${escapeHtml(W.ruleAll)}</span><span class="merge-s4-order">${escapeHtml(W.ruleOrder)}</span></div>`
        + `<div class="merge-s4-tiles" role="radiogroup" aria-labelledby="merge-s4-all-l">${RULES.map(tile).join('')}</div>`
        + prot
        + `<div class="merge-s4-bar"><div class="merge-s4-tabs" role="tablist">${tab('kinds', W.byKind)}${tab('persons', W.byPerson, persons.length)}${tab('rels', W.relConf, rels.length)}</div>`
        + `<input type="search" class="merge-s4-search" placeholder="${escapeHtml(W.s4Search)}" aria-label="${escapeHtml(W.s4Search)}" value="${escapeHtml(v.query)}" data-fk="search"></div>`
        + `<div class="merge-s4-panel" role="tabpanel" id="merge-s4-${v.tab}" aria-labelledby="merge-s4-tab-${v.tab}">${panel}</div>`
        + `</div>`;
}

type PersonRow = { person: PersonId; source: PersonId; diffs: FieldDifference[] };

/** The tree's persons with differences, in the import's order. */
function personsOf(diffs: readonly FieldDifference[]): PersonRow[] {
    const out = new Map<PersonId, PersonRow>();
    for (const d of diffs) {
        let row = out.get(d.person);
        if (!row) { row = { person: d.person, source: d.source, diffs: [] }; out.set(d.person, row); }
        row.diffs.push(d);
    }
    return [...out.values()];
}

function ruleSelect(attrs: string, current: RuleChoice | undefined, inherit: string, label: string): string {
    return `<select class="merge-s4-select" ${attrs} aria-label="${escapeHtml(label)}">`
        + `<option value=""${current ? '' : ' selected'}>${escapeHtml(inherit)}</option>`
        + RULES.map(c => `<option value="${c}"${current === c ? ' selected' : ''}>${escapeHtml(ruleName(c))}</option>`).join('')
        + '</select>';
}

/** By kind of detail: nine rows with the count, where the rule comes from, and the rule. */
function kindsHtml(byKind: ReturnType<typeof ruleCounts>['byKind'], rules: PlanRules): string {
    const W = strings.mergeWizard;
    return `<div class="merge-s4-kinds">${FIELD_KINDS.map(k => {
        const own = rules.kind?.[k];
        const from = own ? `<span class="merge-s4-from is-own">${escapeHtml(W.ownRule)}</span>` : `<span class="merge-s4-from">${escapeHtml(W.fromAll(ruleName(rules.all)))}</span>`;
        return `<div class="merge-s4-krow" data-kind="${k}"><span class="merge-s4-kname">${escapeHtml(kindName(k))}</span>`
            + `<span class="merge-s4-kcount">${byKind[k].differences.toLocaleString()}</span>${from}`
            + ruleSelect(`data-kind="${k}" data-fk="kind-${k}"`, own, W.fromAll(ruleName(rules.all)), kindName(k)) + '</div>';
    }).join('')}</div>`;
}

/** By person (7b): each person's differences, the result and where it comes from; the person's own rule. */
function personsHtml(ctx: StepContext, v: View, diffs: readonly FieldDifference[], persons: PersonRow[], rules: PlanRules): string {
    const W = strings.mergeWizard;
    const { state } = ctx;
    if (!diffs.length) return `<p class="merge-s4-note">${escapeHtml(W.s4NoDiffs)}</p>`;
    const exceptions = persons.filter(p => p.diffs.some(d => isException(d, rules)));
    const q = v.query.trim().toLocaleLowerCase();
    let shown = v.exceptions ? exceptions : persons;
    if (q) shown = shown.filter(p => nameOf(state.existingData.persons[p.person]).toLocaleLowerCase().includes(q));
    const head = `<div class="merge-s4-phead"><span class="merge-s4-pcount">${escapeHtml(W.personsWithDiffs(persons.length))}</span>`
        + `<div class="sel-seg" role="radiogroup" aria-label="${escapeHtml(W.byPerson)}">`
        + `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="${!v.exceptions}" data-filter="all" data-fk="f-all">${escapeHtml(W.fAllPersons)}</button>`
        + `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="${v.exceptions}" data-filter="exceptions" data-fk="f-exc">${escapeHtml(W.fExceptions(exceptions.length))}</button>`
        + '</div></div>';
    const cards = shown.slice(0, v.shown).map(p => personHtml(ctx, p, rules)).join('');
    const more = shown.length > v.shown
        ? `<button type="button" class="link-button merge-s4-more" data-fk="more">${escapeHtml(W.s4More(Math.min(PAGE, shown.length - v.shown)))}</button>` : '';
    return head + (shown.length ? cards : `<p class="merge-s4-note">${escapeHtml(W.s4NoHit)}</p>`) + more;
}

function personHtml(ctx: StepContext, p: PersonRow, rules: PlanRules): string {
    const W = strings.mergeWizard;
    const { state } = ctx;
    const target = ctx.choices.targetName;
    const tree = state.existingData.persons[p.person];
    const inc = state.incomingData.persons[p.source];
    const name = nameOf(tree);
    const rows = p.diffs.map(d => {
        const r = resolveField(d, rules);
        const key = `${d.person}|${d.field}`;
        const value = rules.value?.[key];
        const photo = d.field === 'photo';
        const mineHtml = photo
            ? conflictPhotoHtml(tree?.photo, tree ? personInitials(tree.firstName, tree.lastName) : '', imgStateOf(personPhotoKey(d.person), !!tree?.photo))
            : escapeHtml(valueText(d.field, d.before)) + (d.protection ? ` ${protectionMark(d.protection)}` : '');
        const theirsHtml = photo
            ? conflictPhotoHtml(inc?.photo, inc ? personInitials(inc.firstName, inc.lastName) : '', 'none')
            : escapeHtml(valueText(d.field, d.after));
        const before = valueText(d.field, d.before);
        const after = valueText(d.field, d.after);
        let result: string;
        if (r.result === 'import') result = photo ? W.colImport : after;
        else if (r.result === 'both') result = photo ? W.resBothPhoto : `${before} + ${W.importSays(after)}`;
        else if (r.result === 'walk') result = '—';
        else result = photo ? target : W.resStays(before);
        const from = r.held ? W.heldBy(W.protKinds[d.protection!]) : r.result === 'walk' ? W.resWalk : sourceText(r.source, d.kind);
        return `<div class="merge-s4-row" data-person="${escapeHtml(d.person)}" data-field="${escapeHtml(d.field)}">`
            + `<span class="merge-s4-k">${escapeHtml(fieldLabel(d.field))}</span>`
            + `<button type="button" class="merge-s4-v" data-pick="mine" data-col="${escapeHtml(target)}" aria-pressed="${value === 'mine'}" data-fk="v-${escapeHtml(key)}-mine">${mineHtml}</button>`
            + `<button type="button" class="merge-s4-v" data-pick="import" data-col="${escapeHtml(W.colImport)}" aria-pressed="${value === 'import'}" data-fk="v-${escapeHtml(key)}-import">${theirsHtml}</button>`
            + `<span class="merge-s4-res"><span class="merge-s4-res-v">${escapeHtml(result)}</span>`
            + `<span class="merge-s4-res-from${r.result === 'walk' ? ' is-walk' : ''}">${escapeHtml(from)}</span></span></div>`;
    }).join('');
    const own = rules.person?.[p.person];
    const seg = ([['', W.byRules], ['mine', W.rMine], ['import', W.rImport], ['both', W.rBoth]] as const).map(([c, label]) =>
        `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="${(own ?? '') === c}" data-prule="${c}" data-fk="pr-${escapeHtml(p.person)}-${c || 'rules'}">${escapeHtml(label)}</button>`).join('');
    return `<section class="merge-s4-person" data-person="${escapeHtml(p.person)}" aria-label="${escapeHtml(name)}">`
        + `<div class="merge-s4-grid"><div class="merge-s4-row merge-s4-hrow" aria-hidden="true"><span class="merge-s4-pname" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`
        + `<span title="${escapeHtml(target)}">${escapeHtml(target)}</span><span>${escapeHtml(W.colImport)}</span><span>${escapeHtml(W.resultFrom)}</span></div>`
        + `<h4 class="merge-s4-pname merge-s4-ptitle">${escapeHtml(name)}</h4>${rows}</div>`
        + `<div class="merge-s4-pwhole"><span class="merge-s4-pwhole-l">${escapeHtml(W.personWhole(name))}</span>`
        + `<div class="sel-seg" role="radiogroup" aria-label="${escapeHtml(W.personWhole(name))}">${seg}</div></div></section>`;
}

/** The names (or the marriage's details) on one side of a conflict of relations. */
function relSide(ctx: StepContext, c: RelConflict, side: 'mine' | 'theirs'): string {
    const W = strings.mergeWizard;
    const { state } = ctx;
    const tree = (id: PersonId): string => nameOf(state.existingData.persons[id]);
    const src = (id: PersonId): string => nameOf(state.incomingData.persons[id]);
    if (c.kind === 'loop') {
        return side === 'mine' ? W.loopMine(tree(c.mine[0]), tree(c.person)) : W.loopTheirs(src(c.theirs[0]), tree(c.person));
    }
    if (c.kind === 'marriage') {
        const status = (v: string): string => v in strings.partnershipStatus ? strings.partnershipStatus[v as PartnershipStatus] : v;
        return c.fields.map(f => {
            const v = side === 'mine' ? f.mine : f.theirs;
            const shown = f.field === 'status' ? status(v) : f.field === 'startDate' || f.field === 'endDate' ? formatFlexDate(v) || v : v;
            return `${strings.merge.partnershipFields[f.field]}: ${shown || '—'}`;
        }).join(', ');
    }
    const names = side === 'mine' ? c.mine.map(tree) : c.theirs.map(src);
    return names.join(c.kind === 'partner' ? ', ' : ' + ') || '—';
}

/** 7d: the conflicts of relations, each with Keep mine · From the import · Both; a loop only Keep mine. */
function relationsHtml(ctx: StepContext, rels: Array<{ c: RelConflict; choice: RelChoice }>): string {
    const W = strings.mergeWizard;
    const { state } = ctx;
    const q = (view?.query ?? '').trim().toLocaleLowerCase();
    const title = (c: RelConflict): string => c.kind === 'loop'
        ? `${nameOf(state.existingData.persons[c.mine[0]])} ↔ ${nameOf(state.existingData.persons[c.person])}`
        : nameOf(state.existingData.persons[c.person]);
    const shown = q ? rels.filter(r => title(r.c).toLocaleLowerCase().includes(q)) : rels;
    const label: Record<RelChoice, string> = { mine: W.keepMine, import: W.fromImport, both: W.both };
    const rows = shown.map(({ c, choice }) => {
        const seg = c.options.map(o => `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="${choice === o}" data-rel="${escapeHtml(c.key)}" data-choice="${o}" data-fk="rel-${escapeHtml(c.key)}-${o}">${escapeHtml(label[o])}</button>`).join('');
        return `<div class="merge-s4-rel" data-rel-kind="${c.kind}" data-key="${escapeHtml(c.key)}">`
            + `<div class="merge-s4-rel-h"><span class="merge-s4-pname">${escapeHtml(title(c))}</span><span class="merge-s4-tag">${escapeHtml(W.relKinds[c.kind])}</span>`
            + (c.kind === 'loop' ? `<span class="merge-s4-loop">${escapeHtml(W.loopNever)}</span>` : '') + '</div>'
            + `<div class="merge-s4-rel-sides"><span><span class="merge-s4-side">${escapeHtml(ctx.choices.targetName)}:</span> ${escapeHtml(relSide(ctx, c, 'mine'))}</span>`
            + `<span><span class="merge-s4-side">${escapeHtml(W.colImport)}:</span> ${escapeHtml(relSide(ctx, c, 'theirs'))}</span></div>`
            + `<div class="sel-seg" role="radiogroup" aria-label="${escapeHtml(`${title(c)} · ${W.relKinds[c.kind]}`)}">${seg}</div></div>`;
    }).join('');
    return `<div class="merge-s4-rels"><p class="merge-s4-rels-h"><span class="merge-s4-h">${escapeHtml(W.relConf)}</span> <span class="merge-s4-note">${escapeHtml(W.relAlways)}</span></p>`
        + (rels.length ? (shown.length ? rows : `<p class="merge-s4-note">${escapeHtml(W.s4NoHit)}</p>`) : `<p class="merge-s4-note">${escapeHtml(W.relNone)}</p>`) + '</div>';
}

// ==================== EVENTS ====================

function setRules(ctx: StepContext, change: (r: PlanRules) => void): void {
    const r = rulesOf(ctx);
    const next: PlanRules = {
        all: r.all,
        ...(r.kind ? { kind: { ...r.kind } } : {}),
        ...(r.person ? { person: { ...r.person } } : {}),
        ...(r.value ? { value: { ...r.value } } : {}),
    };
    change(next);
    ctx.update({ rules: next });
}

function wire(host: HTMLElement, ctx: StepContext, v: View): void {
    const root = host.querySelector<HTMLElement>('.merge-s4');
    if (!root) return;
    root.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button');
        if (!b) return;
        if (b.classList.contains('merge-s4-showdiffs')) { v.diffsOpen = true; renderStep4(host, ctx); return; }
        if (b.dataset.rule) { const c = b.dataset.rule as RuleChoice; setRules(ctx, r => { r.all = c; }); return; }
        if (b.dataset.tab) { v.tab = b.dataset.tab as Tab; renderStep4(host, ctx); return; }
        if (b.classList.contains('merge-s4-protshow')) { v.tab = 'persons'; v.exceptions = true; v.shown = PAGE; renderStep4(host, ctx); return; }
        if (b.dataset.filter) { v.exceptions = b.dataset.filter === 'exceptions'; v.shown = PAGE; renderStep4(host, ctx); return; }
        if (b.classList.contains('merge-s4-more')) { v.shown += PAGE; renderStep4(host, ctx); return; }
        if (b.dataset.prule !== undefined) {
            const person = b.closest<HTMLElement>('.merge-s4-person')?.dataset.person;
            if (!person) return;
            const c = b.dataset.prule as RuleChoice | '';
            setRules(ctx, r => {
                if (c) r.person = { ...r.person, [person]: c };
                else if (r.person) { delete r.person[person]; if (!Object.keys(r.person).length) delete r.person; }
            });
            return;
        }
        if (b.dataset.pick) { pickValue(ctx, b); return; }
        if (b.dataset.rel) {
            ctx.update({ relations: { ...ctx.choices.relations, [b.dataset.rel]: b.dataset.choice as RelChoice } });
        }
    });
    root.addEventListener('change', e => {
        const s = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-kind]');
        if (!s) return;
        const k = s.dataset.kind as FieldKind;
        setRules(ctx, r => {
            if (s.value) r.kind = { ...r.kind, [k]: s.value as RuleChoice };
            else if (r.kind) { delete r.kind[k]; if (!Object.keys(r.kind).length) delete r.kind; }
        });
    });
    root.querySelector<HTMLElement>('.merge-s4-tabs')?.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const order: Tab[] = ['kinds', 'persons', 'rels'];
        const i = order.indexOf(v.tab);
        v.tab = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
        renderStep4(host, ctx);
        host.querySelector<HTMLElement>(`#merge-s4-tab-${v.tab}`)?.focus();
    });
    const search = root.querySelector<HTMLInputElement>('.merge-s4-search');
    search?.addEventListener('input', () => {
        v.query = search.value;
        v.shown = PAGE;
        if (v.tab === 'kinds') v.tab = 'persons';
        renderStep4(host, ctx);
        const again = host.querySelector<HTMLInputElement>('.merge-s4-search');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
}

/** A click on a value chooses it for that one detail; a click on the chosen one gives it back to the rules. A protected value asks first (7c). */
function pickValue(ctx: StepContext, b: HTMLElement): void {
    const row = b.closest<HTMLElement>('.merge-s4-row');
    const person = row?.dataset.person as PersonId | undefined;
    const field = row?.dataset.field;
    if (!person || !field) return;
    const key = `${person}|${field}`;
    const pick = b.dataset.pick as 'mine' | 'import';
    const set = (c: RuleChoice | null): void => setRules(ctx, r => {
        if (c) r.value = { ...r.value, [key]: c };
        else if (r.value) { delete r.value[key]; if (!Object.keys(r.value).length) delete r.value; }
    });
    if (rulesOf(ctx).value?.[key] === pick) { set(null); return; }
    const d = mergeDifferences(ctx.state).find(x => x.person === person && x.field === field);
    if (pick === 'import' && d?.protection) { openProtected(ctx, d, () => set('import'), () => set('mine')); return; }
    set(pick);
}

// ==================== 7c: A PROTECTED VALUE CHANGED ONE BY ONE ====================

let returnFocus: HTMLElement | null = null;

function closeDialog(overlay: HTMLElement): void {
    overlay.classList.remove('active');
    overlay.remove();
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) back.focus();
}

function openProtected(ctx: StepContext, d: FieldDifference, use: () => void, keep: () => void): void {
    const W = strings.mergeWizard;
    const { state } = ctx;
    const tree = state.existingData.persons[d.person];
    const v = valueText(d.field, d.before);
    const w = valueText(d.field, d.after);
    const src = (tree?.sourceIds ?? []).map(id => state.existingData.sources?.[id]?.title).find(Boolean) ?? W.protMarked(W.protKinds[d.protection!]);
    const html = `<div class="modal-header"><h2 id="merge-s4-prot-t">${escapeHtml(W.protTitle)}</h2></div>`
        + `<p class="merge-s4-prot-text">${escapeHtml(W.protText(nameOf(tree), fieldLabel(d.field), v, src, w))} ${protectionMark(d.protection!)}</p>`
        + `<p class="merge-s4-note">${escapeHtml(W.protAfter)}</p>`
        + `<div class="buttons"><button type="button" class="secondary" data-act="keep">${escapeHtml(W.keepV(v))}</button>`
        + `<button type="button" class="primary" data-act="use">${escapeHtml(W.useV(w))}</button></div>`;
    document.getElementById('merge-s4-prot')?.remove();
    returnFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    // merge-s3-dialog: above the guide and closed by Esc, like step 3's dialogs.
    overlay.className = 'modal-overlay merge-s3-dialog';
    overlay.id = 'merge-s4-prot';
    overlay.innerHTML = `<div class="modal modal--sm" role="dialog" aria-modal="true" aria-labelledby="merge-s4-prot-t" data-dialog-kind="decision">${html}</div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(overlay); });
    overlay.querySelector('[data-act="keep"]')!.addEventListener('click', () => { closeDialog(overlay); keep(); });
    overlay.querySelector('[data-act="use"]')!.addEventListener('click', () => { closeDialog(overlay); use(); });
    document.body.appendChild(overlay);
    overlay.classList.add('active');
    overlay.querySelector<HTMLElement>('[data-act="keep"]')?.focus();
}
