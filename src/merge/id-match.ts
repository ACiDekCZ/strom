/**
 * Person matching by the ids the loaded GEDCOM files gave a record
 * (Person.originalIds, spec 066 K3.2).
 *
 * - Strong ids (`_UID`, `UID`, `_FSFTID`, `AFN`, `EXID` with the same TYPE):
 *   one shared value is the same person. `_UID` and `UID` are one kind (the
 *   same UUID written the GEDCOM 5.5.1 or the GEDCOM 7 way).
 * - Only a global id (`_FSFTID`, `AFN`, `EXID` of one TYPE) that differs says
 *   two people. A UUID is made per tree: two trees of one program give the
 *   same person different ones, so a different UUID says nothing.
 * - Weak ids (the xref, `RIN`) only hold inside one tree of one program: they
 *   count only when both records come from files the same program wrote, and
 *   only as a contribution to a name match, never on their own.
 */

import { ImportRecord, Person, StromData } from '../types.js';

/** Tags whose value names a person across files of one system. */
const STRONG_TAGS: ReadonlySet<string> = new Set(['_UID', 'UID', '_FSFTID', 'AFN', 'EXID']);

/** UUID-style tags: one kind, compared without regard to case, hyphens or braces. */
const UUID_TAGS: ReadonlySet<string> = new Set(['_UID', 'UID']);

/** The group of the UUID tags (`_UID`, `UID`): a shared value counts, a different one does not. */
const UUID_GROUP = 'UUID';

interface IdKeys {
    /** "tag|type" (the UUID tags: one group) → normalized values. */
    strong: Map<string, Set<string>>;
    /** "program|kind|value" of the xrefs and RINs. */
    weak: Set<string>;
    /** What the keys were made from (a changed person or tree makes them anew). */
    ids: Person['originalIds'];
    data: StromData;
}

/** What the two records' ids say about them being one person. */
export interface IdEvidence {
    /** 'same': a strong id is shared; 'differ': a global id of one tag (and type) differs and none is shared. */
    strong: 'same' | 'differ' | null;
    /** The same xref or RIN in files of the same program. */
    weak: boolean;
}

const NO_EVIDENCE: IdEvidence = { strong: null, weak: false };

/**
 * A strong id's value as compared: a `_UID` / `UID` without case, hyphens and
 * braces, and without the 4-digit checksum some programs add to the 32 hex
 * digits; any other id as written (trimmed).
 */
function strongValue(tag: string, value: string): string {
    const v = value.trim();
    if (!UUID_TAGS.has(tag)) return v;
    const bare = v.toLowerCase().replace(/[-{}\s]/g, '');
    return /^[0-9a-f]{36}$/.test(bare) ? bare.slice(0, 32) : bare;
}

/** The program that wrote an import's file, as compared; '' when unknown. */
function programKey(rec: ImportRecord | undefined): string {
    return rec?.program?.trim().toLowerCase() ?? '';
}

const cache = new WeakMap<Person, IdKeys>();

function keysOf(person: Person, data: StromData): IdKeys {
    const have = cache.get(person);
    if (have && have.ids === person.originalIds && have.data === data) return have;
    const keys: IdKeys = { strong: new Map(), weak: new Set(), ids: person.originalIds, data };
    const imports = new Map((data.imports ?? []).map(r => [r.id, r] as const));
    for (const entry of person.originalIds ?? []) {
        const program = programKey(imports.get(entry.from));
        if (program && entry.xref) keys.weak.add(`${program}\u0000xref\u0000${entry.xref}`);
        for (const line of entry.ids ?? []) {
            const tag = line.tag.toUpperCase();
            if (tag === 'RIN') {
                if (program && line.value.trim()) keys.weak.add(`${program}\u0000RIN\u0000${line.value.trim()}`);
                continue;
            }
            if (!STRONG_TAGS.has(tag)) continue;
            const value = strongValue(tag, line.value);
            if (!value) continue;
            const group = UUID_TAGS.has(tag) ? UUID_GROUP : `${tag}\u0000${tag === 'EXID' ? (line.type ?? '').trim() : ''}`;
            let set = keys.strong.get(group);
            if (!set) keys.strong.set(group, set = new Set());
            set.add(value);
        }
    }
    cache.set(person, keys);
    return keys;
}

/** What the ids of `existing` (in its tree) and `incoming` (in its file) say. */
export function idEvidence(existing: Person, incoming: Person, existingData: StromData, incomingData: StromData): IdEvidence {
    if (!existing.originalIds?.length || !incoming.originalIds?.length) return NO_EVIDENCE;
    const a = keysOf(existing, existingData);
    const b = keysOf(incoming, incomingData);
    let strong: IdEvidence['strong'] = null;
    for (const [group, values] of a.strong) {
        const other = b.strong.get(group);
        if (!other) continue;
        if ([...values].some(v => other.has(v))) { strong = 'same'; break; }
        if (group !== UUID_GROUP) strong = 'differ';
    }
    let weak = false;
    for (const key of a.weak) {
        if (b.weak.has(key)) { weak = true; break; }
    }
    return { strong, weak };
}
