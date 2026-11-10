/**
 * The research in the Table view (spec 073 §16): which research columns a
 * tree offers, every research cell (its text, sort key, mark, count, parts
 * and the text a CSV export writes), the research chips a person matches,
 * and where a person stands in the research's lines (§16.9).
 *
 * Pure: everything live (waiting items, the agent's work and queue, the
 * lines read through the bridge, unsent changes) comes in as input, so the
 * table, its tests and its export compute the same values. No DOM here.
 */

import type {
    Partnership, Person, PersonId, ResearchBranch, ResearchConflict, ResearchLine, ResearchPlace, ResearchWait, Source, StromData,
} from '../../types.js';
import type { LiveQueueItem, LiveWaiting, LiveWorker } from '../../research-link.js';
import type { DirectionPlaces } from '../../research-directions-write.js';
import type { ChangeKind } from '../../research-changes.js';
import { todoWaiting } from '../../research-waiting.js';
import { AGENT_DONE_MS, personStoryState } from '../../card-signals.js';
import { isOpenHypothesis } from '../../view-links.js';
import { edgeEndText, edgeEstimateText, edgeNextText, effectiveNext } from '../../research-edge.js';
import { placeKey } from '../../places.js';
import { formatFlexDate } from '../../dates.js';
import { shownName } from '../../person-name.js';
import { getCurrentLanguage, strings } from '../../strings.js';
import type { CellValue, ResearchCellDetail, ResearchCellPart, ResearchMark } from './table-model.js';

// ==================== INPUT ====================

/** What kind of tree the table shows (§16.1): none = no research, archive = a research tree without an agent. */
export type ResearchTreeKind = 'none' | 'research' | 'archive';

/** Everything the research cells read beyond the tree's data; the UI gathers it once per render. */
export interface ResearchTableInput {
    kind: ResearchTreeKind;
    /** A read-only copy: only the columns from the data (§16.7). */
    readOnly?: boolean;
    /** The research is followed live now. */
    live: boolean;
    /** What waits for the user: live, else as last heard (≤ 7 days), else none. */
    waiting?: readonly LiveWaiting[];
    /** The agent's work right now (live only). */
    working?: readonly Pick<LiveWorker, 'person' | 'task' | 'who' | 'paused'>[];
    /** The agent's queue in its order (live only). */
    queue?: readonly Pick<LiveQueueItem, 'state' | 'person' | 'text'>[];
    /** People (REFN) the agent was just done with: since when (ms). */
    done?: ReadonlyMap<string, number>;
    /** Who stands where in the lines, read live (`directions.places`); wins over the file's. */
    livePlaces?: DirectionPlaces | null;
    /** What was changed in the app and not sent to the research yet, per person. */
    unsent?: ReadonlyMap<PersonId, readonly ChangeKind[]>;
    /** The research's conflicts of a person as its version not loaded has them (setResearchConflictsProvider); null: the tree's. */
    conflictsOf?: (id: PersonId) => ResearchConflict[] | null;
    /** Materials of a person (setMaterialsCountProvider); null: not offered. */
    materialsOf?: (p: Person) => number | null;
    /** Generation of a person (TableContext.generations), for the order within a line. */
    generationOf?: (id: PersonId) => number | undefined;
    /** Now (ms). */
    now: number;
    /** When the tree was opened last before this time (ms), for "new since the last opening". */
    lastOpened?: number;
}

// ==================== COLUMNS ====================

/** The research columns of persons (§16.2, §16.8, §16.9, §16.10), in the catalogue's order. */
export const RESEARCH_COLUMNS = [
    'rSum', 'rWait', 'rConf', 'rHyp', 'rTasks', 'rAgent', 'rMat', 'rLine',
    'rEdge', 'rSearched', 'rSync', 'rOrig', 'rStory', 'rWhere', 'rNew', 'rAvail', 'rParish', 'rEst',
] as const;
export type ResearchColumnId = typeof RESEARCH_COLUMNS[number];

/** Shown by the group's "all" (§16.2). */
export const RESEARCH_DEFAULT_COLUMNS: readonly ResearchColumnId[] = ['rSum', 'rWait', 'rConf', 'rHyp', 'rAgent'];

/** Only live: without following their cells are "–" and export empty (§16.2). */
const LIVE_ONLY: readonly ResearchColumnId[] = ['rTasks', 'rAgent'];
/** Never in an archive or a read-only copy (§16.1, §16.7). */
const NEEDS_AGENT: readonly ResearchColumnId[] = ['rWait', 'rTasks', 'rAgent'];

// ==================== LINES (§16.9) ====================

/** Where the lines come from: the bridge (live), the research's file, or nowhere. */
export type ResearchLinesSource = 'live' | 'file' | 'none';

export interface ResearchLinesModel {
    source: ResearchLinesSource;
    /** The lines in the research's order. */
    lines: readonly ResearchLine[];
    branches: readonly ResearchBranch[];
    /** Every person's places are said: a person without one is off the lines. */
    complete: boolean;
    /** A person's places (REFN), the narrowest first. */
    placesOf(refn: string | undefined): readonly ResearchPlace[];
}

/**
 * The lines and who stands where: live when the bridge said (it wins), else
 * the research's file (HEAD and INDI `_STROM_DIRECTION`), else none.
 */
export function researchLinesOf(data: StromData, livePlaces?: DirectionPlaces | null): ResearchLinesModel {
    if (livePlaces && (livePlaces.lines.length > 0 || livePlaces.places.size > 0)) {
        return {
            source: 'live', lines: livePlaces.lines, branches: livePlaces.branches,
            // The bridge answers for every person it knows: one it does not name is off the lines.
            complete: true,
            placesOf: refn => (refn ? livePlaces.places.get(refn) : undefined) ?? [],
        };
    }
    const dirs = data.researchDirections;
    if (!dirs || (dirs.lines.length === 0 && !dirs.complete)) {
        return { source: 'none', lines: [], branches: [], complete: false, placesOf: () => [] };
    }
    const byRefn = new Map<string, readonly ResearchPlace[]>();
    for (const p of Object.values(data.persons)) {
        if (p.refn && p.research?.places?.length) byRefn.set(p.refn, p.research.places);
    }
    return {
        source: 'file', lines: dirs.lines, branches: dirs.branches, complete: dirs.complete,
        placesOf: refn => (refn ? byRefn.get(refn) : undefined) ?? [],
    };
}

/** How a person stands in the lines (§16.9); null when nothing is known. */
export type PersonLineRole =
    | { kind: 'line'; line: ResearchLine; index: number; partner: boolean; branch?: ResearchBranch }
    | { kind: 'branch'; branch?: ResearchBranch; branchId?: string }
    | { kind: 'island' }
    | { kind: 'off' };

/**
 * The person's first place that names a known line (a side branch added to
 * a line counts in it), else a side branch, an island, or — with every place
 * said — off the lines.
 */
export function personLineRole(model: ResearchLinesModel, p: Pick<Person, 'refn'>): PersonLineRole | null {
    if (model.source === 'none') return null;
    const places = model.placesOf(p.refn);
    const lineIndex = (id: string | undefined): number => id ? model.lines.findIndex(l => l.id === id) : -1;
    const branchOf = (id: string | undefined): ResearchBranch | undefined => id ? model.branches.find(b => b.id === id) : undefined;
    for (const place of places) {
        if (place.role === 'line' || place.role === 'partner') {
            const i = lineIndex(place.line);
            if (i >= 0) return { kind: 'line', line: model.lines[i], index: i, partner: place.role === 'partner' };
        } else if (place.role === 'branch') {
            const branch = branchOf(place.branch);
            const i = lineIndex(branch?.line ?? place.line);
            if (i >= 0) return { kind: 'line', line: model.lines[i], index: i, partner: false, ...(branch ? { branch } : {}) };
        }
    }
    const branchPlace = places.find(x => x.role === 'branch');
    if (branchPlace) {
        const branch = branchOf(branchPlace.branch);
        return { kind: 'branch', ...(branch ? { branch } : {}), ...(branchPlace.branch ? { branchId: branchPlace.branch } : {}) };
    }
    if (places.some(x => x.role === 'island')) return { kind: 'island' };
    if (model.complete) return { kind: 'off' };
    return null;
}

/** Off the lines (§16.9): a side branch not added to a line, an island, and anyone without a place when all are said. */
export function isOffLine(role: PersonLineRole | null): boolean {
    return !!role && role.kind !== 'line';
}

// ==================== ENVIRONMENT ====================

/** Everything computed once per render and shared by all the cells. */
export interface ResearchTableEnv {
    data: StromData;
    input: ResearchTableInput;
    lines: ResearchLinesModel;
    /** People by their research id (REFN). */
    byRefn: Map<string, Person>;
    /** Waiting items for the user, per person (REFN). */
    todo: Map<string, LiveWaiting[]>;
    /** Sent live items waiting for a reply, per person (REFN). */
    sent: Map<string, LiveWaiting[]>;
    /** The agent works on the person (REFN) → its task. */
    working: Map<string, string>;
    /** The person's (REFN) places in the queue (1 = next). */
    queued: Map<string, number[]>;
}

export function researchTableEnv(data: StromData, input: ResearchTableInput): ResearchTableEnv {
    const byRefn = new Map<string, Person>();
    for (const p of Object.values(data.persons)) if (p.refn) byRefn.set(p.refn, p);
    const push = <T>(m: Map<string, T[]>, key: string | undefined, v: T): void => {
        if (!key) return;
        const list = m.get(key) ?? [];
        list.push(v);
        m.set(key, list);
    };
    const todo = new Map<string, LiveWaiting[]>();
    const sent = new Map<string, LiveWaiting[]>();
    const todoItems = new Set(todoWaiting(input.waiting ?? []));
    for (const w of input.waiting ?? []) {
        const target = todoItems.has(w) ? todo : sent;
        push(target, w.person, w);
        // A couple's story waits on both partners.
        if (w.kind === 'story' && w.partner && w.partner !== w.person) push(target, w.partner, w);
    }
    const working = new Map<string, string>();
    const queued = new Map<string, number[]>();
    if (input.live) {
        for (const w of input.working ?? []) if (w.person && !w.paused && !working.has(w.person)) working.set(w.person, w.task || w.who || '');
        let pos = 0;
        for (const q of input.queue ?? []) {
            if (q.state !== 'next') continue;
            pos++;
            push(queued, q.person, pos);
        }
    }
    return { data, input, lines: researchLinesOf(data, input.livePlaces), byRefn, todo, sent, working, queued };
}

/** The research columns the tree offers (§16.1): none without research; the agent's ones not in an archive or read-only; Line only with lines. */
export function researchColumns(env: ResearchTableEnv): ResearchColumnId[] {
    const { kind, readOnly } = env.input;
    if (kind === 'none') return [];
    return RESEARCH_COLUMNS.filter(c => {
        if ((kind === 'archive' || readOnly) && NEEDS_AGENT.includes(c)) return false;
        if (c === 'rLine' && env.lines.lines.length === 0) return false;
        return true;
    });
}

/** A live-only column while the research is not followed (§16.2: dashed "live" tag, "–" cells). */
export function researchColumnLiveOff(env: ResearchTableEnv, col: ResearchColumnId): boolean {
    return LIVE_ONLY.includes(col) && !env.input.live;
}

// ==================== CELLS ====================

/** A sentence run on inside a cell starts in lower case, except in German (its nouns keep their capital; as storySignalInLine). */
const lower = (text: string): string => getCurrentLanguage() === 'de' ? text : text.charAt(0).toLocaleLowerCase() + text.slice(1);

function cell(text: string, sortKey: number | string | null, detail: ResearchCellDetail, extra: Partial<CellValue> = {}): CellValue {
    return {
        text, sortKey, empty: !text && detail.count === undefined, na: false, subst: null, computed: true, approx: false, uncertain: false,
        research: detail, ...extra,
    };
}

function emptyResearch(liveOff = false): CellValue {
    return cell(liveOff ? '–' : '', null, { parts: [], export: '', ...(liveOff ? { liveOff: true } : {}) }, liveOff ? { ghost: true, empty: true } : {});
}

/** A cell from its parts: the text is the parts joined, the export the given text (or the same). */
function partsCell(parts: ResearchCellPart[], sortKey: number | string | null, more: Omit<ResearchCellDetail, 'parts' | 'export'> & { export?: string } = {}): CellValue {
    const text = [more.count !== undefined ? String(more.count) : '', ...parts.map(p => p.text)].filter(Boolean).join(' ');
    return cell(text, sortKey, { ...more, parts, export: more.export ?? text });
}

/** A day from an ISO day or instant, in the app's date format ('' when none). */
function dayText(iso: string | undefined): string {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatFlexDate(iso);
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return formatFlexDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

/** A fact tag's word ("birth"), else the conflict's title, else the tag. */
function factWord(fact: string, title?: string): string {
    return strings.research.changeWords.facts[fact] ?? title ?? fact.toLowerCase();
}

function openConflicts(env: ResearchTableEnv, p: Person): ResearchConflict[] {
    return (env.input.conflictsOf?.(p.id) ?? p.research?.conflicts ?? []).filter(c => c.status !== 'decided');
}

/** What waits outside: the live items sent out, and the file's sent waits not said live (by id). */
function externalWaits(env: ResearchTableEnv, p: Person): { text: string; id: string }[] {
    const out: { text: string; id: string }[] = [];
    const seen = new Set<string>();
    const R = strings.table.res;
    for (const w of p.refn ? env.sent.get(p.refn) ?? [] : []) {
        seen.add(w.id);
        const kind = w.kind && w.kind in R.waitTypes ? R.waitTypes[w.kind] : (w.what || R.waitTypes.other);
        out.push({ id: w.id, text: [R.waitSent(kind, dayText(w.sentAt)), w.group?.name].filter(Boolean).join(' · ') });
    }
    for (const w of p.research?.waits ?? []) {
        if (w.stat !== 'sent' || seen.has(w.id)) continue;
        out.push({ id: w.id, text: [R.waitSent(R.waitTypes[w.type ?? 'other'], dayText(w.sent)), w.group?.name].filter(Boolean).join(' · ') });
    }
    return out;
}

/** The kinds of signal a person has, the most urgent first (§16.2 rSum: waiting 5 › conflict 4 › question 3 › agent 2 › queue 1). */
function sumKinds(env: ResearchTableEnv, p: Person): { mark: ResearchMark; rank: number; word: string }[] {
    const R = strings.table.res.sum;
    const dataOnly = env.input.kind !== 'research' || !!env.input.readOnly;
    const out: { mark: ResearchMark; rank: number; word: string }[] = [];
    const ref = p.refn;
    if (!dataOnly && ref && (env.todo.get(ref)?.length ?? 0) > 0) out.push({ mark: 'wait', rank: 5, word: R.waiting });
    const conflicts = openConflicts(env, p).length;
    if (conflicts > 0) out.push({ mark: 'conf', rank: 4, word: R.conflict(conflicts) });
    if (p.question?.trim() || (p.research?.hypotheses ?? []).some(isOpenHypothesis)) out.push({ mark: 'q', rank: 3, word: R.question });
    if (!dataOnly && ref && env.working.has(ref)) out.push({ mark: 'agent', rank: 2, word: R.agent });
    if (!dataOnly && ref && env.queued.has(ref)) out.push({ mark: 'queue', rank: 1, word: R.queued });
    return out;
}

function sumCell(env: ResearchTableEnv, p: Person): CellValue {
    const kinds = sumKinds(env, p);
    if (kinds.length === 0) return emptyResearch();
    const top = kinds[0];
    const exported = kinds.map(k => k.word).join('; ');
    const parts: ResearchCellPart[] = top.mark === 'queue' ? [{ text: strings.table.res.queued }] : [];
    return cell(top.mark === 'queue' ? strings.table.res.queued : exported, top.rank, {
        mark: top.mark, parts, export: exported, ...(kinds.length > 1 ? { more: kinds.length - 1 } : {}),
    }, { title: exported });
}

function waitCell(env: ResearchTableEnv, p: Person): CellValue {
    const R = strings.table.res;
    const todo = p.refn ? env.todo.get(p.refn) ?? [] : [];
    const ext = externalWaits(env, p);
    if (todo.length === 0 && ext.length === 0) return emptyResearch();
    const extText = ext.length > 0 ? R.external(ext[0].text) : '';
    if (todo.length === 0) {
        return partsCell([{ text: extText, tone: 'light' }], 0.5, { mark: 'ext', export: extText });
    }
    const first = todo[0].kind === 'story' ? strings.story.nvWaitingItem : todo[0].what;
    const parts: ResearchCellPart[] = [{ text: first }];
    if (extText) parts.push({ text: '· ' + extText, tone: 'light' });
    return partsCell(parts, todo.length + (ext.length > 0 ? 0.5 : 0), {
        mark: 'wait', count: todo.length, export: [`${todo.length}: ${first}`, extText].filter(Boolean).join('; '),
    });
}

function confCell(env: ResearchTableEnv, p: Person): CellValue {
    const open = openConflicts(env, p);
    if (open.length === 0) return emptyResearch();
    const words = [...new Set(open.map(c => factWord(c.fact, c.title)))].join(', ');
    const parts: ResearchCellPart[] = [{ text: '· ' + words }];
    // Decidable in the app: never in a read-only copy (its bubbles have no actions).
    if (!env.input.readOnly && open.some(c => c.take)) parts.push({ text: '· ' + strings.table.res.decideHere, tone: 'primary' });
    return partsCell(parts, open.length, { mark: 'conf', count: open.length, export: `${open.length}: ${words}` });
}

function hypCell(p: Person): CellValue {
    const all = p.research?.hypotheses ?? [];
    const open = all.filter(isOpenHypothesis).length;
    if (open > 0) return partsCell([], open, { count: open, export: String(open) });
    if (all.some(h => h.decidedBy === 'agent' && h.status === 'decided')) {
        return partsCell([{ text: strings.table.res.agentDecided, tone: 'light' }], 0);
    }
    return emptyResearch();
}

function tasksCell(env: ResearchTableEnv, p: Person): CellValue {
    if (!env.input.live) return emptyResearch(true);
    const ref = p.refn;
    const places = ref ? env.queued.get(ref) ?? [] : [];
    const running = !!ref && env.working.has(ref);
    if (!running && places.length === 0) return emptyResearch();
    const R = strings.table.res;
    if (running) {
        const n = places.length + 1;
        const text = R.tasksRunning(n);
        return cell(text, 0, { parts: [{ text }], export: text.replace(' · ', ': ') });
    }
    const nearest = Math.min(...places);
    const text = R.tasksNearest(places.length, nearest);
    return cell(text, nearest, { parts: [{ text }], export: text.replace(' · ', ': ') });
}

function agentCell(env: ResearchTableEnv, p: Person): CellValue {
    if (!env.input.live) return emptyResearch(true);
    const R = strings.table.res;
    const ref = p.refn;
    if (!ref) return emptyResearch();
    if (env.working.has(ref)) {
        const text = R.working(env.working.get(ref) ?? '');
        return cell(text, 3, { mark: 'agent', parts: [{ text }], export: text });
    }
    if (env.queued.has(ref)) return cell(R.queued, 2, { parts: [{ text: R.queued, tone: 'light' }], export: R.queued });
    const done = env.input.done?.get(ref);
    if (done !== undefined && env.input.now - done < AGENT_DONE_MS) return cell(R.done, 1, { mark: 'done', parts: [{ text: R.done }], export: R.done });
    return emptyResearch();
}

function matCell(env: ResearchTableEnv, p: Person): CellValue {
    const n = env.input.materialsOf?.(p);
    if (n === null || n === undefined) return emptyResearch();
    if (n === 0) return cell('0', 0, { parts: [], export: '0' }, { ghost: true });
    return partsCell([], n, { count: n, export: String(n) });
}

/** The name of the person of a side branch (by REFN), else its id. */
function branchName(env: ResearchTableEnv, branch: ResearchBranch | undefined, id: string | undefined): string {
    const ref = branch?.person ?? id?.slice(2);
    const person = ref ? env.byRefn.get(ref) : undefined;
    return person ? shownName(person) : ref ?? '';
}

const pad = (n: number, w = 4): string => String(Math.max(0, n)).padStart(w, '0');

function lineCell(env: ResearchTableEnv, p: Person): CellValue {
    const R = strings.table.res;
    if (env.lines.source === 'none') return emptyResearch();
    const role = personLineRole(env.lines, p);
    if (!role) return emptyResearch();
    // Within a line by generation (ancestors above: -3 before 0).
    const gen = env.input.generationOf?.(p.id);
    const genKey = pad((gen ?? 0) + 500);
    switch (role.kind) {
        case 'line': {
            const parts: ResearchCellPart[] = [{ text: role.line.id, tone: 'faint' }, { text: role.line.name, weight: 500 }];
            if (role.partner) parts.push({ text: '· ' + R.partner, tone: 'light' });
            if (role.branch) parts.push({ text: '· ' + R.branch(branchName(env, role.branch, role.branch.id)), tone: 'light' });
            const exported = `${role.line.id} ${role.line.name}${role.partner ? ` (${R.partner})` : ''}`;
            return partsCell(parts, `0|${pad(role.index)}|${genKey}`, { lineId: role.line.id, export: exported });
        }
        case 'branch': {
            const text = R.branch(branchName(env, role.branch, role.branchId));
            return partsCell([{ text }], `1|${genKey}`, role.branch?.nearest ? { lineId: role.branch.nearest } : {});
        }
        case 'island':
            return partsCell([{ text: R.island, italic: true }], `2|${genKey}`);
        case 'off':
            return partsCell([{ text: R.offLine, tone: 'faint' }], `3|${genKey}`);
    }
}

function edgeCell(env: ResearchTableEnv, p: Person): CellValue {
    const edge = p.research?.edge;
    if (!edge) return emptyResearch();
    const R = strings.table.res;
    const ref = p.refn;
    const next = effectiveNext(edge, env.input.live ? {
        working: !!ref && env.working.has(ref),
        waiting: !!ref && (env.todo.get(ref)?.length ?? 0) > 0,
        queued: !!ref && env.queued.has(ref),
    } : {});
    const missing = R.missing[edge.missing] ?? R.missing.parents;
    const parts: ResearchCellPart[] = [{ text: missing, weight: 600 }];
    const why = edgeEndText(edge);
    const then = edgeNextText(edge, next);
    if (why) parts.push({ text: '· ' + lower(why) });
    if (then) parts.push({ text: '· ' + lower(then), tone: 'light' });
    return partsCell(parts, missing);
}

function searchedCell(p: Person): CellValue {
    const none = (p.research?.searched ?? []).filter(s => s.result !== 'found');
    if (none.length === 0) return emptyResearch();
    const text = strings.table.res.searchedNone(none.length, none.map(s => s.title).join(', '));
    return partsCell([{ text }], none.length);
}

/** A change kind's word ("birth"). */
function changeWord(kind: ChangeKind): string {
    const key = `kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}` as keyof typeof strings.changes;
    const w = strings.changes[key];
    return typeof w === 'string' ? w : kind;
}

function syncCell(env: ResearchTableEnv, p: Person): CellValue {
    const R = strings.table.res;
    const unsent = env.input.unsent?.get(p.id) ?? [];
    // The research kept its own value where the app's edit made a conflict (2 _STROM_KIND user).
    const kept = openConflicts(env, p).filter(c => c.kind === 'user');
    if (unsent.length === 0 && kept.length === 0) return emptyResearch();
    const parts: ResearchCellPart[] = [];
    if (unsent.length > 0) parts.push({ text: R.unsent([...new Set(unsent.map(changeWord))].join(', ')), tone: 'accent', weight: 600 });
    if (kept.length > 0) parts.push({ text: (parts.length ? '· ' : '') + R.notWritten([...new Set(kept.map(c => factWord(c.fact, c.title)))].join(', ')) });
    return partsCell(parts, unsent.length * 100 + kept.length, { export: parts.map(x => x.text.replace(/^· /, '')).join('; ') });
}

/** The fact's value now, in the parts the research changed. */
function factNow(p: Person, key: string, parts: readonly string[] | undefined): string {
    const want = (part: string) => !parts?.length || parts.includes(part);
    const join = (date?: string, place?: string) => [want('DATE') ? formatFlexDate(date) : '', want('PLAC') ? place ?? '' : ''].filter(Boolean).join(', ');
    if (key === 'birth') return join(p.birthDate, p.birthPlace);
    if (key === 'death') return join(p.deathDate, p.deathPlace);
    if (key === 'name') return [want('GIVN') ? p.firstName : '', want('SURN') ? p.lastName : ''].filter(Boolean).join(' ');
    if (key === 'sex') return p.gender;
    if (key.startsWith('event:')) {
        const ev = p.events?.find(e => e.id === key.slice(6));
        return ev ? join(ev.date, ev.place) : '';
    }
    return '';
}

const ORIGIN_FACT: Record<string, string> = { name: 'NAME', sex: 'SEX', birth: 'BIRT', death: 'DEAT' };

function origCell(env: ResearchTableEnv, p: Person): CellValue {
    const R = strings.table.res;
    const items: string[] = [];
    for (const [key, origin] of Object.entries(p.researchOrigins ?? {})) {
        const was = origin.was?.value?.trim();
        if (!was) continue;
        const fact = ORIGIN_FACT[key] ? factWord(ORIGIN_FACT[key]) : changeWord('event');
        const now = factNow(p, key, origin.was?.parts) || '–';
        const src = origin.sourceIds?.map(id => env.data.sources?.[id]?.refn).find(Boolean);
        items.push(R.origWas(fact, was, now) + (src ? ` (${src})` : ''));
    }
    if (items.length === 0) return emptyResearch();
    return partsCell(items.map((text, i) => ({ text: i ? '· ' + text : text })), items.length, { export: items.join('; ') });
}

function storyCell(env: ResearchTableEnv, p: Person): CellValue {
    const st = personStoryState(p, env.data);
    if (!st) return emptyResearch();
    const R = strings.table.res;
    if (!st.final) return partsCell([{ text: R.storyDraft, tone: 'light' }], 1);
    if (!st.storyNew) return partsCell([{ text: R.storyFinal }], 2);
    const unions = Object.values(env.data.partnerships).filter(u => u.person1Id === p.id || u.person2Id === p.id);
    const at = p.story?.draft?.at ?? unions.map(u => u.story?.draft?.at).find(Boolean);
    return partsCell([{ text: R.storyFinal }, { text: '· ' + R.storyNewVersion(dayText(at)), tone: 'primary', weight: 600 }], 3);
}

function whereCell(p: Person): CellValue {
    const waits = (p.research?.waits ?? []).filter(w => w.group);
    if (waits.length === 0) return emptyResearch();
    const R = strings.table.res;
    const groups = new Map<string, ResearchWait[]>();
    for (const w of waits) {
        const key = w.group!.key ?? w.group!.name;
        groups.set(key, [...groups.get(key) ?? [], w]);
    }
    const prio = (list: ResearchWait[]) => Math.min(...list.map(w => w.prio ?? 999));
    const sorted = [...groups.values()].sort((a, b) => prio(a) - prio(b));
    const first = sorted[0];
    const g = first[0].group!;
    const name = g.type ? `${g.name} (${R.groupKinds[g.type]})` : g.name;
    const parts: ResearchCellPart[] = [{ text: name, weight: 500 }, { text: '· ' + R.tasks(first.length) }];
    const p1 = prio(first);
    if (p1 < 999) parts.push({ text: '· ' + R.priority(p1), tone: 'light' });
    return partsCell(parts, p1, sorted.length > 1 ? { more: sorted.length - 1 } : {});
}

/** The windows of "New from research" (§16.10 item 7). */
export type ResearchNewWindow = 'day' | 'week' | 'lastOpen';

const DAY_MS = 24 * 3600 * 1000;

/** The research added the person within the window. */
export function researchAddedWithin(env: ResearchTableEnv, p: Person, window: ResearchNewWindow): boolean {
    const t = p.research?.added ? Date.parse(p.research.added) : NaN;
    if (Number.isNaN(t)) return false;
    const { now, lastOpened } = env.input;
    if (window === 'day') return now - t <= DAY_MS;
    if (window === 'week') return now - t <= 7 * DAY_MS;
    return lastOpened !== undefined && t > lastOpened;
}

function newCell(env: ResearchTableEnv, p: Person): CellValue {
    const added = p.research?.added;
    const t = added ? Date.parse(added) : NaN;
    if (!added || Number.isNaN(t)) return emptyResearch();
    const R = strings.table.res;
    const fresh = researchAddedWithin(env, p, 'week') || researchAddedWithin(env, p, 'lastOpen');
    const parts: ResearchCellPart[] = [{ text: R.added(dayText(added)) }];
    return partsCell(parts, t, fresh ? { mark: 'new', export: `${R.newLabel}: ${parts[0].text}` } : {});
}

const ONLINE = ['online-free', 'online-login'];
const READING_ROOM = ['onsite', 'request'];

function availCell(p: Person): CellValue {
    const books = p.research?.edge?.books ?? [];
    const room = books.filter(b => b.access && READING_ROOM.includes(b.access));
    const online = books.filter(b => b.access && ONLINE.includes(b.access));
    if (room.length === 0 && online.length === 0) return emptyResearch();
    const R = strings.table.res;
    const parts: ResearchCellPart[] = [];
    if (room.length > 0) parts.push({ text: R.readingRoomOnly(room.map(b => b.title).join(', ')) });
    if (online.length > 0) parts.push({ text: (parts.length ? '· ' : '') + R.online(online.map(b => b.title).join(', ')), tone: 'light' });
    return partsCell(parts, room.length, { export: parts.map(x => x.text.replace(/^· /, '')).join('; ') });
}

/** The birth place's record (data.placeRefs → placeRecords). */
function birthPlaceRecord(data: StromData, p: Person) {
    if (!p.birthPlace?.trim()) return undefined;
    const id = data.placeRefs?.[placeKey(p.birthPlace)];
    return id ? data.placeRecords?.[id] : undefined;
}

/** The person's birth place is not located: its record says why, or it has no parish (§16.10 item 9). */
export function researchPlaceOpen(data: StromData, p: Person): boolean {
    const rec = birthPlaceRecord(data, p);
    return !!rec && rec.unlocated !== undefined;
}

function parishCell(env: ResearchTableEnv, p: Person): CellValue {
    const rec = birthPlaceRecord(env.data, p);
    if (!rec) return emptyResearch();
    const R = strings.table.res;
    if (rec.unlocated !== undefined) {
        const text = R.placeOpen(p.birthPlace!.trim(), rec.needs?.trim() ?? '');
        return partsCell([{ text, tone: 'accent', italic: true }], 'z' + text);
    }
    const parish = rec.jurisdictions?.find(j => j.kind === 'parish');
    if (!parish) return emptyResearch();
    return partsCell([{ text: R.parish(parish.name, parish.from ?? null) }], parish.name);
}

function estCell(p: Person): CellValue {
    const edge = p.research?.edge;
    const text = edge ? edgeEstimateText(edge) : '';
    if (!text) return emptyResearch();
    return partsCell([{ text }], edge!.est!.year, {});
}

/** A research cell of a person row (§16.2, §16.8, §16.9, §16.10). */
export function researchCell(env: ResearchTableEnv, p: Person, col: ResearchColumnId): CellValue {
    switch (col) {
        case 'rSum': return sumCell(env, p);
        case 'rWait': return waitCell(env, p);
        case 'rConf': return confCell(env, p);
        case 'rHyp': return hypCell(p);
        case 'rTasks': return tasksCell(env, p);
        case 'rAgent': return agentCell(env, p);
        case 'rMat': return matCell(env, p);
        case 'rLine': return lineCell(env, p);
        case 'rEdge': return edgeCell(env, p);
        case 'rSearched': return searchedCell(p);
        case 'rSync': return syncCell(env, p);
        case 'rOrig': return origCell(env, p);
        case 'rStory': return storyCell(env, p);
        case 'rWhere': return whereCell(p);
        case 'rNew': return newCell(env, p);
        case 'rAvail': return availCell(p);
        case 'rParish': return parishCell(env, p);
        case 'rEst': return estCell(p);
    }
}

// ==================== CHIPS ====================

/** The research chips (§16.5, §16.9, §16.10); a line chip is `line:G…`. */
export type ResearchChipId =
    | 'rWait' | 'rConf' | 'rQ' | 'rAgent' | 'offLine' | `line:${string}`
    | 'xUnsent' | 'xChanged' | 'xDecideHere' | 'xExternal' | 'xNew' | 'xReadingRoom' | 'xPlaceOpen' | 'xAgentDecided' | 'xPaused' | 'rEdge';

/** The research chips a person matches; `newWindow` decides "New from research". */
export function researchChips(env: ResearchTableEnv, p: Person, newWindow: ResearchNewWindow = 'week'): Set<ResearchChipId> {
    const out = new Set<ResearchChipId>();
    if (env.input.kind === 'none') return out;
    const ref = p.refn;
    const agentHere = env.input.kind === 'research' && !env.input.readOnly;
    if (agentHere && ref && (env.todo.get(ref)?.length ?? 0) > 0) out.add('rWait');
    const conflicts = openConflicts(env, p);
    if (conflicts.length > 0) out.add('rConf');
    if (p.question?.trim() || (p.research?.hypotheses ?? []).some(isOpenHypothesis)) out.add('rQ');
    if (agentHere && env.input.live && ref && (env.working.has(ref) || env.queued.has(ref))) out.add('rAgent');
    const role = personLineRole(env.lines, p);
    if (role?.kind === 'line') out.add(`line:${role.line.id}`);
    if (isOffLine(role)) out.add('offLine');
    if ((env.input.unsent?.get(p.id)?.length ?? 0) > 0) out.add('xUnsent');
    if (Object.values(p.researchOrigins ?? {}).some(o => !!o.was?.value?.trim())) out.add('xChanged');
    if (!env.input.readOnly && conflicts.some(c => c.take)) out.add('xDecideHere');
    if (externalWaits(env, p).length > 0) out.add('xExternal');
    if (researchAddedWithin(env, p, newWindow)) out.add('xNew');
    if ((p.research?.edge?.books ?? []).some(b => b.access && READING_ROOM.includes(b.access))) out.add('xReadingRoom');
    if (researchPlaceOpen(env.data, p)) out.add('xPlaceOpen');
    if ((p.research?.hypotheses ?? []).some(h => h.decidedBy === 'agent' && h.status === 'decided')) out.add('xAgentDecided');
    if (researchPaused(env, p, role)) out.add('xPaused');
    if (p.research?.edge) out.add('rEdge');
    return out;
}

/**
 * Paused or put off (§16.10): the person's line is paused, their side
 * branch's work outside the lines is never or last, or the edge above them
 * is held.
 */
function researchPaused(env: ResearchTableEnv, p: Person, role: PersonLineRole | null): boolean {
    if (role?.kind === 'line' && role.line.state === 'paused') return true;
    const branch = role?.kind === 'branch' ? role.branch : role?.kind === 'line' ? role.branch : undefined;
    if (branch?.mode === 'never' || branch?.mode === 'last') return true;
    return p.research?.edge?.next === 'held';
}

/** The line chips (§16.9): each line with its people (partners too), in the research's order, and Off the lines. */
export function researchLineCounts(env: ResearchTableEnv, persons: readonly Person[]): { lines: { line: ResearchLine; count: number }[]; offLine: number } {
    const counts = new Map<string, number>();
    let offLine = 0;
    for (const p of persons) {
        if (p.isPlaceholder) continue;
        const role = personLineRole(env.lines, p);
        if (role?.kind === 'line') counts.set(role.line.id, (counts.get(role.line.id) ?? 0) + 1);
        else if (isOffLine(role)) offLine++;
    }
    return { lines: env.lines.lines.map(line => ({ line, count: counts.get(line.id) ?? 0 })), offLine };
}

// ==================== UNIONS AND SOURCES ====================

/** A union's line (§16.9, 16zg): by its partner who is a person of a line (not a partner of one), else the other's. */
export function unionLineRole(env: ResearchTableEnv, u: Partnership): PersonLineRole | null {
    const roles = [u.person1Id, u.person2Id].map(id => env.data.persons[id]).filter(Boolean).map(p => personLineRole(env.lines, p));
    return roles.find(r => r?.kind === 'line' && !r.partner) ?? roles.find(r => r?.kind === 'line') ?? roles.find(r => !!r) ?? null;
}

/** The union's id in the research (F…), uResearchId. */
export function unionResearchIdCell(u: Partnership): CellValue {
    const id = u.researchId?.trim();
    return id ? partsCell([{ text: id }], id) : emptyResearch();
}

/** The source's id in the research (S…), srcResearchId. */
export function sourceResearchIdCell(s: Source): CellValue {
    const id = s.refn?.trim();
    return id ? partsCell([{ text: id }], id) : emptyResearch();
}
