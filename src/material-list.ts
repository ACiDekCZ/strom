/**
 * Material for a list of people (spec 137 K2.1, §6.6) — the pure half.
 *
 * With `media.list` in the research's features, "Send material…" may concern a
 * list of people instead of the one person (or, with `media.list.source`, a
 * source together with a list). The list goes once as a snapshot
 * (`PUT <token>/lists/<listRef>`), each file then carries `X-Strom-List-Ref`
 * and `X-Strom-Person` (every known person up to 50, else the dialog's person
 * alone). People the research does not know yet (no REFN) are left out and
 * only counted (`missing`); when it knows none of the list, the material goes
 * as before, to the dialog's person alone.
 */

import type { PersonId, PersonList, PersonListRule, StromData } from './types.js';
import { listKind, type ListKind } from './person-lists.js';
import { researchPersonRef } from './research-link.js';
import { createSha256 } from './sha256.js';

/** Up to this many people the files name them all (`X-Strom-Person`); the research holds the same limit. */
export const MATERIAL_LIST_INLINE_MAX = 50;
/** The research's limits for the list's body. */
export const MATERIAL_LIST_NAME_MAX = 200;
export const MATERIAL_LIST_RULE_MAX = 500;

/** The body of `PUT lists/<listRef>` (the research's answer of 23 Nov 2026). */
export interface MaterialListBody {
    name: string;
    kind: ListKind;
    /** An automatic list's rule as the app words it (in the app's language). */
    rule?: string;
    /** The rule as the app keeps it, stored by the research as it is. */
    ruleData?: PersonListRule;
    /** Research numbers (P…) in the list's order, the dialog's person first. */
    persons: string[];
    /** People of the list the research does not know yet. */
    missing: number;
    /** When it was sent (ISO). */
    at: string;
}

/** A list as it was at Send: what goes before the files and what each file carries. */
export interface MaterialListSnapshot {
    /** The list's id for the research (`materialListRef`). */
    ref: string;
    body: MaterialListBody;
    /** `X-Strom-Person` of each file ('' = none: a source's material for a large list). */
    personHeader: string;
}

/** What the dialog says of a list: its people, how many the research knows, and whether it is large. */
export interface MaterialListFacts {
    count: number;
    known: number;
    missing: number;
    big: boolean;
}

const LIST_REF = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The list's id in the research: the app's id when the research takes it as
 * it is, else `L` + the first 24 hex digits of its SHA-256 (stable, so sending
 * the same list again replaces what waits there).
 */
export function materialListRef(id: string): string {
    if (LIST_REF.test(id)) return id;
    const h = createSha256();
    h.update(new TextEncoder().encode(id));
    return `L${h.digestHex().slice(0, 24)}`;
}

/** How many of a list's people the research knows (have a research number). */
export function materialListFacts(data: StromData, ids: readonly PersonId[]): MaterialListFacts {
    let known = 0;
    for (const id of ids) if (researchPersonRef(data.persons[id]?.refn)) known++;
    return { count: ids.length, known, missing: ids.length - known, big: ids.length > MATERIAL_LIST_INLINE_MAX };
}

/**
 * The snapshot of a list at Send. `ids`: the list's people in its order;
 * `dialogPersonId`: the person the dialog was opened for (first, even when not
 * in the list; none for a source). Null when the research knows nobody of the
 * list: the material then goes as before, without the list.
 */
export function materialListSnapshot(opts: {
    list: PersonList; name: string; ids: readonly PersonId[]; data: StromData;
    dialogPersonId?: PersonId | null; ruleText?: string; now: string;
}): MaterialListSnapshot | null {
    const { list, ids, data } = opts;
    const facts = materialListFacts(data, ids);
    if (facts.known === 0) return null;
    const dialogRef = opts.dialogPersonId ? researchPersonRef(data.persons[opts.dialogPersonId]?.refn) : null;
    const persons: string[] = dialogRef ? [dialogRef] : [];
    const seen = new Set(persons);
    for (const id of ids) {
        const ref = researchPersonRef(data.persons[id]?.refn);
        if (ref && !seen.has(ref)) { seen.add(ref); persons.push(ref); }
    }
    const kind = listKind(list);
    const body: MaterialListBody = {
        name: opts.name.slice(0, MATERIAL_LIST_NAME_MAX),
        kind,
        ...(kind === 'auto' && opts.ruleText ? { rule: opts.ruleText.slice(0, MATERIAL_LIST_RULE_MAX) } : {}),
        ...(kind === 'auto' && list.rule ? { ruleData: list.rule } : {}),
        persons,
        missing: facts.missing,
        at: opts.now,
    };
    return { ref: materialListRef(list.id), body, personHeader: materialPersonHeader(persons, dialogRef, facts.big) };
}

/** `X-Strom-Person` of a list's files: every known person up to 50, else the dialog's person alone ('' for none). */
export function materialPersonHeader(persons: readonly string[], dialogRef: string | null, big: boolean): string {
    return big ? dialogRef ?? '' : persons.join(',');
}
