/**
 * Sorting materials with the research's agent (spec 102 §13): which files
 * can be sent, what the agent's proposal means for each file, and what
 * accepting it writes. Pure: the dialog, the proposal window and the bridge
 * calls live in src/ui/material-sort-ui.ts.
 *
 * Nothing here sends anything: the app sends a sorting only after an
 * explicit click in its dialog (the agent uses the subscription or credit).
 */

import type { MaterialItem } from './materials.js';
import { SORT_MAX_FILES, fileExt, materialFolder, materialType, type SortJob, type SortLink, type SortProposal, type SortRunState, type SortState } from './materials.js';
import type { ResearchSortRemembered, ResearchSortRun, SortRunErrorCode } from './research-device.js';
import type { MaterialKind, MediaBy, MediaPlace, PartnershipId, PersonId, StromData } from './types.js';
import { researchPersonRef } from './research-link.js';

/** What the files lack: a title of their own, a person. */
export function sortNeeds(items: readonly MaterialItem[]): { n: number; t: number; p: number } {
    let t = 0, p = 0;
    for (const i of items) {
        if (!i.titled) t++;
        if (!i.persons.length && !i.viaBatch.length) p++;
    }
    return { n: items.length, t, p };
}

/** The files a sorting over the whole window takes: the research's files, not hidden, without a title of their own or a person. */
export function sortNeedy(items: readonly MaterialItem[]): MaterialItem[] {
    return items.filter(i => !!i.file && !i.hidden && (!i.titled || (!i.persons.length && !i.viaBatch.length)));
}

/** The most batches one action sends (1500 files, the research's `SORT_RUN_MOST_FILES`, spec 102 K1.12). */
export const SORT_MAX_BATCHES = 30;

/** Text and data files: the agent reads them as text or by name only; sent only when asked, after the pictures (spec 102 §4.1). */
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'text', 'json', 'csv']);
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

export function sortIsText(item: Pick<MaterialItem, 'mime' | 'name' | 'file'>): boolean {
    const name = item.file?.name ?? item.name;
    return TEXT_EXT.has(fileExt(name)) || TEXT_MIME.has((item.file?.mime ?? item.mime ?? '').toLowerCase());
}

/** What the agent left unassigned (spec 102 §4.4): I… → why it said nothing, what its reader wrote. */
export type SortLeftMap = ReadonlyMap<string, { why?: string; said?: string }>;

/**
 * The files the agent left unassigned: as the research says it (`material.left`,
 * `research`) together with what this app remembers from the proposals it
 * closed (`app`, ResearchAutoState.sortLeft; the only memory of an older research).
 */
export function sortLeftMap(items: readonly MaterialItem[], opts: { research: boolean; app?: Readonly<Record<string, { why?: string }>> }): Map<string, { why?: string; said?: string }> {
    const out = new Map<string, { why?: string; said?: string }>();
    for (const [id, x] of Object.entries(opts.app ?? {})) out.set(id, x?.why ? { why: x.why } : {});
    if (opts.research) {
        for (const i of items) {
            const l = i.file?.left;
            if (l) out.set(i.file!.id, { why: l.why, ...(l.said ? { said: l.said } : {}) });
        }
    }
    return out;
}

/**
 * The files with the same content as an older one (spec 102 §4.2): I… → the
 * original's I…. As the research says it (`material.sameAs`), else by the
 * hash among the files known here: the oldest (received first, then the
 * lowest number) is the original, the others its copies.
 */
export function sortCopyOf(items: readonly MaterialItem[], research: boolean): Map<string, string> {
    const out = new Map<string, string>();
    const files = items.filter(i => !!i.file).map(i => i.file!);
    if (research) {
        for (const f of files) if (f.sameAs && f.sameAs !== f.id) out.set(f.id, f.sameAs);
        return out;
    }
    const num = (id: string) => Number(id.slice(1)) || 0;
    const first = new Map<string, typeof files[number]>();
    const older = (a: typeof files[number], b: typeof files[number]) => {
        const ta = a.at ? Date.parse(a.at) : Number.POSITIVE_INFINITY;
        const tb = b.at ? Date.parse(b.at) : Number.POSITIVE_INFINITY;
        return ta !== tb ? ta < tb : num(a.id) < num(b.id);
    };
    for (const f of files) {
        if (!f.sha) continue;
        const o = first.get(f.sha);
        if (!o || older(f, o)) first.set(f.sha, f);
    }
    for (const f of files) {
        const o = f.sha ? first.get(f.sha) : undefined;
        if (o && o.id !== f.id) out.set(f.id, o.id);
    }
    return out;
}

export interface SortNextOpts {
    /** all: every file without a title or a person; batch: those of one batch (`batchId`); selection: exactly the items given. */
    scope: 'all' | 'selection' | 'batch';
    batchId?: string;
    /** Text and data files too (the dialog's checkbox), after the pictures. */
    withText?: boolean;
    /** What the agent left unassigned (sortLeftMap): not sent again, unless selected. */
    left: ReadonlySet<string> | ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;
    /** Copies of an older file (sortCopyOf): only the original is sent, unless selected. */
    copyOf?: ReadonlyMap<string, string>;
    /** The research says which sources a file is the file of (`material.sourceOf`): those are not sent, unless selected. */
    sourceOf?: boolean;
}

/**
 * The batches a run of the research takes (spec 102 §3): the files in their
 * order, 50 to a batch (the research cuts them so), at most SORT_MAX_BATCHES.
 */
export function sortRunBatches(ids: readonly string[]): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < ids.length && out.length < SORT_MAX_BATCHES; i += SORT_MAX_FILES) out.push(ids.slice(i, i + SORT_MAX_FILES));
    return out;
}

export interface SortNext {
    /** Every file to send, in order: pictures and PDFs first, then the others, text and data last; a folder's files together. */
    send: MaterialItem[];
    /** `send` in batches of at most SORT_MAX_FILES, at most SORT_MAX_BATCHES of them. */
    batches: MaterialItem[][];
    /** Files of `send` beyond the last batch (the next action takes them). */
    over: number;
    /** What is not sent, and why. */
    skipped: { copies: MaterialItem[]; text: MaterialItem[]; sources: MaterialItem[]; left: MaterialItem[] };
}

/**
 * What the next sorting sends and in which order (spec 102 §4, K1.13):
 * 1 pictures (images, PDFs) first, then the other files; text and data files
 * only when asked (`withText`), and then last; 2 of files with the same
 * content only the original; 3 not the file of a source (only when the
 * research says it); 4 not what the agent left unassigned before; 5 within
 * a group by batch and folder, a folder of at most 50 files kept in one batch
 * (a new batch starts rather than split it). A selection sends every file
 * selected (only in this order).
 */
export function sortNext(items: readonly MaterialItem[], opts: SortNextOpts): SortNext {
    const skipped: SortNext['skipped'] = { copies: [], text: [], sources: [], left: [] };
    const left = opts.left;
    const isLeft = (id: string) => left instanceof Set || left instanceof Map ? left.has(id) : Object.prototype.hasOwnProperty.call(left, id);
    const selection = opts.scope === 'selection';
    const pool = selection
        ? items.filter(i => !!i.file && !i.hidden)
        : sortNeedy(opts.scope === 'batch' ? items.filter(i => i.batch?.id === opts.batchId || i.file?.batch === opts.batchId) : items);
    const take: { item: MaterialItem; group: number; i: number }[] = [];
    pool.forEach((item, i) => {
        const id = item.file!.id;
        const text = sortIsText(item);
        if (!selection) {
            if (opts.sourceOf && item.file!.uses?.of?.length) { skipped.sources.push(item); return; }
            if (opts.copyOf?.has(id)) { skipped.copies.push(item); return; }
            if (isLeft(id)) { skipped.left.push(item); return; }
            if (text && !opts.withText) { skipped.text.push(item); return; }
        }
        const type = materialType(item.file!.mime ?? item.mime, item.file!.name);
        take.push({ item, group: text ? 2 : type === 'image' || type === 'pdf' ? 0 : 1, i });
    });
    // A batch's and a folder's place: where its first file stands.
    const rank = new Map<string, number>();
    const rankOf = (key: string) => { if (!rank.has(key)) rank.set(key, rank.size); return rank.get(key)!; };
    const batchKey = (x: MaterialItem) => x.batch?.id ?? x.file?.batch ?? '';
    const folderKey = (x: MaterialItem) => `${batchKey(x)}\u0000${materialFolder(x.path ?? x.file?.path)}`;
    const keyed = take.map(t => ({ ...t, b: rankOf(`b\u0000${batchKey(t.item)}`), f: rankOf(`f\u0000${folderKey(t.item)}`) }));
    keyed.sort((a, b) => a.group - b.group || a.b - b.b || a.f - b.f || a.i - b.i);
    const send = keyed.map(k => k.item);

    // Batches: a folder that fits a batch of its own is not split; a bigger one is.
    const batches: MaterialItem[][] = [];
    let cur: MaterialItem[] = [];
    const close = () => { if (cur.length) batches.push(cur); cur = []; };
    for (let i = 0; i < keyed.length;) {
        let j = i;
        while (j < keyed.length && keyed[j].group === keyed[i].group && keyed[j].f === keyed[i].f) j++;
        const seg = keyed.slice(i, j).map(k => k.item);
        if (seg.length <= SORT_MAX_FILES && cur.length + seg.length > SORT_MAX_FILES) close();
        for (const x of seg) {
            cur.push(x);
            if (cur.length === SORT_MAX_FILES) close();
        }
        i = j;
    }
    close();
    const kept = batches.slice(0, SORT_MAX_BATCHES);
    const over = send.length - kept.reduce((t, b) => t + b.length, 0);
    return { send, batches: kept, over, skipped };
}

/**
 * The one strip of sorting in the Materials window (spec 102 §1), over the
 * whole archive whatever the filter shows:
 * A unsorted files and nothing remembered (Sort with the agent…),
 * B the agent works and nothing waits, C it works and proposals wait,
 * D proposals wait and nothing works, E the proposal closed (or all of it
 * handled) and files are left (Sort the next…), F nothing is left (said a
 * moment after a proposal closes). null: no strip.
 */
export type SortStripState = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export function sortStripState(input: {
    /** A sorting is remembered for the tree (not ended without a proposal). */
    remembered: boolean;
    /** The sorting works (queued, working, or not asked about yet). */
    running: boolean;
    /** Its proposals not accepted or rejected yet. */
    pending: number;
    /** The last proposal closed and its line not closed (ResearchAutoState.sortClosed). */
    closed: boolean;
    /** The files the next sorting takes (sortNext's `send`). */
    next: number;
    /** The files the agent left unassigned that still lack a title or a person (Go through by hand). */
    left?: number;
}): SortStripState | null {
    if (input.remembered) {
        if (input.running) return input.pending > 0 ? 'C' : 'B';
        return input.pending > 0 ? 'D' : 'E';
    }
    // F only when nothing is left at all: files the agent left unassigned keep E (Go through by hand).
    if (input.closed) return input.next > 0 || (input.left ?? 0) > 0 ? 'E' : 'F';
    return input.next > 0 ? 'A' : null;
}

/** A proposal's rows counted (spec 102 §1, §5): waiting, accepted, rejected, unassigned. */
export interface SortCounts {
    files: number;
    open: number;
    accepted: number;
    rejected: number;
    unassigned: number;
}

export function sortProposalCounts(rows: readonly SortRow[], decided: Readonly<Record<string, 'accepted' | 'rejected'>>): SortCounts {
    const out: SortCounts = { files: rows.length, open: 0, accepted: 0, rejected: 0, unassigned: 0 };
    for (const row of rows) {
        // A row decided counts as decided: once accepted the file has what was proposed, so its row proposes nothing now.
        const d = decided[row.id];
        if (d === 'accepted') out.accepted++;
        else if (d === 'rejected') out.rejected++;
        else if (!sortRowProposes(row)) out.unassigned++;
        else out.open++;
    }
    return out;
}

/**
 * What a closed proposal leaves as unassigned (spec 102 §4.4, §6): the files
 * with no proposal or not about the family, except those the research did
 * not judge (left out, its reader failed): they go to the next sorting again.
 */
export function sortLeftIds(rows: readonly SortRow[], unproposed: readonly { id: string; why: string }[] = [],
    decided: Readonly<Record<string, 'accepted' | 'rejected'>> = {}): { id: string; why?: string }[] {
    const why = new Map(unproposed.map(u => [u.id, u.why]));
    return rows.filter(r => !decided[r.id] && !sortRowProposes(r))
        .filter(r => { const w = why.get(r.id); return w !== 'left-out' && w !== 'reader-failed'; })
        .map(r => ({ id: r.id, ...(r.unrelated ? { why: 'unrelated' } : why.get(r.id) ? { why: why.get(r.id)! } : {}) }));
}

/**
 * A run's batches as one proposal (spec 102 §3): the files, proposals and
 * files without a proposal of the batches finished so far, in batch order.
 * `state` is the run's (a run still at work is still at work).
 */
export function sortJobsMerged(id: string, state: SortState, jobs: readonly (SortJob | null | undefined)[]): SortJob {
    const got = jobs.filter((j): j is SortJob => !!j);
    const unproposed = got.flatMap(j => j.unproposed ?? []);
    return {
        id, state, at: got[0]?.at ?? '',
        files: got.flatMap(j => j.files), proposals: got.flatMap(j => j.proposals),
        ...(unproposed.length ? { unproposed } : {}),
    };
}

/** Where a run of batches is (spec 102 §3): the strip's and the proposal window's line and bar. */
export interface SortRunView {
    /** The batch at work or next to start (1…), the last one once none is left. */
    batch: number;
    batches: number;
    /** The index of the batch at work or next to start; `batches` once none is left. */
    next: number;
    /** The run still works (a batch at work or waiting). */
    running: boolean;
    /** The batch next has not started yet (it waits its turn). */
    starting: boolean;
    /** The files of the batch at work and how many its readers judged (undefined: the research does not say). */
    batchFiles: number;
    batchDone?: number;
    /** The whole run's files and those judged: the bar's value. */
    files: number;
    filesDone: number;
    /** Where one batch ends and the next starts, in % of the bar (one fewer than batches). */
    marks: number[];
    /** The batches finished (index): their proposals can be gone through. */
    done: number[];
    /** The sortings of the batches as the research says them (index = batch); missing ones as remembered. */
    sorts: string[];
    /** The batches that did not run (index): failed in the research. */
    failed: number[];
    /** Why the batch next to start waits and in how many seconds it is tried again (the research's word). */
    waiting?: { why: string; retry?: number };
}

const liveState = (s: SortState): boolean => s === 'queued' || s === 'working';

/**
 * A run as the research says it (`GET /material/sort/<run-…>`), over the
 * batches the app remembers; without the research's word yet (a reload,
 * the first read), as remembered.
 */
export function sortRunView(run: Pick<ResearchSortRun, 'batches' | 'sorts' | 'next' | 'done'>, state: SortRunState | null): SortRunView {
    const nb = run.batches.length;
    const byIndex = new Map((state?.parts ?? []).map(p => [p.part - 1, p]));
    const sizes = run.batches.map((b, i) => byIndex.get(i)?.files || b.length);
    const files = sizes.reduce((t, n) => t + n, 0);
    const marks: number[] = [];
    for (let i = 0, at = 0; i < nb - 1; i++) {
        at += sizes[i];
        marks.push(files ? Math.round((at / files) * 1000) / 10 : 0);
    }
    const sorts = run.batches.map((_, i) => byIndex.get(i)?.id ?? run.sorts[i] ?? '');
    let next: number;
    let done: number[];
    let running: boolean;
    let failed: number[] = [];
    if (state) {
        next = run.batches.findIndex((_, i) => { const p = byIndex.get(i); return !p || liveState(p.state); });
        if (next < 0) next = nb;
        done = run.batches.map((_, i) => i).filter(i => byIndex.get(i)?.state === 'done');
        failed = run.batches.map((_, i) => i).filter(i => byIndex.get(i)?.state === 'failed');
        running = liveState(state.state) && next < nb;
    } else {
        next = Math.min(run.next, nb);
        // A run that ended keeps which batches finished (the others did not run).
        done = run.done ?? run.batches.map((_, i) => i).filter(i => i < next);
        running = !run.done && next < nb;
    }
    const at = Math.min(next, nb - 1);
    const part = byIndex.get(at);
    const starting = running && (!part || part.state === 'queued');
    const batchDone = running && part?.state === 'working' && part.filesDone !== undefined ? Math.min(part.filesDone, sizes[at]) : undefined;
    const before = sizes.slice(0, Math.min(next, nb)).reduce((t, n) => t + n, 0);
    const filesDone = Math.min(files, state ? Math.max(state.filesDone, before + (batchDone ?? 0)) : before);
    const waiting = running && starting && state?.waiting ? state.waiting : undefined;
    return {
        batch: at + 1, batches: nb, next, running, starting, batchFiles: sizes[at] ?? 0,
        ...(batchDone !== undefined ? { batchDone } : {}),
        files, filesDone, marks, done, sorts, failed,
        ...(waiting ? { waiting } : {}),
    };
}

/** Why a batch did not run, from its sorting's `reason` (the research's word: limit, auth, timeout, error, stopped…). */
export function sortRunErrorCode(reason: string | undefined): SortRunErrorCode {
    if (reason === 'limit') return 'limit';
    return reason ? 'agent' : 'other';
}

/**
 * A run that ended (spec 102 §3, §12), as remembered: a batch that did not
 * run (the first one, with the research's reason) is the run's error; a run
 * stopped elsewhere (cancelled, not here) before every batch ran is stopped.
 * Which batches finished is kept. null: nothing new to remember (still at
 * work, said already, or closed here).
 */
export function sortRunEnded(r: ResearchSortRemembered, view: SortRunView, state: SortRunState, reasons: ReadonlyMap<number, string> = new Map()): ResearchSortRemembered | null {
    const run = r.run;
    if (!run || view.running || run.error || run.stopped || run.closed) return null;
    const done = [...view.done];
    if (view.failed.length) {
        const batch = view.failed[0];
        const reason = reasons.get(batch);
        return { ...r, run: { ...run, done, error: { batch, code: sortRunErrorCode(reason), ...(reason ? { reason } : {}) } } };
    }
    if (state.state === 'cancelled' && !run.cancelled && done.length < run.batches.length) return { ...r, run: { ...run, done, stopped: true } };
    if (run.done?.join() !== done.join()) return { ...r, run: { ...run, done } };
    return null;
}

/** The run cancelled here (spec 102 §3): the batches not finished stay unsorted, nothing goes on by itself. */
export function sortRunCancelled(r: ResearchSortRemembered, view: SortRunView | null): ResearchSortRemembered {
    if (!r.run) return r;
    // A stop read meanwhile (the research said cancelled before the cancel answered) was this one.
    const { stopped: _stopped, ...run } = r.run;
    return { ...r, run: { ...run, cancelled: true, ...(view ? { done: [...view.done] } : {}) } };
}

/**
 * What is left of a run (spec 102 §3): the batches that brought no proposal
 * (failed, cancelled, never run), their files in the order sent and how
 * many there are; Try again and Continue sort them.
 */
export function sortRunRest(run: Pick<ResearchSortRun, 'batches'>, view: Pick<SortRunView, 'done'>, gone: readonly string[] = []): { batches: number; files: string[] } {
    const done = new Set(view.done);
    const out = new Set(gone);
    // A batch whose every file was deleted for good is no batch left to run (the research skips it).
    const left = run.batches.filter((_, i) => !done.has(i)).map(b => b.filter(f => !out.has(f))).filter(b => b.length > 0);
    return { batches: left.length, files: left.flat() };
}

/** The finished sortings of a remembered proposal (its run's finished batches, else the one sorting, and those before). */
export function sortFinishedSorts(r: ResearchSortRemembered, view: SortRunView | null): string[] {
    const own = r.run?.id && view ? view.done.map(i => view.sorts[i]).filter(Boolean) : r.run ? [] : [r.id];
    return [...new Set([...(r.earlier ?? []), ...own])];
}

/**
 * A new sorting that goes on with a proposal (spec 102 §3: Try again,
 * Continue): what was decided, its undo and the finished sortings stay, so
 * the proposals still waiting are not lost; the new batches join them.
 */
export function sortRunContinued(old: ResearchSortRemembered, fresh: ResearchSortRemembered, finished: readonly string[]): ResearchSortRemembered {
    const earlier = [...new Set(finished)].filter(id => id !== fresh.id && !fresh.run?.sorts.includes(id));
    return {
        ...fresh,
        decided: { ...old.decided, ...fresh.decided },
        ...(old.reverts ? { reverts: { ...old.reverts } } : {}),
        ...(!fresh.batch && old.batch ? { batch: old.batch } : {}),
        ...(earlier.length ? { earlier } : {}),
    };
}

/**
 * The remembered sorting moved on with its run (spec 102 §3): the batch at
 * work (its sorting and files) and the next index; null when nothing moved.
 * What was decided stays.
 */
export function sortRunAdvance(r: ResearchSortRemembered, view: SortRunView): ResearchSortRemembered | null {
    const run = r.run;
    if (!run) return null;
    const at = Math.min(view.next, run.batches.length - 1);
    const sorts = view.sorts.map((id, i) => id || run.sorts[i] || '').filter(Boolean);
    const id = sorts[at] ?? r.id;
    const files = run.batches[at] ?? r.files;
    if (run.next === view.next && r.id === id && sorts.join() === run.sorts.join()) return null;
    return { ...r, id, files, run: { ...run, next: view.next, sorts } };
}

export interface SortField<T> {
    /** What the agent proposes. */
    proposed: T;
    /** A person set it otherwise: it stays unless the proposal is used on purpose. */
    human?: T;
}

/** A link of the proposal as the tree knows it. */
export interface SortChip {
    link: SortLink;
    /** Where it goes in the tree (null: the tree does not know it — not written). */
    place: MediaPlace | null;
    /** A person's REFN for material outside the tree (`/material/assign`). */
    person: string | null;
    kind: 'person' | 'event' | 'source';
    /** The person's or the source's name, the event's name with its person. */
    label: string;
    /** A source the tree does not know (its research ref): a new source of the tree when accepted (§5, titled by the file, its REFN this ref). */
    newSource?: string;
}

export interface SortRow {
    id: string;
    item: MaterialItem | null;
    proposal: SortProposal | null;
    title?: SortField<string>;
    date?: SortField<string>;
    kind?: SortField<MaterialKind>;
    chips: SortChip[];
    /** The agent says the file is not about the family: unassigned, nothing of its proposal is offered. */
    unrelated?: true;
    /** The back side of the same photo or page (spec 102 §10): its file, written with this row. */
    back?: { id: string; item: MaterialItem };
    /** The one person of the file as its portrait (spec 102 §10; set by the proposal's window). */
    portrait?: { person: PersonId; name: string };
}

/** Names the planner needs from the tree (pure: the caller passes the data). */
export interface SortTreeIndex {
    person(ref: string): { id: PersonId; name: string } | null;
    family(ref: string): { id: PartnershipId; name: string } | null;
    source(ref: string): { id: string; title: string } | null;
}

export function sortTreeIndex(data: StromData, nameOf: (id: PersonId) => string): SortTreeIndex {
    const persons = new Map<string, PersonId>();
    for (const p of Object.values(data.persons)) {
        const ref = researchPersonRef(p.refn);
        if (ref && !persons.has(ref)) persons.set(ref, p.id);
    }
    const families = new Map<string, PartnershipId>();
    for (const ps of Object.values(data.partnerships)) {
        const ref = typeof ps.researchId === 'string' ? ps.researchId.trim() : '';
        if (/^F\d{1,9}$/.test(ref) && !families.has(ref)) families.set(ref, ps.id);
    }
    const sources = new Map<string, string>();
    for (const s of Object.values(data.sources ?? {})) {
        const ref = typeof s.refn === 'string' ? s.refn.trim() : '';
        if (/^S\d{1,9}$/.test(ref) && !sources.has(ref)) sources.set(ref, s.id);
    }
    return {
        person: ref => { const id = persons.get(ref); return id ? { id, name: nameOf(id) } : null; },
        family: ref => {
            const id = families.get(ref);
            if (!id) return null;
            const ps = data.partnerships[id];
            return { id, name: [ps.person1Id, ps.person2Id].filter(Boolean).map(p => nameOf(p as PersonId)).join(' & ') };
        },
        source: ref => { const id = sources.get(ref); return id ? { id, title: data.sources?.[id]?.title || ref } : null; },
    };
}

/** A proposed link as a chip: where it goes in the tree and what it is called. */
export interface SortChipNames {
    event: (tag: string) => string;
    unknown: (ref: string) => string;
    eventLabel: (what: string) => string;
    sourceLabel: (t: string) => string;
    /** A source the tree does not know, made new under the file's title. */
    newSource?: (title: string) => string;
}

/**
 * A proposed link as a chip: where it goes in the tree and what it is called.
 * `title`: the file's proposed title — a source the tree does not know becomes
 * a new source of that name (spec 102 §13, "a new source through §5 without the editor").
 */
export function sortChip(link: SortLink, tree: SortTreeIndex, names: SortChipNames, title?: string): SortChip {
    if (link.type === 'source') {
        const s = tree.source(link.ref);
        if (s) return { link, kind: 'source', person: null, place: { sourceId: s.id }, label: names.sourceLabel(s.title) };
        const name = title?.trim();
        if (name && names.newSource) return { link, kind: 'source', person: null, place: null, label: names.newSource(name), newSource: link.ref };
        return { link, kind: 'source', person: null, place: null, label: names.sourceLabel(names.unknown(link.ref)) };
    }
    if (link.type === 'family' || (link.type === 'event' && link.ref.startsWith('F'))) {
        const f = tree.family(link.ref);
        const label = f ? f.name : names.unknown(link.ref);
        return link.type === 'event'
            ? { link, kind: 'event', person: null, place: f ? { partnershipId: f.id } : null, label: names.eventLabel(`${names.event(link.event ?? '')} · ${label}`) }
            : { link, kind: 'person', person: null, place: f ? { partnershipId: f.id } : null, label };
    }
    const p = tree.person(link.ref);
    const label = p ? p.name : names.unknown(link.ref);
    if (link.type === 'event') {
        const fact = link.event === 'BIRT' ? 'birth' : link.event === 'DEAT' ? 'death' : undefined;
        return { link, kind: 'event', person: link.ref, place: p ? { personId: p.id, ...(fact ? { fact } : {}) } : null, label: names.eventLabel(`${names.event(link.event ?? '')} · ${label}`) };
    }
    return { link, kind: 'person', person: link.ref, place: p ? { personId: p.id } : null, label };
}

/** What the file has now of one detail, and whether a person set it. */
function humanValue<T>(item: MaterialItem | null, field: 'title' | 'date' | 'kind'): T | undefined {
    if (!item) return undefined;
    const att = item.attachment;
    if (att) {
        const value = att[field] as T | undefined;
        const by = field === 'title' ? att.titleBy : field === 'date' ? att.dateBy : att.kindBy;
        return value && by !== 'agent' ? value : undefined;
    }
    // Material outside the tree: what it has came from a person (the research drops proposals over them too).
    const value = item.file?.[field] as T | undefined;
    return value || undefined;
}

/** The proposal's rows: a row per file sent (no proposal: unassigned). */
export function sortRows(job: Pick<SortJob, 'files' | 'proposals'>, itemOf: (id: string) => MaterialItem | null, chip: (link: SortLink, title?: string) => SortChip): SortRow[] {
    const byId = new Map(job.proposals.map(p => [p.id, p]));
    const ids = [...job.files, ...job.proposals.map(p => p.id).filter(id => !job.files.includes(id))];
    const rows = ids.map((id): SortRow => {
        const proposal = byId.get(id) ?? null;
        const item = itemOf(id);
        const row: SortRow = { id, item, proposal, chips: [] };
        if (!proposal) return row;
        // Not about the family: a title or a link for it would only be accepted by mistake.
        if (proposal.unrelated) return { ...row, unrelated: true };
        const field = <T>(name: 'title' | 'date' | 'kind', proposed: T | undefined): SortField<T> | undefined => {
            if (proposed === undefined || proposed === '') return undefined;
            const human = humanValue<T>(item, name);
            if (human !== undefined && human === proposed) return undefined;
            return human !== undefined ? { proposed, human } : { proposed };
        };
        const title = field('title', proposal.title);
        const date = field('date', proposal.date);
        const kind = field<MaterialKind>('kind', proposal.kind);
        if (title) row.title = title;
        if (date) row.date = date;
        if (kind) row.kind = kind;
        const have = new Set(item?.persons ?? []);
        const seen = new Set<string>();
        // A back side the agent proposed something of its own for keeps its own row (no chip then).
        const back = proposal.back && proposal.back !== id && !byId.has(proposal.back) ? itemOf(proposal.back) : null;
        if (back && proposal.back) row.back = { id: proposal.back, item: back };
        for (const link of proposal.links) {
            const key = `${link.type}:${link.ref}:${link.event ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // A person the file already has is no proposal.
            if (link.type === 'person' && have.has(link.ref)) continue;
            row.chips.push(chip(link, proposal.title ?? (item?.titled ? item.title : undefined)));
        }
        return row;
    });
    // A back side goes with its front: its own row only when the agent proposed something of its own for it.
    const backs = new Set(rows.flatMap(r => r.back ? [r.back.id] : []));
    return rows.filter(r => !backs.has(r.id));
}

/**
 * The back side as a row of its own, written with its front (spec 102 §10):
 * the front's date, kind and links, its title with "(back)"; what a person set
 * on the back stays. `choice`: the front's edit carried over.
 */
export function sortBackRow(row: SortRow, rubTitle: (title: string) => string, choice: SortChoice = {}): { row: SortRow; choice: SortChoice } | null {
    if (!row.back) return null;
    const item = row.back.item;
    const out: SortRow = { id: row.back.id, item, proposal: row.proposal, chips: [] };
    const field = <T>(name: 'title' | 'date' | 'kind', proposed: T | undefined): SortField<T> | undefined =>
        proposed === undefined || proposed === '' || humanValue<T>(item, name) !== undefined ? undefined : { proposed };
    const frontTitle = row.title && (row.title.human === undefined || choice.use?.title) ? row.title.proposed : undefined;
    const title = field('title', frontTitle ? rubTitle(frontTitle) : undefined);
    const date = field('date', row.date && (row.date.human === undefined || choice.use?.date) ? row.date.proposed : undefined);
    const kind = field<MaterialKind>('kind', row.kind && (row.kind.human === undefined || choice.use?.kind) ? row.kind.proposed : undefined);
    if (title) out.title = title;
    if (date) out.date = date;
    if (kind) out.kind = kind;
    const have = new Set(item.persons);
    const keep = (chips: readonly SortChip[]) => chips.filter(c => !(c.link.type === 'person' && have.has(c.link.ref)));
    out.chips = keep(row.chips);
    const e = choice.edit;
    if (!e) return { row: out, choice: {} };
    return {
        row: out,
        choice: { edit: {
            ...(e.title !== undefined ? { title: e.title ? rubTitle(e.title) : '' } : {}),
            ...(e.date !== undefined ? { date: e.date } : {}),
            ...(e.kind !== undefined ? { kind: e.kind } : {}),
            ...(e.chips ? { chips: keep(e.chips) } : {}),
        } },
    };
}

/** The row proposes something (else it is unassigned: nothing to accept). */
export function sortRowProposes(row: SortRow): boolean {
    return !!(row.title || row.date || row.kind || row.chips.length || row.back || row.portrait);
}

/**
 * The files the agent said are not about the family that Hide… takes now
 * (one confirmation, reason "Not about the family"): the research's files,
 * not hidden yet, not placed in the tree (a file in the tree is removed from
 * it instead). Nothing is hidden by itself.
 */
export function sortUnrelatedHideable(rows: readonly SortRow[]): MaterialItem[] {
    return rows.filter(r => r.unrelated).map(r => r.item)
        .filter((i): i is MaterialItem => !!i && i.origin !== 'tree' && !!i.file && !i.hidden && !i.attachment?.places?.length);
}

/** What the row writes when accepted; `use` takes a field over a person's value on purpose; `edit` replaces the proposal. */
export interface SortChoice {
    use?: { title?: boolean; date?: boolean; kind?: boolean };
    edit?: { title?: string; date?: string; kind?: MaterialKind | ''; chips?: SortChip[] };
}

export interface SortWrite {
    id: string;
    /** A file of the tree: its id (written with the tree). */
    mediaId: string | null;
    /** Material outside the tree: its I… (written through the bridge). */
    fileId: string | null;
    title?: { value: string; by: 'user' | 'agent' };
    date?: { value: string; by: 'user' | 'agent' };
    kind?: { value: MaterialKind | ''; by: 'user' | 'agent' };
    /**
     * Places in the tree: of the tree's file; of material outside the tree the
     * links the research's assign does not carry (an event, a couple, a source,
     * a person without the research's REFN) — it becomes a file of the tree (§4).
     */
    places: MediaPlace[];
    /** People of material outside the tree (REFN, `/material/assign`). */
    persons: string[];
    /** Sources the tree does not know: made new (title) and the file placed there. */
    newSources: Array<{ ref: string; title: string }>;
}

/** Accepting a row: the details that change (never a person's, unless used or edited on purpose) and the links. */
export function sortWrite(row: SortRow, choice: SortChoice = {}): SortWrite | null {
    if (!row.item) return null;
    const out: SortWrite = {
        id: row.id,
        mediaId: row.item.attachment && !row.item.removedId ? row.item.attachment.id : null,
        fileId: row.item.attachment && !row.item.removedId ? null : row.item.file?.id ?? null,
        places: [], persons: [], newSources: [],
    };
    const e = choice.edit;
    const pick = <T>(name: 'title' | 'date' | 'kind', f: SortField<T> | undefined, edited: T | undefined): { value: T; by: 'user' | 'agent' } | undefined => {
        if (edited !== undefined) return { value: edited, by: 'user' };
        if (!f) return undefined;
        if (f.human !== undefined && !choice.use?.[name]) return undefined;
        return { value: f.proposed, by: 'agent' };
    };
    const title = pick('title', row.title, e?.title);
    const date = pick('date', row.date, e?.date);
    const kind = pick<MaterialKind | ''>('kind', row.kind, e?.kind);
    if (title) out.title = title;
    if (date) out.date = date;
    if (kind) out.kind = kind;
    const by = e?.chips ? 'user' : 'agent';
    const newTitle = (out.title?.value || row.title?.proposed || (row.item.titled ? row.item.title : '') || row.item.name || '').trim();
    for (const c of e?.chips ?? row.chips) {
        if (c.newSource) {
            if (newTitle && !out.newSources.some(x => x.ref === c.newSource)) out.newSources.push({ ref: c.newSource, title: newTitle });
            continue;
        }
        if (out.mediaId) {
            if (c.place) out.places.push({ ...c.place, by });
            continue;
        }
        // Material outside the tree: its people through the research (an event's person too) ...
        if (c.person && (c.kind === 'person' || c.kind === 'event') && !out.persons.includes(c.person)) out.persons.push(c.person);
        // ... and what the research's assign does not carry, in the tree (an event, a couple, a source, a person it does not know).
        if (!c.place) continue;
        const plain = 'personId' in c.place && !c.place.fact && !c.place.eventId;
        if (c.kind === 'source' || !c.person || !plain) out.places.push({ ...c.place, by });
    }
    if (!out.title && !out.date && !out.kind && !out.places.length && !out.persons.length && !out.newSources.length) return null;
    return out;
}

/**
 * What undoes an accepted row ("Undo" under Done, spec 102 §13): the tree's
 * file as it was (its details, the places added, a file made by the
 * acceptance taken out, sources made for it removed), material outside the
 * tree written back through the bridge (the research's `was`, the people added).
 */
export interface SortRevert {
    /** The tree's file written. */
    media?: string;
    /** The tree's file was made by the acceptance (a working copy): undoing takes it out. */
    created?: boolean;
    /** The tree's file's details before ('' = none; agent: the agent's). */
    fields?: { title?: SortRevertField; kind?: SortRevertField; date?: SortRevertField };
    /** Places added to the tree's file. */
    places?: MediaPlace[];
    /** Sources made by the acceptance. */
    sources?: string[];
    /** Material outside the tree: the research's details before ('' = none). */
    was?: { title?: string; kind?: string; date?: string };
    /** People added in the research (REFN). */
    persons?: string[];
}

export interface SortRevertField {
    value: string;
    agent?: boolean;
}

function revertPlace(raw: unknown): MediaPlace | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
    const by: { by?: MediaBy } = o.by === 'agent' || o.by === 'user' ? { by: o.by } : {};
    if (str(o.personId)) {
        const fact: { fact?: 'birth' | 'death' } = o.fact === 'birth' || o.fact === 'death' ? { fact: o.fact } : {};
        const ev = str(o.eventId) ? { eventId: o.eventId as string } : {};
        return { personId: o.personId as PersonId, ...fact, ...ev, ...by };
    }
    if (str(o.partnershipId)) return { partnershipId: o.partnershipId as PartnershipId, ...(str(o.eventId) ? { eventId: o.eventId as string } : {}), ...by };
    if (str(o.sourceId)) return { sourceId: o.sourceId as string, ...by };
    return null;
}

/** A remembered revert as stored (anything off: dropped — no undo rather than a wrong one). */
export function parseSortRevert(raw: unknown): SortRevert | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const out: SortRevert = {};
    const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 2000) : undefined;
    if (typeof o.media === 'string' && o.media) out.media = o.media;
    if (o.created === true && out.media) out.created = true;
    if (o.fields && typeof o.fields === 'object' && out.media) {
        const f = o.fields as Record<string, unknown>;
        const fields: NonNullable<SortRevert['fields']> = {};
        for (const k of ['title', 'kind', 'date'] as const) {
            const v = f[k] as Record<string, unknown> | undefined;
            const value = v && typeof v === 'object' ? text(v.value) : undefined;
            if (value !== undefined) fields[k] = { value, ...(v!.agent === true ? { agent: true } : {}) };
        }
        if (Object.keys(fields).length) out.fields = fields;
    }
    if (Array.isArray(o.places) && out.media) {
        const places = o.places.map(revertPlace).filter((p): p is MediaPlace => !!p).slice(0, 40);
        if (places.length) out.places = places;
    }
    if (Array.isArray(o.sources)) {
        const ids = o.sources.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 20);
        if (ids.length) out.sources = ids;
    }
    if (o.was && typeof o.was === 'object') {
        const w = o.was as Record<string, unknown>;
        const was: NonNullable<SortRevert['was']> = {};
        for (const k of ['title', 'kind', 'date'] as const) { const v = text(w[k]); if (v !== undefined) was[k] = v; }
        if (Object.keys(was).length) out.was = was;
    }
    if (Array.isArray(o.persons)) {
        const refs = o.persons.filter((x): x is string => typeof x === 'string' && /^P\d{1,9}$/.test(x)).slice(0, 40);
        if (refs.length) out.persons = refs;
    }
    return Object.keys(out).length ? out : null;
}

// ==================== FILES DELETED FOR GOOD (spec 102 §9, §12) ====================

/** A sorting without the files deleted for good: they leave its files, its proposals and its files without one. */
export function sortJobWithout(job: SortJob, gone: readonly string[]): SortJob {
    if (!gone.length) return job;
    const out = new Set(gone);
    if (!job.files.some(f => out.has(f)) && !job.proposals.some(p => out.has(p.id)) && !job.unproposed?.some(u => out.has(u.id))) return job;
    return {
        ...job,
        files: job.files.filter(f => !out.has(f)),
        proposals: job.proposals.filter(p => !out.has(p.id)),
        ...(job.unproposed ? { unproposed: job.unproposed.filter(u => !out.has(u.id)) } : {}),
    };
}

/** The most files deleted for good a remembered sorting keeps (a run's largest). */
export const SORT_GONE_MAX = 1500;

/**
 * The remembered sorting without files deleted for good (spec 102 §12): they
 * leave the batch sent, each batch of the run and what was decided here;
 * kept as gone so proposals read before stay hidden and a batch whose every
 * file went counts as none (the research skips it). Null: none of them was
 * in it.
 */
export function sortRememberedWithout(r: ResearchSortRemembered, gone: readonly string[]): ResearchSortRemembered | null {
    const out = new Set(gone);
    const hit = (ids: readonly string[]) => ids.some(f => out.has(f));
    if (!hit(r.files) && !hit(r.run?.batches.flat() ?? []) && !hit(Object.keys(r.decided)) && !(r.earlier?.length && gone.length)) return null;
    const decided = Object.fromEntries(Object.entries(r.decided).filter(([k]) => !out.has(k)));
    const reverts = r.reverts ? Object.fromEntries(Object.entries(r.reverts).filter(([k]) => !out.has(k))) : undefined;
    return {
        ...r,
        files: r.files.filter(f => !out.has(f)),
        decided,
        ...(reverts ? { reverts } : {}),
        // A batch left without files keeps them (an empty batch is not stored, and the indices name the research's batches).
        ...(r.run ? { run: { ...r.run, batches: r.run.batches.map(b => (b.every(f => out.has(f)) ? b : b.filter(f => !out.has(f)))) } } : {}),
        gone: [...new Set([...(r.gone ?? []), ...gone])].slice(-SORT_GONE_MAX),
    };
}
