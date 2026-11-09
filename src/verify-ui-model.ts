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
import { factResearchEid } from './verify.js';
import type { VerifyFact } from './research-verify.js';
import { VerifyOffer, VerifyResearch, verifyOffer } from './verify-offer.js';
import type { FactVerifyInfo } from './verify.js';

/** The GEDCOM tag of each event type the research verifies. */
const EVENT_KINDS: Readonly<Record<string, string>> = { baptism: 'BAPM', burial: 'BURI' };

/**
 * The GEDCOM tag of a fact the research re-verifies (birth, death, a
 * baptism, a burial, a couple's marriage), or null: names, sex, divorce
 * and the other events are not verified.
 */
export function verifyFactKind(holder: FactHolder, fact: string): string | null {
    if (isPartnership(holder)) return fact === 'marriage' ? 'MARR' : null;
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
 * verifies and named by its id; in a tree of the research no name or sex
 * (it neither verifies nor confirms them); the scan through the bridge when
 * the fact has its id, else the app's own confirmation, only where the tree
 * can be changed. In a tree of the research the scan comes only while its
 * bridge takes confirmations (`researchConfirms`, verifyOffer): without the
 * bridge none is offered; with it, a fact without its id is confirmed as the
 * app's own.
 */
export function factOffer(holder: FactHolder, fact: string, input: FactOfferInput): FactOffer {
    const eid = factResearchEid(holder, fact);
    const kind = verifyFactKind(holder, fact);
    const pending = input.info.pending ?? (input.localPending ? 'wait' : undefined);
    const base = verifyOffer({
        step: input.step, research: input.research, cited: input.cited, pending,
        confirmedBy: input.info.confirmedBy, why: input.info.checked?.why,
    });
    const out: FactOffer = { ...base, eid, scanViaBridge: false, undoViaBridge: false };
    if (!eid || !kind) { out.verify = false; delete out.cost; }
    if (input.researchTree && (fact === 'name' || fact === 'sex')) {
        out.verify = false;
        out.scan = false;
        delete out.cost;
    }
    if (out.scan) {
        out.scanViaBridge = !!input.research && !!eid;
        if (!out.scanViaBridge && !input.editable) out.scan = false;
    }
    if (out.undo) {
        out.undoViaBridge = input.info.confirmedBy === 'research';
        if (!out.undoViaBridge && !input.editable) out.undo = false;
        if (out.undoViaBridge && !eid) out.undo = false;
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

/** One of a person's facts as "Verify facts · N" counts it. */
export interface PersonAskFact {
    fact: string;
    offer: Pick<FactOffer, 'verify' | 'row' | 'eid'>;
    step: ReliabilityStepName | null;
}

/**
 * "Verify facts · N" (the person menu, the card mark's tip): the facts the
 * research's /verify {person} takes — each of the person's and their
 * couples' facts it holds (its id there: a residence or an occupation as
 * well as a birth), not confirmed by a person, not waiting already; the
 * name and the sex are no facts of its. 0 while none of them offers
 * "Verify" (nothing worth asking for): the item is not shown.
 */
export function personVerifyAskCount(facts: readonly PersonAskFact[]): number {
    if (!facts.some(f => f.offer.verify)) return 0;
    return facts.filter(f => !!f.offer.eid && f.fact !== 'name' && f.fact !== 'sex'
        && f.step !== 'human' && f.offer.row !== 'pending').length;
}

/** A person's count for "Verify facts (N)" and "Verifying · N" from the offers of their facts. */
export function personVerifyCounts(offers: readonly Pick<FactOffer, 'verify' | 'row'>[]): { verify: number; pending: number } {
    return {
        verify: offers.filter(o => o.verify).length,
        pending: offers.filter(o => o.row === 'pending').length,
    };
}
