/**
 * Re-verification of facts (spec 065): what is known of a fact's
 * confirmation and verification, and which actions it offers.
 *
 * Two sources:
 * - a confirmation made in the app by hand ("Verified from the scan"):
 *   Person/Partnership.confirmed, valid while the fact keeps the value it was
 *   confirmed with;
 * - the research's own state of the fact (GEDCOM `_STROM_CONFIRMED`,
 *   `_STROM_VERIFY`, `_STROM_CHECKED` under it): Person/Partnership.researchVerify;
 *   its confirmation too is valid while the fact keeps the value the
 *   research's file gave it with (a change here ends it).
 *
 * Pure: no DOM, no storage.
 */

import type {
    StromData, FactConfirmation, FactVerifyPending, FactVerifyChecked, ResearchFactVerify, Person, Partnership,
} from './types.js';
import { FactHolder, factValueSignature, factsOf, isPartnership } from './import-origin.js';

export { factValueSignature };

/** The GEDCOM tags under a fact (level 2). */
export const CONFIRMED_TAG = '_STROM_CONFIRMED';
export const VERIFY_TAG = '_STROM_VERIFY';
export const CHECKED_TAG = '_STROM_CHECKED';
/** The fact's id in the research (`2 _STROM_EID E0012`), research files only. */
export const EID_TAG = '_STROM_EID';

/** The bridge features of 065 (in /status.features). */
export const VERIFY_FEATURE = 'verify';
export const VERIFY_BULK_FEATURE = 'verify.bulk';
export const FACTS_CONFIRM_FEATURE = 'facts.confirm';
/** POST /verify/stop: drop the re-verification tasks not yet begun. */
export const VERIFY_STOP_FEATURE = 'verify.stop';

export const VERIFY_PENDING: readonly FactVerifyPending[] = ['wait', 'asked', 'images', 'permission'];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const READERS_MAX = 99;
/** The highest place in the research's queue kept (`3 _POS n`). */
const POSITION_MAX = 1_000_000;
const WHY_MAX = 1000;
const DATE_MAX = 40;

/**
 * The hand confirmation of a fact while it is valid: the fact still has the
 * value it was confirmed with (one with no stored value: while the fact has
 * any value). null otherwise.
 */
export function factConfirmation(holder: FactHolder, fact: string): FactConfirmation | null {
    const c = holder.confirmed?.[fact];
    if (!c || c.withdrawn) return null;
    const now = factValueSignature(holder, fact);
    if (now === '') return null;
    if (c.value !== undefined && c.value !== now) return null;
    return c;
}

/**
 * The day of the research's confirmation of a fact while it is valid: the
 * fact still has the value the research's file gave with it (an entry with
 * no stored value: while the fact has any value). null otherwise — none, or
 * the value changed here since.
 */
export function researchConfirmation(holder: FactHolder, fact: string): string | null {
    const v = holder.researchVerify?.[fact];
    if (!v?.confirmed) return null;
    const now = factValueSignature(holder, fact);
    if (now === '') return null;
    if (v.value !== undefined && v.value !== now) return null;
    return v.confirmed;
}

/** What is known of a fact's confirmation and verification. */
export interface FactVerifyInfo {
    /** The day it was confirmed by a person (`YYYY-MM-DD`). */
    confirmed?: string;
    /** Where the confirmation was made: in the app by hand, or in the research. */
    confirmedBy?: 'app' | 'research';
    /** It waits for re-verification in the research, and why. */
    pending?: FactVerifyPending;
    /** The research's last re-verification. */
    checked?: FactVerifyChecked;
}

/** The research's confirmation of a fact is taken back here (FactConfirmation.withdrawn of its day). */
export function researchConfirmationWithdrawn(holder: FactHolder, fact: string): boolean {
    const c = holder.confirmed?.[fact];
    const research = holder.researchVerify?.[fact]?.confirmed;
    return !!c?.withdrawn && !!research && c.at === research;
}

/**
 * The confirmation and verification of one fact. A confirmation in the app
 * (still valid) wins over the research's; one of the research's taken back
 * here, or whose value changed here since, is none.
 */
export function factVerifyInfo(holder: FactHolder, fact: string): FactVerifyInfo {
    const out: FactVerifyInfo = {};
    const local = factConfirmation(holder, fact);
    const research = holder.researchVerify?.[fact];
    const researchDay = researchConfirmation(holder, fact);
    if (local) {
        out.confirmed = local.at;
        out.confirmedBy = 'app';
    } else if (researchDay && !researchConfirmationWithdrawn(holder, fact)) {
        out.confirmed = researchDay;
        out.confirmedBy = 'research';
    }
    if (research?.pending) out.pending = research.pending;
    if (research?.checked) out.checked = { ...research.checked };
    return out;
}

/**
 * The confirmations a holder hands over (`2 _STROM_CONFIRMED <day>` under the
 * fact, in what goes to the research and in the app's own file): each
 * confirmed fact with the day factVerifyInfo gives — a valid confirmation of
 * the app, else the research's while its value is unchanged and not taken
 * back here.
 */
export function handedConfirmations(holder: FactHolder): Record<string, string> {
    const out: Record<string, string> = {};
    const facts = new Set([...Object.keys(holder.confirmed ?? {}), ...Object.keys(holder.researchVerify ?? {})]);
    for (const fact of [...facts].sort()) {
        const day = factVerifyInfo(holder, fact).confirmed;
        if (day) out[fact] = day;
    }
    return out;
}

/**
 * How the confirmations handed over differ from the research's own (the
 * research's file the tree was loaded from): per fact the day handed over, ''
 * for one of the research's taken back or ended by a value changed here (it
 * goes without its `_STROM_CONFIRMED`). What the research reads as the
 * user's edit against `_STROM_HEAD`; empty when nothing was confirmed, taken
 * back or changed here (also when a confirmation of the app has ended with a
 * changed value).
 */
export function confirmationEdits(holder: FactHolder): Record<string, string> {
    const out: Record<string, string> = {};
    const handed = handedConfirmations(holder);
    const facts = new Set([...Object.keys(handed), ...Object.keys(holder.researchVerify ?? {})]);
    for (const fact of [...facts].sort()) {
        const now = handed[fact] ?? '';
        if (now !== (holder.researchVerify?.[fact]?.confirmed ?? '')) out[fact] = now;
    }
    return out;
}

/** Readers of the record that agreed in the research's last check (`proven` only). */
export function factVerifyReaders(holder: FactHolder, fact: string): number | undefined {
    const checked = holder.researchVerify?.[fact]?.checked;
    return checked?.result === 'proven' && checked.readers ? checked.readers : undefined;
}

/** A person's id in the research (its REFN, e.g. "P0012"), or null. */
export function researchPersonRef(refn: unknown): string | null {
    return typeof refn === 'string' && /^P\d{1,7}$/.test(refn.trim()) ? refn.trim() : null;
}

/** A family's id in the research (its record, e.g. "F0054"), or null. */
export function researchFamilyRef(id: unknown): string | null {
    return typeof id === 'string' && /^F\d{1,7}$/.test(id.trim()) ? id.trim() : null;
}

/**
 * The person's id in the research for /verify {person} (its REFN "P0012",
 * written by the research as `1 REFN` with `2 TYPE strom-research`), or
 * null: a person made here, or a tree not from the research.
 */
export function personResearchRef(person: Pick<Person, 'refn'>): string | null {
    return researchPersonRef(person.refn);
}

/**
 * The couple's id in the research for /verify {family} (its record "F0003",
 * kept from the research's file in Partnership.researchId), or null: a
 * couple made here, or a tree not from the research.
 */
export function familyResearchRef(partnership: Pick<Partnership, 'researchId'>): string | null {
    return researchFamilyRef(partnership.researchId);
}

/** A fact's id in the research ("E0012"), or null. */
export function researchFactRef(id: unknown): string | null {
    return typeof id === 'string' && /^E\d{1,9}$/.test(id.trim()) ? id.trim() : null;
}

/**
 * The fact's id in the research (`2 _STROM_EID`), for /verify {fact} and
 * /facts/confirm; null when the research's file gave none (a fact made or
 * copied here, a file of a research before 065, another file).
 */
export function factResearchEid(holder: FactHolder, fact: string): string | null {
    return researchFactRef(holder.researchVerify?.[fact]?.eid);
}

/**
 * The fact's place in the research's queue of re-verification (`3 _POS n`
 * under `_STROM_VERIFY wait|asked`: 1 = the next session takes it), as of
 * the research's last file; null when it waits for a person or is not said.
 */
export function factPendingPosition(holder: FactHolder, fact: string): number | null {
    const v = holder.researchVerify?.[fact];
    return v?.position && (v.pending === 'wait' || v.pending === 'asked') ? v.position : null;
}

/** The facts of a holder that wait for re-verification in the research. */
export function pendingFacts(holder: FactHolder): string[] {
    return Object.entries(holder.researchVerify ?? {}).filter(([, v]) => !!v?.pending).map(([fact]) => fact);
}

/** The sources cited for one fact (its own citation list; a person's name and sex: the person's). */
export function factSourceIds(holder: FactHolder, fact: string): string[] {
    const own = (): string[] => {
        if (fact.startsWith('event:')) {
            const id = fact.slice(6);
            return (holder.events ?? []).find(e => e?.id === id)?.sourceIds ?? [];
        }
        if (isPartnership(holder)) return fact === 'marriage' ? holder.sourceIds ?? [] : [];
        if (fact === 'birth') return holder.birthSourceIds ?? [];
        if (fact === 'death') return holder.deathSourceIds ?? [];
        return holder.sourceIds ?? [];
    };
    return [...new Set([...own(), ...(holder.researchOrigins?.[fact]?.sourceIds ?? [])])];
}

// ==================== Parsing (GEDCOM values) ====================

/** `2 _STROM_CONFIRMED <date>`: a `YYYY-MM-DD` day, or null. */
export function parseConfirmedDay(value: string): string | null {
    const v = value.trim();
    return ISO_DAY.test(v) ? v : null;
}

/** `2 _STROM_VERIFY wait|asked|images|permission`, or null. */
export function parseVerifyPending(value: string): FactVerifyPending | null {
    const v = value.trim().toLowerCase();
    return (VERIFY_PENDING as readonly string[]).includes(v) ? v as FactVerifyPending : null;
}

/** `2 _STROM_CHECKED proven|kept`, or null. */
export function parseCheckedResult(value: string): FactVerifyChecked['result'] | null {
    const v = value.trim().toLowerCase();
    return v === 'proven' || v === 'kept' ? v : null;
}

/** `3 _POS n` (a positive whole number), or null. */
export function parsePendingPosition(value: string): number | null {
    const v = value.trim();
    if (!/^\d{1,7}$/.test(v)) return null;
    const n = Number(v);
    return n >= 1 && n <= POSITION_MAX ? n : null;
}

/** `3 _READERS n` (a positive whole number), or null. */
export function parseReaders(value: string): number | null {
    const v = value.trim();
    if (!/^\d{1,3}$/.test(v)) return null;
    const n = Number(v);
    return n >= 1 && n <= READERS_MAX ? n : null;
}

// ==================== Sanitizing (loaded data) ====================

function cleanConfirmation(value: unknown): FactConfirmation | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.at !== 'string' || !ISO_DAY.test(v.at)) return null;
    const out: FactConfirmation = { at: v.at };
    // A take-back of the research's confirmation has no value of its own.
    if (v.withdrawn === true) return { at: v.at, withdrawn: true };
    if (typeof v.value === 'string' && v.value !== '') out.value = v.value;
    return out;
}

/** One research verification state, valid fields only; null when nothing is left. */
export function sanitizeResearchVerify(value: unknown): ResearchFactVerify | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const out: ResearchFactVerify = {};
    if (typeof v.confirmed === 'string' && ISO_DAY.test(v.confirmed)) {
        out.confirmed = v.confirmed;
        if (typeof v.value === 'string' && v.value !== '') out.value = v.value;
    }
    if (typeof v.pending === 'string' && (VERIFY_PENDING as readonly string[]).includes(v.pending)) {
        out.pending = v.pending as FactVerifyPending;
        // A place in the queue only while the research's agent is to take it (not waiting for a person).
        if ((out.pending === 'wait' || out.pending === 'asked') && typeof v.position === 'number' && Number.isInteger(v.position)
            && v.position >= 1 && v.position <= POSITION_MAX) out.position = v.position;
    }
    if (v.checked && typeof v.checked === 'object') {
        const c = v.checked as Record<string, unknown>;
        if (c.result === 'proven' || c.result === 'kept') {
            const checked: FactVerifyChecked = { result: c.result };
            if (typeof c.date === 'string' && c.date.trim() && c.date.length <= DATE_MAX) checked.date = c.date.trim();
            if (c.result === 'kept' && typeof c.why === 'string' && c.why.trim()) checked.why = c.why.trim().slice(0, WHY_MAX);
            if (typeof c.readers === 'number' && Number.isInteger(c.readers) && c.readers >= 1 && c.readers <= READERS_MAX) {
                checked.readers = c.readers;
            }
            out.checked = checked;
        }
    }
    const eid = researchFactRef(v.eid);
    if (eid) out.eid = eid;
    return out.confirmed || out.pending || out.checked || out.eid ? out : null;
}

function cleanMap<T>(holder: FactHolder, field: 'confirmed' | 'researchVerify', clean: (v: unknown) => T | null): void {
    const h = holder as unknown as Record<string, unknown>;
    if (!(field in h)) return;
    const raw = h[field];
    const out: Record<string, T> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const facts = new Set(factsOf(holder));
        for (const [fact, v] of Object.entries(raw as Record<string, unknown>)) {
            if (!facts.has(fact)) continue;
            const c = clean(v);
            if (c) out[fact] = c;
        }
    }
    if (Object.keys(out).length > 0) h[field] = out;
    else delete h[field];
}

type VerifyTree = Pick<StromData, 'persons' | 'partnerships'>;

/** Whether some confirmation of the research in the tree has no value of its own (stored before it was kept). */
export function hasUnvaluedResearchConfirmations(data: VerifyTree): boolean {
    const holders: FactHolder[] = [...Object.values(data.persons ?? {}), ...Object.values(data.partnerships ?? {})];
    return holders.some(h => !!h && typeof h === 'object' && h.researchVerify && typeof h.researchVerify === 'object'
        && Object.values(h.researchVerify).some(v => !!v && typeof v === 'object' && !!v.confirmed && v.value === undefined));
}

/**
 * The value each confirmation of the research without one holds for (a tree
 * stored before ResearchFactVerify.value was kept): the fact's value in
 * `base`, the tree as the research last gave it (research-copy.ts), else —
 * no copy, or the copy lacks the fact — its current value (taken as
 * unchanged since). A fact with no value in either keeps none. Returns
 * whether anything was filled.
 */
export function fillResearchConfirmedValues(data: VerifyTree, base?: VerifyTree | null): boolean {
    let filled = false;
    const fill = (holder: FactHolder | undefined, baseHolder: FactHolder | undefined): void => {
        if (!holder || typeof holder !== 'object' || !holder.researchVerify || typeof holder.researchVerify !== 'object') return;
        for (const [fact, v] of Object.entries(holder.researchVerify)) {
            if (!v || typeof v !== 'object' || !v.confirmed || v.value !== undefined) continue;
            const was = baseHolder && typeof baseHolder === 'object' ? factValueSignature(baseHolder, fact) : '';
            const value = was || factValueSignature(holder, fact);
            if (!value) continue;
            v.value = value;
            filled = true;
        }
    };
    for (const [id, p] of Object.entries(data.persons ?? {})) fill(p, base?.persons?.[id as keyof typeof base.persons]);
    for (const [id, ps] of Object.entries(data.partnerships ?? {})) fill(ps, base?.partnerships?.[id as keyof typeof base.partnerships]);
    return filled;
}

/**
 * The confirmations and the research's verification states of a loaded tree,
 * cleaned (migrateData): valid entries of existing facts only. A confirmation
 * of the research stored without its value gets the current one (a tree read
 * from storage got the research's kept copy's first, TreeManager.readTreeData).
 */
export function cleanFactVerify(data: VerifyTree): void {
    const holders: FactHolder[] = [...Object.values(data.persons ?? {}), ...Object.values(data.partnerships ?? {})];
    for (const holder of holders) {
        if (!holder || typeof holder !== 'object') continue;
        cleanMap(holder, 'confirmed', cleanConfirmation);
        cleanMap(holder, 'researchVerify', sanitizeResearchVerify);
    }
    fillResearchConfirmedValues(data);
    // The couple's id in the research (Partnership.researchId).
    for (const ps of Object.values(data.partnerships ?? {})) {
        if (!ps || typeof ps !== 'object' || ps.researchId === undefined) continue;
        const id = researchFamilyRef(ps.researchId);
        if (id) ps.researchId = id;
        else delete ps.researchId;
    }
}
