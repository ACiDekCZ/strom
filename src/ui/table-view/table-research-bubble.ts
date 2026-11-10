/**
 * The content of a research bubble in the Table view (spec 073 §16.4,
 * screens 16j–16m, 16w, 16y, 16zf, 16zl): the head (name, research id) and
 * the sections of one research cell, or of all of them for the summary
 * column (the most urgent first, materials last), or the conflicts behind a
 * ≠ of a fact's cell.
 *
 * Each action names what it does (`id`), how it runs (`via`) and its mark,
 * taken only from the research links' map (`researchLinkMark`) for an
 * action that goes by a research link; an action that stays in the app,
 * goes through the bridge or opens the web has none of the research's marks
 * (`mark: null`), and a waiting item's answer is the waiting panel's own
 * control, which draws the item's mark itself. A read-only copy has no
 * actions and says why (`note`).
 *
 * Pure: reads the research environment of the table (researchTableEnv), no DOM.
 */

import type { Person, PersonId, ResearchBranch, ResearchConflict, ResearchConflictValue, ResearchHypothesis } from '../../types.js';
import { researchLinkMark, type ResearchActionMark, type ResearchLinkAction, type ResearchLinkParams, type LiveWaiting } from '../../research-link.js';
import { isOpenHypothesis } from '../../view-links.js';
import { personStoryState } from '../../card-signals.js';
import { revertAvailability, wasRowModel } from '../../origin-was.js';
import { shownName } from '../../person-name.js';
import { strings } from '../../strings.js';
import type { ResearchSignal } from './table-model.js';
import {
    personLineRole, researchBranchName, researchCell, researchConflictWhat, researchDayText, researchExternalWaits,
    researchLineCounts, researchOpenConflicts, researchOriginItems, type PersonLineRole, type ResearchColumnId, type ResearchTableEnv,
} from './table-research.js';

// ==================== TYPES ====================

/** The sections of §16.4 (`info`: a research column without its own section, its cell in words). */
export type ResearchBubbleSectionId = 'wait' | 'conf' | 'hyp' | 'agent' | 'tasks' | 'mat' | 'line' | 'orig' | 'avail' | 'info';

/**
 * What an action does (the table's UI runs it):
 * - `waitAnswer`: a waiting item's answer, as the panel Awaiting decision answers it (`waitId`);
 * - `storyCompare`: compare the story's versions (`personId`);
 * - `waitingPanel`: the panel Awaiting decision;
 * - `decide`: the dialog What the research knows on the conflict (`personId`, `conflictId`);
 * - `knows`: the dialog What the research knows on its questions (`personId`);
 * - `reviewHypothesis`: the research's link `hypothesis` (`hypothesisId`; `link`);
 * - `follow`: follow the research live (`link` live);
 * - `openTask`: the research's link `task` of a queued task (`taskId`; `link`);
 * - `materials`: the person's materials (`personId`);
 * - `showLine`: the Family view with the line or side branch highlighted (`lineId` / `branchId`);
 * - `changeInResearch`: the research's overview on the line (`lineId`);
 * - `revert`: put the family tree's value back (`fact` = the key in researchOrigins), through the bridge;
 * - `source`: the source in the Sources table (`sourceId`);
 * - `archive`: the archive's website in a new window (`url`).
 */
export type ResearchBubbleActionId =
    | 'waitAnswer' | 'storyCompare' | 'waitingPanel' | 'decide' | 'knows' | 'reviewHypothesis' | 'follow' | 'openTask'
    | 'materials' | 'showLine' | 'changeInResearch' | 'revert' | 'source' | 'archive';

/**
 * How an action runs: `app` stays in the app, `link` launches a research link (`link`), `bridge` asks the
 * research's bridge, `web` opens a website in a new window (`url`; drawn with ↗), `item` is the waiting
 * panel's own control of the item (its mark is the item's).
 */
export type ResearchBubbleVia = 'app' | 'link' | 'bridge' | 'web' | 'item';

export interface ResearchBubbleAction {
    id: ResearchBubbleActionId;
    label: string;
    via: ResearchBubbleVia;
    /** The research link's mark from the map (`link` only); null: no mark of the research's actions. */
    mark: ResearchActionMark | null;
    /** `link`: the research link to launch (the tree's id is added by the UI). */
    link?: { action: ResearchLinkAction; params: Omit<ResearchLinkParams, 'tree'> };
    /** `web`: the address (http/https only). */
    url?: string;
    /** The person the action is about (a conflict of a partner: the partner). */
    personId: PersonId;
    waitId?: string;
    conflictId?: string;
    hypothesisId?: string;
    taskId?: string;
    lineId?: string;
    branchId?: string;
    fact?: string;
    sourceId?: string;
}

/** One item of a section: its title, the lines under it (lighter) and its own actions. */
export interface ResearchBubbleItem {
    title: string;
    /** The item's id at the research (T…, X…, H…), shown light. */
    ref?: string;
    lines: string[];
    actions: ResearchBubbleAction[];
    /** A sent item waiting for a reply from outside (§16.10 item 5): information only. */
    fromOutside?: boolean;
}

export interface ResearchBubbleSection {
    id: ResearchBubbleSectionId;
    title: string;
    /** The research mark at the title (as the cell's). */
    signal?: ResearchSignal;
    items: ResearchBubbleItem[];
    /** The section's own actions under its items ("Awaiting decision ›", "Follow the research ›"). */
    actions: ResearchBubbleAction[];
}

export interface ResearchBubble {
    personId: PersonId;
    name: string;
    refn: string;
    sections: ResearchBubbleSection[];
    /** A read-only copy: no actions, the note says so (`table.res.roNote`). */
    readOnly: boolean;
    note?: string;
}

/** What the UI knows beyond the environment. */
export interface ResearchBubbleCaps {
    /** On a computer (not a phone or a tablet): the value can be put back only there. */
    onComputer?: boolean;
    /** The research's bridge answers now (the revert goes through it). */
    bridgeLive?: boolean;
}

/** The order of the summary bubble (§16.4): the most urgent first, materials last. */
export const RESEARCH_BUBBLE_ORDER: readonly ResearchBubbleSectionId[] = ['wait', 'conf', 'hyp', 'agent', 'tasks', 'line', 'orig', 'avail', 'mat'];

/** The section of each research column with its own one; any other column shows its cell in words (`info`). */
const COLUMN_SECTION: Partial<Record<ResearchColumnId, ResearchBubbleSectionId>> = {
    rWait: 'wait', rConf: 'conf', rHyp: 'hyp', rTasks: 'tasks', rAgent: 'agent', rMat: 'mat', rLine: 'line', rOrig: 'orig', rAvail: 'avail',
};

// ==================== HELPERS ====================

const B = () => strings.table.res.bub;

/** The research's own actions are offered only in a research tree that is not a read-only copy. */
const dataOnly = (env: ResearchTableEnv): boolean => env.input.kind !== 'research' || !!env.input.readOnly;

function appAction(id: ResearchBubbleActionId, label: string, personId: PersonId, more: Partial<ResearchBubbleAction> = {}): ResearchBubbleAction {
    return { id, label, via: 'app', mark: null, personId, ...more };
}

function linkAction(
    id: ResearchBubbleActionId, label: string, personId: PersonId, action: ResearchLinkAction,
    params: Omit<ResearchLinkParams, 'tree'>, more: Partial<ResearchBubbleAction> = {},
): ResearchBubbleAction {
    const mark = researchLinkMark(action, {
        ...(params.taskDo ? { taskDo: params.taskDo } : {}),
        ...(params.conflictDo ? { conflictDo: params.conflictDo } : {}),
        ...(params.experimentDo ? { experimentDo: params.experimentDo } : {}),
    });
    return { id, label, via: 'link', mark, link: { action, params }, personId, ...more };
}

const capital = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

const webUrl = (url: string | undefined): string | undefined => url && /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;

/** A source in words: its research id and title. */
function sourceText(env: ResearchTableEnv, id: string): string {
    const s = env.data.sources?.[id];
    if (!s) return '';
    return [s.refn, s.title].filter(Boolean).join(' ');
}

// ==================== SECTIONS ====================

function waitSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    if (dataOnly(env)) return null;
    const R = B();
    const todo: LiveWaiting[] = p.refn ? env.todo.get(p.refn) ?? [] : [];
    const items: ResearchBubbleItem[] = [];
    let story = false;
    for (const w of todo) {
        const since = researchDayText(w.at);
        if (w.kind === 'story') {
            if (story) continue;
            story = true;
            items.push({ title: R.storyNew, lines: since ? [R.since(since)] : [], actions: [appAction('storyCompare', R.compare, p.id)] });
            continue;
        }
        items.push({
            title: w.what, ref: w.id, lines: since ? [R.since(since)] : [],
            actions: [{ id: 'waitAnswer', label: strings.live.waitingTask.answer, via: 'item', mark: null, personId: p.id, waitId: w.id }],
        });
    }
    // A new version of an approved story the file has, while no waiting item says it.
    if (!story && personStoryState(p, env.data)?.storyNew) {
        items.push({ title: R.storyNew, lines: [], actions: [appAction('storyCompare', R.compare, p.id)] });
    }
    const todoCount = items.length;
    for (const ext of researchExternalWaits(env, p)) {
        items.push({ title: strings.table.res.external(ext.text), ref: ext.id, lines: [], actions: [], fromOutside: true });
    }
    if (items.length === 0) return null;
    return {
        id: 'wait', title: todoCount > 0 ? R.waitTitle(todoCount) : R.externalTitle, signal: todoCount > 0 ? 'wait' : 'ext', items,
        actions: todo.length > 0 ? [appAction('waitingPanel', R.waitingPanel, p.id)] : [],
    };
}

/** A conflict's value in words: the value, then whose it is or its source. */
function conflictValueText(env: ResearchTableEnv, v: ResearchConflictValue): string {
    const R = B();
    const by = v.side === 'user' ? R.sideApp
        : (v.sourceIds ?? []).map(id => sourceText(env, id)).find(Boolean) ?? (v.side === 'research' ? R.sideResearch : '');
    return [v.value, by].filter(Boolean).join(' · ');
}

function conflictItem(env: ResearchTableEnv, owner: Person, c: ResearchConflict, own: boolean): ResearchBubbleItem {
    const title = c.title?.trim() || capital(researchConflictWhat(c));
    return {
        title: own ? title : `${title} (${shownName(owner)})`, ref: c.id,
        lines: c.values.map(v => conflictValueText(env, v)).filter(Boolean),
        actions: [appAction('decide', B().decide, owner.id, { conflictId: c.id })],
    };
}

function confSection(env: ResearchTableEnv, rowPerson: Person, list: readonly { person: Person; conflict: ResearchConflict }[]): ResearchBubbleSection | null {
    if (list.length === 0) return null;
    return {
        id: 'conf', title: B().confTitle(list.length), signal: 'conf',
        items: list.map(x => conflictItem(env, x.person, x.conflict, x.person.id === rowPerson.id)), actions: [],
    };
}

function hypSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    const R = B();
    const all: ResearchHypothesis[] = p.research?.hypotheses ?? [];
    const open = all.filter(isOpenHypothesis);
    const byAgent = all.filter(h => h.decidedBy === 'agent' && h.status === 'decided');
    const question = p.question?.trim() ?? '';
    if (open.length === 0 && byAgent.length === 0 && !question) return null;
    const items: ResearchBubbleItem[] = open.map(h => ({ title: h.title, ...(h.id ? { ref: h.id } : {}), lines: [], actions: [] }));
    if (question) items.push({ title: question, lines: [R.question], actions: [] });
    for (const h of byAgent) {
        const how = [h.chosen ? R.variant(h.chosen) : '', h.decision?.trim() ?? ''].filter(Boolean).join(': ');
        items.push({
            title: h.title, ...(h.id ? { ref: h.id } : {}), lines: [R.agentDecided(researchDayText(h.decidedAt), how)],
            actions: h.id && !dataOnly(env)
                ? [linkAction('reviewHypothesis', R.review, p.id, 'hypothesis', { hypothesis: h.id, hypothesisDo: 'decide' }, { hypothesisId: h.id })]
                : [],
        });
    }
    const title = open.length > 0 || byAgent.length > 0 ? R.hypTitle(open.length) : R.questionTitle;
    return { id: 'hyp', title, signal: open.length > 0 || question ? 'q' : undefined, items, actions: [appAction('knows', R.knows, p.id)] };
}

/** The line a person stands in, in words ("G0001 Ancestors of …"), for the agent's section. */
function lineName(role: PersonLineRole | null): string {
    return role?.kind === 'line' ? `${role.line.id} ${role.line.name}` : '';
}

function agentSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    if (dataOnly(env) || !env.input.live || !p.refn || !env.working.has(p.refn)) return null;
    const R = B();
    const worker = env.input.working?.find(w => w.person === p.refn && !w.paused);
    const since = researchDayText(worker?.since);
    const line = lineName(personLineRole(env.lines, p))
        || (worker?.research ? env.lines.lines.find(l => l.id === worker.research)?.name ?? '' : '');
    const meta = [since ? R.since(since) : '', line ? R.line(line) : ''].filter(Boolean).join(' · ');
    return {
        id: 'agent', title: R.agentTitle, signal: 'agent',
        items: [{ title: env.working.get(p.refn) || R.agentWorking, lines: meta ? [meta] : [], actions: [] }],
        actions: [linkAction('follow', R.follow, p.id, 'live', {})],
    };
}

function tasksSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    if (dataOnly(env) || !env.input.live || !p.refn) return null;
    const R = B();
    const items: ResearchBubbleItem[] = [];
    let pos = 0;
    for (const q of env.input.queue ?? []) {
        if (q.state !== 'next') continue;
        pos++;
        if (q.person !== p.refn) continue;
        items.push({
            title: R.queued(pos, q.text), ...(q.id ? { ref: q.id } : {}), lines: [],
            actions: q.id ? [linkAction('openTask', R.openTask, p.id, 'task', { task: q.id }, { taskId: q.id })] : [],
        });
    }
    if (items.length === 0) return null;
    return { id: 'tasks', title: R.tasksTitle(items.length), items, actions: [linkAction('follow', R.follow, p.id, 'live', {})] };
}

function matSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    const n = env.input.materialsOf?.(p);
    if (!n) return null;
    const R = B();
    return { id: 'mat', title: R.matTitle(n), items: [], actions: [appAction('materials', R.materials, p.id)] };
}

/** The people of a side branch (by its id among the places). */
function branchCount(env: ResearchTableEnv, id: string): number {
    let n = 0;
    for (const q of Object.values(env.data.persons)) {
        if (!q.isPlaceholder && env.lines.placesOf(q.refn).some(x => x.role === 'branch' && x.branch === id)) n++;
    }
    return n;
}

/** The partners of a person who stand in the line themselves (why a partner is in it). */
function linePartners(env: ResearchTableEnv, p: Person, lineId: string): string[] {
    const names: string[] = [];
    for (const u of Object.values(env.data.partnerships)) {
        const other = u.person1Id === p.id ? u.person2Id : u.person2Id === p.id ? u.person1Id : null;
        const q = other ? env.data.persons[other] : undefined;
        if (!q) continue;
        const role = personLineRole(env.lines, q);
        if (role?.kind === 'line' && role.line.id === lineId && !role.partner) names.push(shownName(q));
    }
    return names;
}

function branchItem(env: ResearchTableEnv, branch: ResearchBranch | undefined, branchId: string | undefined): ResearchBubbleItem {
    const R = B();
    const id = branch?.id ?? branchId ?? '';
    const lines: string[] = [];
    const from = branch?.line ?? branch?.nearest;
    const via = branch?.via ? env.byRefn.get(branch.via.person) : undefined;
    lines.push([R.people(id ? branchCount(env, id) : 0), from ? R.branchFrom(from, via ? shownName(via) : '') : ''].filter(Boolean).join(' · '));
    if (branch?.mode) lines.push(R.branchMode(strings.live.offMode[branch.mode] ?? branch.mode));
    return { title: capital(strings.table.res.branch(researchBranchName(env, branch, branchId))), lines, actions: [] };
}

function lineSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    const role = personLineRole(env.lines, p);
    if (!role) return null;
    const R = B();
    const live = !dataOnly(env) && env.input.live;
    if (role.kind === 'line') {
        const { line } = role;
        const focus = line.focus ? env.byRefn.get(line.focus) : undefined;
        const count = researchLineCounts(env, Object.values(env.data.persons)).lines.find(x => x.line.id === line.id)?.count ?? 0;
        const meta = [focus ? R.focus(shownName(focus)) : '', line.kind ? R.lineKinds[line.kind] : '', R.withPartners(count)].filter(Boolean).join(' · ');
        const lines = [meta];
        if (line.state && line.state !== 'active') lines.push(R.lineStates[line.state]);
        if (role.partner) {
            const of = linePartners(env, p, line.id);
            lines.push(R.partnerWhy(shownName(p), of.join(', '), p.gender === 'female'));
        }
        const items: ResearchBubbleItem[] = [{ title: `${line.id} ${line.name}`, lines, actions: [] }];
        if (role.branch) items.push(branchItem(env, role.branch, role.branch.id));
        const actions = [appAction('showLine', strings.table.res.showLine, p.id, { lineId: line.id })];
        if (live) actions.push(appAction('changeInResearch', strings.table.res.changeInResearch, p.id, { lineId: line.id }));
        return { id: 'line', title: R.lineTitle, items, actions };
    }
    if (role.kind === 'branch') {
        const branchId = role.branch?.id ?? role.branchId;
        const lineId = role.branch?.line ?? role.branch?.nearest;
        const actions = branchId ? [appAction('showLine', R.showBranch, p.id, { branchId, ...(lineId ? { lineId } : {}) })] : [];
        if (live && lineId) actions.push(appAction('changeInResearch', strings.table.res.changeInResearch, p.id, { lineId }));
        return { id: 'line', title: R.offTitle, items: [branchItem(env, role.branch, role.branchId)], actions };
    }
    const title = role.kind === 'island' ? capital(strings.table.res.island) : capital(strings.table.res.offLine);
    return { id: 'line', title: R.offTitle, items: [{ title, lines: role.kind === 'island' ? [R.islandWhy] : [], actions: [] }], actions: [] };
}

function origSection(env: ResearchTableEnv, p: Person, caps: ResearchBubbleCaps): ResearchBubbleSection | null {
    const list = researchOriginItems(env, p);
    if (list.length === 0) return null;
    const R = B();
    const items = list.map(o => {
        const actions: ResearchBubbleAction[] = [];
        const model = wasRowModel(p.researchOrigins?.[o.key], id => !!env.data.sources?.[id]);
        const available = model && !dataOnly(env)
            ? revertAvailability({ ...(model.ref ? { ref: model.ref } : {}), onComputer: !!caps.onComputer, bridge: caps.bridgeLive ? 'live' : 'down' })
            : null;
        if (available === 'revert') actions.push({ id: 'revert', label: strings.table.res.revertOrig, via: 'bridge', mark: null, personId: p.id, fact: o.key });
        if (o.sourceId) actions.push(appAction('source', R.source(o.sourceRefn ?? ''), p.id, { sourceId: o.sourceId }));
        const by = o.sourceId ? sourceText(env, o.sourceId) : '';
        return { title: capital(strings.table.res.origWas(o.fact, o.was, o.now)), lines: [by ? R.changedBy(by) : R.changed], actions };
    });
    return { id: 'orig', title: R.origTitle, items, actions: [] };
}

function availSection(env: ResearchTableEnv, p: Person): ResearchBubbleSection | null {
    const edge = p.research?.edge;
    const books = (edge?.books ?? []).filter(b => b.access);
    if (books.length === 0) return null;
    const R = B();
    const access = strings.researchEdge.access;
    const items: ResearchBubbleItem[] = books.map(b => ({ title: b.title, lines: [capital(access[b.access!] ?? b.access!)], actions: [] }));
    const gaps = (edge?.noRecords ?? []).map(s => s.from === s.to ? String(s.from) : `${s.from}–${s.to}`);
    if (gaps.length > 0) items.push({ title: R.noRecords(gaps.join(', ')), lines: [], actions: [] });
    // The archive's website, when the research gave one at a task in that archive.
    const archive = (p.research?.waits ?? []).map(w => w.group).find(g => g?.type === 'archive' && webUrl(g.url));
    const actions: ResearchBubbleAction[] = archive
        ? [{ id: 'archive', label: R.archive(archive.name), via: 'web', mark: null, url: webUrl(archive.url)!, personId: p.id }] : [];
    return { id: 'avail', title: R.availTitle, items, actions };
}

/** A research column without its own section: its cell in words, no actions. */
function infoSection(env: ResearchTableEnv, p: Person, col: ResearchColumnId): ResearchBubbleSection | null {
    const value = researchCell(env, p, col);
    const text = value.research?.liveOff ? '' : value.research?.export ?? value.text;
    if (!text) return null;
    const items = text.split('; ').filter(Boolean).map(t => ({ title: capital(t), lines: [], actions: [] }));
    return { id: 'info', title: strings.table.col[col as keyof typeof strings.table.col] as string, items, actions: [] };
}

function section(env: ResearchTableEnv, p: Person, id: ResearchBubbleSectionId, caps: ResearchBubbleCaps): ResearchBubbleSection | null {
    switch (id) {
        case 'wait': return waitSection(env, p);
        case 'conf': return confSection(env, p, researchOpenConflicts(env, p).map(conflict => ({ person: p, conflict })));
        case 'hyp': return hypSection(env, p);
        case 'agent': return agentSection(env, p);
        case 'tasks': return tasksSection(env, p);
        case 'mat': return matSection(env, p);
        case 'line': return lineSection(env, p);
        case 'orig': return origSection(env, p, caps);
        case 'avail': return availSection(env, p);
        case 'info': return null;
    }
}

/** The bubble from its sections: a read-only copy drops every action and says why. */
function bubbleOf(env: ResearchTableEnv, p: Person, sections: ResearchBubbleSection[]): ResearchBubble | null {
    if (sections.length === 0) return null;
    const readOnly = !!env.input.readOnly;
    const out = readOnly
        ? sections.map(s => ({ ...s, actions: [], items: s.items.map(i => ({ ...i, actions: [] })) }))
        : sections;
    return {
        personId: p.id, name: shownName(p), refn: p.refn ?? '', sections: out, readOnly,
        ...(readOnly ? { note: strings.table.res.roNote } : {}),
    };
}

// ==================== API ====================

/**
 * The bubble of a person's research cell (§16.4): the column's own section,
 * all of them for the summary (`rSum`, in RESEARCH_BUBBLE_ORDER), the cell in
 * words for a column without one. Null: nothing to show (an empty cell).
 */
export function researchBubble(env: ResearchTableEnv, p: Person, col: ResearchColumnId, caps: ResearchBubbleCaps = {}): ResearchBubble | null {
    if (env.input.kind === 'none') return null;
    if (col === 'rSum') {
        const sections = RESEARCH_BUBBLE_ORDER.map(id => section(env, p, id, caps)).filter((s): s is ResearchBubbleSection => !!s);
        return bubbleOf(env, p, sections);
    }
    const id = COLUMN_SECTION[col];
    const one = id ? section(env, p, id, caps) : infoSection(env, p, col);
    return bubbleOf(env, p, one ? [one] : []);
}

/**
 * The bubble of a ≠ on a fact's cell (§16.3 → §16.4 Conflicts): the open
 * conflicts named (a couple's fact may name a partner's: its Decide is the
 * partner's), under the head of the row's person. Unknown or decided ones
 * are left out; null when none is left.
 */
export function researchConflictBubble(
    env: ResearchTableEnv, rowPerson: Person, conflicts: readonly { personId: PersonId; conflictId: string }[],
): ResearchBubble | null {
    if (env.input.kind === 'none') return null;
    const list: { person: Person; conflict: ResearchConflict }[] = [];
    for (const ref of conflicts) {
        const person = env.data.persons[ref.personId];
        const conflict = person ? researchOpenConflicts(env, person).find(c => c.id === ref.conflictId) : undefined;
        if (person && conflict && !list.some(x => x.conflict.id === conflict.id && x.person.id === person.id)) list.push({ person, conflict });
    }
    const conf = confSection(env, rowPerson, list);
    return bubbleOf(env, rowPerson, conf ? [conf] : []);
}

/** Every action of a bubble (its items' and its sections'), in the order drawn. */
export function researchBubbleActions(b: ResearchBubble): ResearchBubbleAction[] {
    return b.sections.flatMap(s => [...s.items.flatMap(i => i.actions), ...s.actions]);
}
