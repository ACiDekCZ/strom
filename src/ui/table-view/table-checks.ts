/**
 * Table view (spec 073 §7): the tree's findings on the cells.
 *
 * The Data quality check (`validateTreeData`) runs once for the whole tree;
 * each finding is mapped here to the cells it is about (§7.2): its people's
 * rows, the column the type names (or the fact its `field` names) and, for a
 * finding of a union, that union's cells. A finding marked "Not an error"
 * (`qualityDismissed`, the same marks Data quality reads) stays on its cells
 * as "unusual" (☆) and is no longer counted as a finding (§7.5).
 *
 * The Findings, Highest level and Unusual columns read the person's summary.
 * Nothing here touches the DOM.
 */

import type { ValidationIssue } from '../../validation.js';
import { qualityFinding, qualityFindingKey } from '../../validation.js';
import { dismissedKeys } from '../../quality-dismiss.js';
import { placeKey } from '../../places.js';
import { participantName } from '../../godparents.js';
import { parentSlots, type ParticipantRole, type Partnership, type Person, type StromData } from '../../types.js';
import type { CellSeverity, EventRow, TableModel, TableRow } from './table-model.js';

/** One cell a finding is about: a row of People, Unions or Events, a column, the union of a union column. */
export interface CheckTarget {
    rows: 'persons' | 'unions' | 'events';
    /** The person's or the union's id; an event row's: `l:<person>:<event>` (a person's event). */
    id: string;
    /**
     * The column id; in the Unions table a partner's column is `age@<person>`,
     * `rec@<person>` (resolved against the row's Partner 1 and 2 when looked up).
     */
    col: string;
    /** People table: the union a union column of the row belongs to. */
    union?: string;
}

/** A finding as the cells see it. */
export interface CellFinding {
    issue: ValidationIssue;
    /** The finding's key (qualityFindingKey): what "Not an error" marks. */
    key: string;
    dismissed: boolean;
    /** The mark: the finding's level, `unusual` when marked "Not an error". */
    severity: CellSeverity;
}

/** A person's findings (§7.2 "all": Findings, Highest level, Unusual). */
export interface PersonFindings {
    /** Findings still reported (not marked "Not an error"), traces included. */
    n: number;
    /** The highest level of those; null when there is none. */
    top: 'error' | 'warning' | 'info' | null;
    /** Findings marked "Not an error". */
    unusual: number;
}

const RANK: Record<CellSeverity, number> = { error: 3, warning: 2, info: 1, unusual: 0 };

/** Which mark wins in one cell: a reported finding by its level, a marked one last. */
export function severityRank(s: CellSeverity): number {
    return RANK[s];
}

/** Event columns of the People table by the event's type (§7.2: eventBeforeBirth, eventAfterDeath). */
const EVENT_COLUMNS: Readonly<Record<string, string>> = {
    occupation: 'occ', residence: 'res', religion: 'rel', military: 'mil', emigration: 'emi', education: 'edu',
    baptism: 'bapDate', burial: 'burDate',
};

/** Place columns (§7.2 placeSpelling): every place cell whose value is the place. */
const PLACE_COLUMNS: ReadonlySet<string> = new Set(['bPlace', 'bapPlace', 'wPlace', 'divPlace', 'dPlace', 'burPlace', 'evPlace']);

/** The Events table's participant columns and their roles (§14.1, recurringGodparent). */
const PARTICIPANT_ROLE: Readonly<Record<string, ParticipantRole>> = {
    godparents: 'godparent', witnesses: 'witness', officiants: 'officiant', others: 'other',
};

/** The types about a parent's age at a child's birth: the mark goes on the child's Father's / Mother's age. */
const PARENT_AGE_TYPES: ReadonlySet<string> = new Set([
    'parentYoungerThanChild', 'parentTooYoung', 'parentTooOld',
    'motherTooYoung16', 'motherTooOld45', 'fatherTooYoung18', 'fatherTooOld60',
]);

/** The types about a person's age at a wedding (§7.2): the age cells of the union, the date for a wedding out of the lifespan. */
const WEDDING_TYPES: ReadonlySet<string> = new Set(['weddingBeforeBirth', 'weddingAfterDeath', 'childMarriage', 'marriageUnder16']);

function otherOf(u: Partnership | undefined, id: string): string | null {
    if (!u) return null;
    return u.person1Id === id ? u.person2Id : u.person2Id === id ? u.person1Id : null;
}

/** Father's or Mother's age column of a child for one of its parents (the slots the table reads, parentSlots). */
function parentAgeColumn(data: StromData, child: Person | undefined, parentId: string): string | null {
    if (!child) return null;
    const parents = child.parentIds.map(id => data.persons[id]).filter((p): p is Person => !!p);
    const [father, mother] = parentSlots(parents);
    if (mother?.id === parentId) return 'mAge';
    if (father?.id === parentId) return 'fAge';
    return null;
}

/**
 * The cells a finding is about (§7.2). A place written several ways is
 * matched by the cell's value instead (placeSpelling, see CheckIndex). Types
 * with no cell of their own (cycles, references…) give none: the finding is
 * seen in the Findings column of its people.
 */
export function issueTargets(issue: ValidationIssue, data: StromData): CheckTarget[] {
    const ids = issue.personIds ?? [];
    const uid = issue.partnershipIds?.[0];
    const u = uid ? data.partnerships[uid] : undefined;
    const P = (id: string | null | undefined, col: string | null, union?: string): CheckTarget[] =>
        id && col ? [{ rows: 'persons', id, col, ...(union ? { union } : {}) }] : [];
    const U = (col: string): CheckTarget[] => (uid && u ? [{ rows: 'unions', id: uid, col }] : []);
    const t = issue.type;
    if (t === 'deathBeforeBirth') return [...P(ids[0], 'bDate'), ...P(ids[0], 'dDate'), ...P(ids[0], 'dAge')];
    if (t === 'implausibleLifespan') return P(ids[0], 'dAge');
    if (WEDDING_TYPES.has(t)) {
        const p = ids[0];
        if (!p || !uid) return [];
        const q = otherOf(u, p);
        const dated = t === 'weddingBeforeBirth' || t === 'weddingAfterDeath';
        return [
            ...(dated ? P(p, 'wDate', uid) : []), ...P(p, 'wAge', uid), ...P(q, 'pAge', uid),
            ...(dated ? U('wDate') : []), ...U(`age@${p}`),
        ];
    }
    if (t === 'childAfterMotherDeath' || t === 'childAfterFatherDeath' || t === 'childAfterParentDeath') {
        const [child, parent] = ids;
        return [...P(child, 'bDate'), ...P(child, parentAgeColumn(data, data.persons[child], parent)), ...P(parent, 'dDate')];
    }
    if (PARENT_AGE_TYPES.has(t)) {
        const [parent, child] = ids;
        return P(child, parentAgeColumn(data, data.persons[child], parent));
    }
    if (t === 'recordedAgeMismatch') {
        const p = ids[0];
        if (issue.field === 'death') return [...P(p, 'dAgeRec'), ...P(p, 'dAgeDiff')];
        if (issue.field !== 'wedding' || !p || !uid) return [];
        const q = otherOf(u, p);
        return [...P(p, 'wAgeRec', uid), ...P(p, 'wAgeDiff', uid), ...P(q, 'pAgeRec', uid), ...P(q, 'pAgeDiff', uid), ...U(`rec@${p}`)];
    }
    if (t === 'eventBeforeBirth' || t === 'eventAfterDeath') {
        return [...P(ids[0], issue.field ? EVENT_COLUMNS[issue.field] ?? null : null), ...eventTargets(issue, data)];
    }
    if (t === 'partnerAgeGap') {
        if (!uid) return [];
        return [...ids.flatMap(id => P(id, 'partner', uid)), ...U('p2')];
    }
    if (t === 'possibleDuplicate') return ids.flatMap(id => P(id, 'name'));
    return [];
}

/**
 * The Events table's date cell of a person's event out of the lifespan: the
 * events of the finding's type whose date the finding's detail names
 * (validation writes "<type> <date> < * …" / "> † …").
 */
function eventTargets(issue: ValidationIssue, data: StromData): CheckTarget[] {
    const pid = issue.personIds?.[0];
    const person = pid ? data.persons[pid] : undefined;
    if (!person || !issue.field) return [];
    const detail = issue.detail ?? '';
    return (person.events ?? [])
        .filter(ev => ev.type === issue.field && ev.date
            && detail.startsWith(`${ev.type === 'custom' ? (ev.customLabel?.trim() || 'custom') : ev.type} ${ev.date} `))
        .map(ev => ({ rows: 'events' as const, id: `l:${person.id}:${ev.id}`, col: 'evDate' }));
}

function cellKey(rows: 'persons' | 'unions' | 'events', id: string, col: string, union?: string | null): string {
    return `${rows === 'persons' ? 'p' : rows === 'unions' ? 'u' : 'e'}|${id}|${col}|${union ?? ''}`;
}

/**
 * The cells of the People and Unions tables an event row's cell stands for
 * (§14.1: the findings of the facts it shows), and its own cells.
 */
function eventCellKeys(row: EventRow, colId: string): string[] {
    const pid = row.persons[0]?.id;
    const uid = row.union?.id;
    if (colId === 'evDate') {
        if (row.source === 'birth' && pid) return [cellKey('persons', pid, 'bDate')];
        if (row.source === 'death' && pid) return [cellKey('persons', pid, 'dDate')];
        if (row.source === 'marriage' && uid) return [cellKey('unions', uid, 'wDate')];
        if (row.source === 'life') return row.refs.map(r => cellKey('events', `l:${r.personId}:${r.eventId}`, 'evDate'));
    }
    if (colId === 'evAge') {
        if (row.source === 'death' && pid) return [cellKey('persons', pid, 'dAge')];
        if (row.source === 'marriage' && uid) return row.persons.map(p => cellKey('unions', uid, `age@${p.id}`));
    }
    return [];
}

/** A participant's name as recurringGodparent names it: a linked person's full name, else the written name's key. */
function participantKeys(data: StromData, x: { personId?: string; name?: string }): string[] {
    const p = x.personId ? data.persons[x.personId as Person['id']] : undefined;
    if (p) return [`p:${`${p.firstName} ${p.lastName}`.trim()}`];
    const key = participantName(x.name ?? '').key;
    return key ? [`n:${key}`] : [];
}

/** The Unions table's per-partner columns: the slot and which partner of the row. */
const UNION_PARTNER_COLUMNS: Readonly<Record<string, [string, 1 | 2]>> = {
    age1: ['age', 1], age2: ['age', 2], rec1: ['rec', 1], rec2: ['rec', 2],
};

/** The best of several findings in one cell: a reported one by its level, else a marked one. */
function topOf(list: readonly CellFinding[] | undefined): CellFinding | null {
    if (!list?.length) return null;
    let best = list[0];
    for (const f of list) if (RANK[f.severity] > RANK[best.severity]) best = f;
    return best;
}

/**
 * The findings of one tree mapped to cells and people. Built in batches
 * (`add`), so a large tree's mapping can be spread over idle time; `version`
 * changes with every build, for the caches that depend on it.
 */
export class CheckIndex {
    private static next = 0;
    readonly version = ++CheckIndex.next;
    readonly issues: ValidationIssue[] = [];
    private readonly cells = new Map<string, CellFinding[]>();
    private readonly people = new Map<string, PersonFindings>();
    /** placeSpelling: the place's key → its findings. */
    private readonly places = new Map<string, CellFinding[]>();
    /** recurringGodparent: the participant's name key (`p:` linked, `n:` written) → its findings. */
    private readonly recurring = new Map<string, CellFinding[]>();
    private readonly dismissed: ReadonlySet<string>;

    constructor(private readonly data: StromData) {
        this.dismissed = dismissedKeys(data);
    }

    /** Map more findings (in the order validateTreeData gave them). */
    add(issues: readonly ValidationIssue[]): void {
        for (const issue of issues) {
            this.issues.push(issue);
            const key = qualityFindingKey(qualityFinding(issue));
            const dismissed = this.dismissed.has(key);
            const f: CellFinding = { issue, key, dismissed, severity: dismissed ? 'unusual' : issue.severity };
            if (issue.type === 'placeSpelling' && issue.subject) {
                const k = placeKey(issue.subject);
                if (k) (this.places.get(k) ?? this.places.set(k, []).get(k)!).push(f);
            }
            if (issue.type === 'recurringGodparent' && issue.subject) {
                const keys = new Set([`p:${issue.subject.trim()}`, ...participantKeys(this.data, { name: issue.subject })]);
                for (const k of keys) (this.recurring.get(k) ?? this.recurring.set(k, []).get(k)!).push(f);
            }
            for (const t of issueTargets(issue, this.data)) {
                const k = cellKey(t.rows, t.id, t.col, t.union);
                const list = this.cells.get(k);
                if (!list) this.cells.set(k, [f]);
                else if (!list.includes(f)) list.push(f);
            }
            for (const id of new Set(issue.personIds ?? [])) {
                const s = this.people.get(id) ?? { n: 0, top: null, unusual: 0 };
                if (dismissed) s.unusual++;
                else {
                    s.n++;
                    if (!s.top || RANK[issue.severity] > RANK[s.top]) s.top = issue.severity;
                }
                this.people.set(id, s);
            }
        }
    }

    /** A person's findings (none: zeros). */
    person(id: string): PersonFindings {
        return this.people.get(id) ?? { n: 0, top: null, unusual: 0 };
    }

    /**
     * The finding shown in a cell: the People table's `union` is the union a
     * union column of the row reads; `text` is the cell's value (a place
     * column matches a place written several ways by it). Null: no finding.
     */
    cell(row: TableRow, colId: string, union: Partnership | null, text = ''): CellFinding | null {
        let list: CellFinding[] | undefined;
        if (row.kind === 'person') {
            list = this.cells.get(cellKey('persons', row.id, colId, union?.id));
        } else if (row.kind === 'event') {
            list = this.eventFindings(row, colId);
        } else {
            const partner = UNION_PARTNER_COLUMNS[colId];
            const p = partner ? (partner[1] === 1 ? row.p1 : row.p2) : null;
            const col = partner ? (p ? `${partner[0]}@${p.id}` : '') : colId;
            if (col) list = this.cells.get(cellKey('unions', row.id, col));
        }
        let best = topOf(list);
        if (PLACE_COLUMNS.has(colId) && text && this.places.size) {
            const place = topOf(this.places.get(placeKey(text)));
            if (place && (!best || RANK[place.severity] > RANK[best.severity])) best = place;
        }
        return best;
    }

    /** All findings of a cell, the shown one first (the bubble steps through them). */
    cellAll(row: TableRow, colId: string, union: Partnership | null, text = ''): CellFinding[] {
        const out: CellFinding[] = [];
        if (row.kind === 'person') out.push(...(this.cells.get(cellKey('persons', row.id, colId, union?.id)) ?? []));
        else if (row.kind === 'event') out.push(...this.eventFindings(row, colId));
        else {
            const partner = UNION_PARTNER_COLUMNS[colId];
            const p = partner ? (partner[1] === 1 ? row.p1 : row.p2) : null;
            const col = partner ? (p ? `${partner[0]}@${p.id}` : '') : colId;
            if (col) out.push(...(this.cells.get(cellKey('unions', row.id, col)) ?? []));
        }
        if (PLACE_COLUMNS.has(colId) && text) out.push(...(this.places.get(placeKey(text)) ?? []));
        return out.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
    }

    /**
     * The findings of an event row's cell (§14.1): those of the facts it
     * shows (the birth's, the wedding's… cells), a person's event out of the
     * lifespan on its date, a recurring godparent on the participant's name
     * in the participants' column of the role. Each finding once.
     */
    private eventFindings(row: EventRow, colId: string): CellFinding[] {
        const out: CellFinding[] = [];
        const push = (list: readonly CellFinding[] | undefined) => {
            for (const f of list ?? []) if (!out.includes(f)) out.push(f);
        };
        for (const k of eventCellKeys(row, colId)) push(this.cells.get(k));
        const role = PARTICIPANT_ROLE[colId];
        if (role && this.recurring.size) {
            for (const x of row.participants) {
                if (x.role !== role) continue;
                for (const k of participantKeys(this.data, x)) push(this.recurring.get(k));
            }
        }
        return out;
    }
}

/** Map all findings at once (tests, small trees). */
export function buildCheckIndex(data: StromData, issues: readonly ValidationIssue[]): CheckIndex {
    const index = new CheckIndex(data);
    index.add(issues);
    return index;
}

/** The columns whose cells read the person's findings (cached cells dropped when the findings change). */
export const CHECK_COLUMNS: readonly string[] = ['nFind', 'topSev', 'unusual'];

/**
 * Give the model the findings to show (null: the checks run). The cached
 * cells of the check columns are dropped when the findings change, so the
 * next read (and a sort by them) sees the new ones.
 */
export function applyChecks(model: TableModel, checks: CheckIndex | null): boolean {
    if (model.ctx.checks === checks) return false;
    model.ctx.checks = checks;
    for (const row of model.persons) for (const col of CHECK_COLUMNS) row.cache.delete(col);
    return true;
}

/** The highest mark among a row's cells of some columns (§4.3: a collapsed group's band). */
export function bandSeverity(index: CheckIndex | null, row: TableRow, colIds: readonly string[],
    unionOf: (colId: string) => Partnership | null, textOf: (colId: string) => string): CellSeverity | null {
    if (!index) return null;
    let best: CellSeverity | null = null;
    for (const id of colIds) {
        const f = index.cell(row, id, unionOf(id), PLACE_COLUMNS.has(id) ? textOf(id) : '');
        if (f && (best === null || RANK[f.severity] > RANK[best])) best = f.severity;
    }
    return best;
}

export function isPlaceColumn(colId: string): boolean {
    return PLACE_COLUMNS.has(colId);
}
