/**
 * What the "Verify facts" UI (spec 065, kolo 3) decides without the page:
 * which facts the research verifies, a fact's offer as the tree knows it
 * (the research's id of the fact, a name the research neither verifies nor
 * confirms), a person's count, the cost split of a dry run, the bulk scopes,
 * and when the toast after a run of re-verification is due. Pure.
 */

import type { LifeEvent } from './types.js';
import type { FactHolder } from './import-origin.js';
import { isPartnership } from './import-origin.js';
import type { ReliabilityStepName } from './reliability.js';
import { NAME_STATUS_FEATURE, factPendingPosition, factResearchEid } from './verify.js';
import type { VerifyFact } from './research-verify.js';
import { VerifyOffer, VerifyResearch, verifyOffer } from './verify-offer.js';
import type { FactVerifyInfo } from './verify.js';

/** The GEDCOM tag of each event type the research verifies. */
const EVENT_KINDS: Readonly<Record<string, string>> = { baptism: 'BAPM', burial: 'BURI' };

/**
 * The GEDCOM tag of a fact the research re-verifies (a person's name, birth,
 * death, a baptism, a burial, a couple's marriage), or null: sex, divorce and
 * the other events are not verified. Whether the research takes the name
 * (`name-status`) is factOffer's call.
 */
export function verifyFactKind(holder: FactHolder, fact: string): string | null {
    if (isPartnership(holder)) return fact === 'marriage' ? 'MARR' : null;
    if (fact === 'name') return 'NAME';
    if (fact === 'birth') return 'BIRT';
    if (fact === 'death') return 'DEAT';
    if (fact.startsWith('event:')) {
        const ev = (holder.events ?? []).find(e => e?.id === fact.slice(6)) as LifeEvent | undefined;
        return ev ? EVENT_KINDS[ev.type] ?? null : null;
    }
    return null;
}

/** What the page knows of one fact for its offer. */
export interface FactOfferInput {
    step: ReliabilityStepName | null;
    /** The research the tree is linked to (null: none). */
    research: VerifyResearch | null;
    /** The tree is the research's (linked to it). */
    researchTree: boolean;
    cited: boolean;
    /** A record to confirm it against (a citation, or the record the research read its value from); absent: as `cited`. */
    source?: boolean;
    info: FactVerifyInfo;
    /** It waits for re-verification since a start here (not yet in the research's file). */
    localPending?: boolean;
    /** The tree can be changed here (not a view, not locked): the app's own confirmation. */
    editable: boolean;
}

/** A fact's offer with how its actions go (`eid`: the research's id of the fact, for the bridge). */
export interface FactOffer extends VerifyOffer {
    eid: string | null;
    /** The scan goes to the research (`/facts/confirm`), else it is the app's own confirmation. */
    scanViaBridge: boolean;
    /** The undo goes to the research (its own confirmation), else the app's. */
    undoViaBridge: boolean;
}

/**
 * The offer of one fact (table 10z, as the tree knows it): `verifyOffer`,
 * then what the tree can do of it — "Verify" only for a fact the research
 * verifies and named by its id; in a tree of the research no sex (it neither
 * verifies nor confirms it), and a name only from a research that takes
 * names (`name-status`), or one whose bridge does not run while the name
 * has its id (066 K6.3); the scan through the bridge when
 * the fact has its id, else the app's own confirmation, only where the tree
 * can be changed. In a tree of the research the scan comes while its bridge
 * takes confirmations (`researchConfirms`, verifyOffer), a fact without its id
 * confirmed as the app's own; while its bridge does not run (`offline`), the
 * scan and the taking back of a fact the research names by its id are the
 * app's own, handed to the research with the tree (`_STROM_CONFIRMED`).
 */
export function factOffer(holder: FactHolder, fact: string, input: FactOfferInput): FactOffer {
    const eid = factResearchEid(holder, fact);
    const kind = verifyFactKind(holder, fact);
    const pending = input.info.pending ?? (input.localPending ? 'wait' : undefined);
    // Its place as the file says; a wait started here was asked for already (no "Verify first").
    const position = input.localPending ? null : factPendingPosition(holder, fact);
    const base = verifyOffer({
        step: input.step, research: input.research, cited: input.cited, source: input.source, pending, position,
        confirmedBy: input.info.confirmedBy, why: input.info.checked?.why,
    });
    const out: FactOffer = { ...base, eid, scanViaBridge: false, undoViaBridge: false };
    if (!eid || !kind) { out.verify = false; delete out.cost; delete out.prioritize; }
    // A research before `name-status` neither verifies nor confirms a name; while its bridge does not
    // run, a name it named by its id is confirmed as the app's own (handed over with the tree).
    const nameOk = !!input.research && (input.research.features.includes(NAME_STATUS_FEATURE) || (!!input.research.offline && !!eid));
    if (input.researchTree && (fact === 'sex' || (fact === 'name' && !nameOk))) {
        // Nothing of it goes to the research by its id ("Verify facts (N)" does not count it either).
        if (fact === 'name') out.eid = null;
        out.verify = false;
        delete out.prioritize;
        out.scan = false;
        delete out.cost;
    }
    // Its bridge not running: the app's own confirmation (or taking back), handed over with the tree, only of a
    // fact the research named by its id (a research that writes ids reads `_STROM_CONFIRMED`).
    const offline = !!input.research?.offline;
    if (offline && !out.eid) { out.scan = false; out.undo = out.undo && input.info.confirmedBy === 'app'; }
    if (out.scan) {
        out.scanViaBridge = !!input.research && !!out.eid && !offline;
        if (!out.scanViaBridge && !input.editable) out.scan = false;
    }
    if (out.undo) {
        out.undoViaBridge = input.info.confirmedBy === 'research' && !offline;
        if (!out.undoViaBridge && !input.editable) out.undo = false;
        if (out.undoViaBridge && !out.eid) out.undo = false;
    }
    return out;
}

/** How many of a dry run's facts read a known record (low) and how many look for one (higher). */
export function verifyCostSplit(facts: readonly Pick<VerifyFact, 'how'>[]): { low: number; high: number } {
    const low = facts.filter(f => f.how === 'read').length;
    return { low, high: facts.length - low };
}

/** A record as the preview names it: its title, and its page when said. */
export function verifyRecordText(record: VerifyFact['record'] | undefined): string {
    if (!record) return '';
    return record.page ? `${record.title}, ${record.page}` : record.title;
}

/** A bulk verification's scope as the dialog offers it. */
export interface BulkScopeOption {
    scope: 'line' | 'lineage' | 'tree';
    /** The research's id it names (a direction "G…", a lineage's founder "P…"); none for the tree. */
    of?: string;
    /** What the option says after its kind (the direction's name, the surname). */
    name?: string;
}

/**
 * The scopes the bulk dialog offers, in order: the focused person's line
 * (a direction of the research they are in), their lineage (by its
 * founder's id in the research), the whole tree. The first is the default.
 */
export function bulkScopeOptions(input: {
    line?: { id: string; name: string } | null;
    lineage?: { founderRef: string | null; surname: string } | null;
}): BulkScopeOption[] {
    const out: BulkScopeOption[] = [];
    if (input.line && /^G\d{1,9}$/.test(input.line.id)) out.push({ scope: 'line', of: input.line.id, name: input.line.name });
    if (input.lineage?.founderRef && input.lineage.surname) out.push({ scope: 'lineage', of: input.lineage.founderRef, name: input.lineage.surname });
    out.push({ scope: 'tree' });
    return out;
}

/** How many people "try first" takes (the dialog's checkbox). */
export const VERIFY_TRY_PEOPLE = 5;

/**
 * The toast after the research's run of re-verification (§10.4) is due:
 * a run said (`fix.at`) that this tree has not shown yet, while facts wait.
 */
export function queuedToastDue(fix: { at: string } | undefined, waiting: number, shownFor: string | null): boolean {
    return !!fix && !!fix.at && waiting > 0 && fix.at !== shownFor;
}

/**
 * The kinds "Verify facts" of a person takes (spec 065 P6, Milan 16. 11.): the
 * name (066 K6.3), the birth, a baptism, a marriage, the death, a burial. A
 * residence, an occupation or another fact the research holds goes by
 * "Verify" at the fact.
 */
export const PERSON_VERIFY_KINDS: ReadonlySet<string> = new Set(['NAME', 'BIRT', 'CHR', 'BAPM', 'MARR', 'DEAT', 'BURI']);

/** The facts a name is verified together with: the record of the birth or the baptism names the person. */
const NAME_TOGETHER_KINDS: ReadonlySet<string> = new Set(['BIRT', 'BAPM', 'CHR']);

/**
 * What a fact is verified together with, as a dry run of /verify says it (066
 * K6.3): the kind of the fact its `with` names, else a name beside a birth or
 * baptism in the same answer (and the other way round). Only a name with a
 * birth, a baptism or a christening; null for anything else, or when the
 * answer does not hold the fact `own`.
 */
export function verifyTogetherKind(facts: readonly Pick<VerifyFact, 'fact' | 'kind' | 'with'>[], own: string): string | null {
    const mine = facts.find(f => f.fact === own);
    if (!mine) return null;
    const pairs = (a: string, b: string): boolean =>
        (a === 'NAME' && NAME_TOGETHER_KINDS.has(b)) || (b === 'NAME' && NAME_TOGETHER_KINDS.has(a));
    if (mine.with) {
        const other = facts.find(f => f.fact === mine.with);
        return other && pairs(mine.kind, other.kind) ? other.kind : null;
    }
    return facts.find(f => f.fact !== own && pairs(mine.kind, f.kind))?.kind ?? null;
}

/** One of a person's facts as "Verify facts · N" counts it. */
export interface PersonAskFact {
    fact: string;
    /** Its GEDCOM kind as the research verifies it (verifyFactKind; null: none of those). */
    kind: string | null;
    offer: Pick<FactOffer, 'verify' | 'row' | 'eid'>;
    step: ReliabilityStepName | null;
}

/**
 * "Verify facts · N" (the person menu, the card mark's tip): the facts the
 * person's "Verify facts" asks for — each of the person's and their couples'
 * facts of PERSON_VERIFY_KINDS the research holds (its id there; a proven
 * one too), not confirmed by a person, not waiting already. 0 while none of
 * them offers "Verify" (nothing worth asking for): the item is not shown.
 */
export function personVerifyAskCount(facts: readonly PersonAskFact[]): number {
    if (!facts.some(f => f.offer.verify)) return 0;
    return facts.filter(f => !!f.offer.eid && !!f.kind && PERSON_VERIFY_KINDS.has(f.kind)
        && f.step !== 'human' && f.offer.row !== 'pending').length;
}

/** A person's count for "Verify facts (N)" and "Verifying · N" from the offers of their facts. */
export function personVerifyCounts(offers: readonly Pick<FactOffer, 'verify' | 'row'>[]): { verify: number; pending: number } {
    return {
        verify: offers.filter(o => o.verify).length,
        pending: offers.filter(o => o.row === 'pending').length,
    };
}
