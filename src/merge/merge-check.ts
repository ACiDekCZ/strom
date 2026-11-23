/**
 * The check before a merge is saved (spec 134 K0.2): everything of the
 * incoming tree is merged, added or left out by a rule, everything of the
 * tree is still there, and no reference points at nothing that did not
 * already. A pure function over the decisions, the merged data and the ids
 * the executor gave the incoming records (MergeResult.trace).
 */

import { Attachment, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { allMedia } from '../media.js';
import { forEachCitationHolder } from '../citation-quality.js';
import { partnershipParticipants } from '../model-values.js';
import { MergeState, MergeTrace } from './types.js';
import { strings } from '../strings.js';

/** What a check can find wrong. `target*` = something of the tree the merge goes into. */
export type MergeCheckKind =
    | 'personLost' | 'unionLost' | 'linkLost' | 'sourceLost' | 'fileLost'
    | 'targetPersonLost' | 'targetUnionLost' | 'targetLinkLost' | 'targetSourceLost' | 'targetFileLost'
    | 'danglingRef';

export interface MergeCheckProblem {
    kind: MergeCheckKind;
    count: number;
    /** A few of them (names of persons, ids of the rest), for a message or a log. */
    examples: string[];
}

/** One kind of record of the incoming tree: how many there were and where each went. */
export interface MergeCheckTally {
    source: number;
    merged: number;
    added: number;
    /** Left out by a rule (skipped, "update only", a link a third parent would need…). */
    left: number;
    lost: number;
}

export type MergeCheckRecord = 'persons' | 'unions' | 'links' | 'sources' | 'files';

export interface MergeCheckResult {
    ok: boolean;
    problems: MergeCheckProblem[];
    /** For every kind of record: merged + added + left + lost = source. */
    tallies: Record<MergeCheckRecord, MergeCheckTally>;
}

const MAX_EXAMPLES = 5;

function personLabel(p: Person | undefined, id: string): string {
    const name = p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
    return name && name !== '?' ? name : id;
}

/** child → parent pairs a tree holds, as its parentIds say (at most two real, other persons). */
function parentLinks(data: StromData): Array<[PersonId, PersonId]> {
    const out: Array<[PersonId, PersonId]> = [];
    for (const person of Object.values(data.persons)) {
        const seen = new Set<PersonId>();
        for (const pid of person.parentIds ?? []) {
            if (pid === person.id || seen.has(pid) || !data.persons[pid]) continue;
            seen.add(pid);
            if (seen.size > 2) break;
            out.push([person.id, pid]);
        }
    }
    return out;
}

/** True when `ancestor` is `person` or among the persons above it (parent links, upwards). */
export function isAncestorOrSelf(data: StromData, ancestor: PersonId, person: PersonId): boolean {
    const seen = new Set<PersonId>();
    const queue: PersonId[] = [person];
    while (queue.length) {
        const id = queue.pop()!;
        if (id === ancestor) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(data.persons[id]?.parentIds ?? []));
    }
    return false;
}

function sameAttachment(a: Attachment, b: Attachment): boolean {
    if (a.id === b.id) return true;
    if (a.originalOnly || b.originalOnly) return !!a.originalOnly && !!b.originalOnly && !!a.original?.sha256 && a.original.sha256 === b.original?.sha256;
    return !!a.dataUrl && a.dataUrl === b.dataUrl;
}

/**
 * References that point at nothing, by kind, each with where it is. Parent,
 * child, couple and partner ids, a couple's children, citations, the places
 * of files and the persons named at events.
 */
export function danglingReferences(data: StromData): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const add = (kind: string, where: string): void => {
        const list = out.get(kind) ?? out.set(kind, []).get(kind)!;
        list.push(where);
    };
    const persons = data.persons;
    const unions = data.partnerships;
    const sources = data.sources ?? {};
    for (const person of Object.values(persons)) {
        for (const id of person.parentIds ?? []) if (!persons[id]) add('parent', `${person.id}→${id}`);
        for (const id of person.childIds ?? []) if (!persons[id]) add('child', `${person.id}→${id}`);
        for (const id of person.partnerships ?? []) if (!unions[id]) add('couple', `${person.id}→${id}`);
        for (const ev of person.events ?? []) {
            for (const part of ev.participants ?? []) if (part.personId && !persons[part.personId]) add('participant', `${person.id}→${part.personId}`);
        }
    }
    for (const union of Object.values(unions)) {
        if (!persons[union.person1Id]) add('partner', `${union.id}→${union.person1Id}`);
        if (!persons[union.person2Id]) add('partner', `${union.id}→${union.person2Id}`);
        for (const id of union.childIds ?? []) if (!persons[id]) add('coupleChild', `${union.id}→${id}`);
        for (const part of partnershipParticipants(union)) if (part.personId && !persons[part.personId]) add('participant', `${union.id}→${part.personId}`);
    }
    forEachCitationHolder(data, (holder, fields) => {
        for (const field of fields) {
            const list = holder[field];
            if (!Array.isArray(list)) continue;
            for (const id of list) if (typeof id === 'string' && !sources[id]) add('citation', `${String(holder.id ?? '')}→${id}`);
        }
    });
    for (const att of allMedia(data)) {
        for (const pl of att.places ?? []) {
            if ('personId' in pl && !persons[pl.personId]) add('file', `${att.id}→${pl.personId}`);
            else if ('partnershipId' in pl && !unions[pl.partnershipId]) add('file', `${att.id}→${pl.partnershipId}`);
            else if ('sourceId' in pl && !sources[pl.sourceId]) add('file', `${att.id}→${pl.sourceId}`);
        }
    }
    return out;
}

/**
 * Check a merge before it is saved. `result.trace` is where the executor put
 * each incoming person, couple and source; without it nothing of the incoming
 * tree can be told merged or added, and the check fails.
 */
export function checkMergeResult(state: MergeState, result: { mergedData: StromData; trace?: MergeTrace }): MergeCheckResult {
    const { existingData, incomingData } = state;
    const merged = result.mergedData;
    const trace = result.trace ?? { persons: new Map(), partnerships: new Map(), sources: new Map() };
    const problems: MergeCheckProblem[] = [];
    const report = (kind: MergeCheckKind, examples: string[]): void => {
        if (examples.length) problems.push({ kind, count: examples.length, examples: examples.slice(0, MAX_EXAMPLES) });
    };
    const tally = (): MergeCheckTally => ({ source: 0, merged: 0, added: 0, left: 0, lost: 0 });
    const tallies: Record<MergeCheckRecord, MergeCheckTally> = {
        persons: tally(), unions: tally(), links: tally(), sources: tally(), files: tally(),
    };

    // Persons of the incoming tree.
    const inResult = (incomingId: PersonId): PersonId | undefined => {
        const id = trace.persons.get(incomingId);
        return id && merged.persons[id] ? id : undefined;
    };
    const lostPersons: string[] = [];
    for (const [id, person] of Object.entries(incomingData.persons) as [PersonId, Person][]) {
        const t = tallies.persons;
        t.source++;
        const target = inResult(id);
        if (target) {
            if (existingData.persons[target]) t.merged++;
            else t.added++;
            continue;
        }
        const decision = state.decisions.get(id);
        if (decision?.type === 'skip' || state.updateOnly || person.isPlaceholder) t.left++;
        else { t.lost++; lostPersons.push(personLabel(person, id)); }
    }
    report('personLost', lostPersons);

    // Couples of the incoming tree.
    const coupleIn = (a: PersonId, b: PersonId): PartnershipId | undefined => {
        for (const uid of merged.persons[a]?.partnerships ?? []) {
            const u = merged.partnerships[uid];
            if (u && ((u.person1Id === a && u.person2Id === b) || (u.person1Id === b && u.person2Id === a))) return u.id;
        }
        return undefined;
    };
    const lostUnions: string[] = [];
    const relations = state.relations;
    for (const union of Object.values(incomingData.partnerships)) {
        const t = tallies.unions;
        t.source++;
        const a = inResult(union.person1Id);
        const b = inResult(union.person2Id);
        // A couple a conflict of relations kept out (spec 134 K5.5) is left by a rule.
        if (!a || !b || a === b || relations?.leftUnions?.includes(union.id)) { t.left++; continue; }
        const found = coupleIn(a, b);
        if (found) {
            if (existingData.partnerships[found]) t.merged++;
            else t.added++;
        } else {
            t.lost++;
            lostUnions.push(`${personLabel(incomingData.persons[union.person1Id], union.person1Id)} + ${personLabel(incomingData.persons[union.person2Id], union.person2Id)}`);
        }
    }
    report('unionLost', lostUnions);

    // Parent–child links of the incoming tree.
    const hadLink = (child: PersonId, parent: PersonId): boolean => !!existingData.persons[child]?.parentIds?.includes(parent);
    const lostLinks: string[] = [];
    for (const [childId, parentId] of parentLinks(incomingData)) {
        const t = tallies.links;
        t.source++;
        const c = inResult(childId);
        const p = inResult(parentId);
        if (!c || !p || c === p) { t.left++; continue; }
        const parents = merged.persons[c].parentIds;
        if (!parents.includes(p) && relations?.leftLinks?.includes(`${childId}<${parentId}`)) { t.left++; continue; }
        if (parents.includes(p)) {
            if (hadLink(c, p)) t.merged++;
            else t.added++;
        } else if (parents.filter(id => id !== p && merged.persons[id]).length >= 2) {
            // A child with two parents already takes no third.
            t.left++;
        } else if (isAncestorOrSelf(merged, c, p)) {
            // Nobody becomes their own ancestor (a match into the wrong generation).
            t.left++;
        } else {
            t.lost++;
            lostLinks.push(`${personLabel(incomingData.persons[childId], childId)} ← ${personLabel(incomingData.persons[parentId], parentId)}`);
        }
    }
    report('linkLost', lostLinks);

    // Sources of the incoming tree.
    const mergedSources = merged.sources ?? {};
    const lostSources: string[] = [];
    for (const [id, src] of Object.entries(incomingData.sources ?? {})) {
        const t = tallies.sources;
        t.source++;
        const target = trace.sources.get(id) ?? id;
        if (mergedSources[target]) {
            if (existingData.sources?.[target]) t.merged++;
            else t.added++;
        } else {
            t.lost++;
            lostSources.push(src.title || id);
        }
    }
    report('sourceLost', lostSources);

    // Files of the incoming tree.
    const mergedMedia = allMedia(merged);
    const existingMedia = allMedia(existingData);
    const placeCame = (att: Attachment): boolean => (att.places ?? []).some(pl => {
        if ('personId' in pl) return !!inResult(pl.personId);
        if ('partnershipId' in pl) {
            const to = trace.partnerships.get(pl.partnershipId);
            return !!to && !!merged.partnerships[to];
        }
        return !!mergedSources[trace.sources.get(pl.sourceId) ?? pl.sourceId];
    });
    const lostFiles: string[] = [];
    for (const att of allMedia(incomingData)) {
        const t = tallies.files;
        t.source++;
        if (mergedMedia.some(m => sameAttachment(m, att))) {
            if (existingMedia.some(m => sameAttachment(m, att))) t.merged++;
            else t.added++;
        } else if (placeCame(att)) {
            t.lost++;
            lostFiles.push(att.title || att.name || att.id);
        } else {
            t.left++;
        }
    }
    report('fileLost', lostFiles);

    // Everything of the tree is still there.
    report('targetPersonLost', Object.values(existingData.persons).filter(p => !merged.persons[p.id]).map(p => personLabel(p, p.id)));
    // What a conflict of relations replaced with the import's (K5.5) is gone on purpose.
    report('targetUnionLost', Object.keys(existingData.partnerships)
        .filter(id => !merged.partnerships[id as PartnershipId] && !relations?.dropUnions?.includes(id as PartnershipId)));
    report('targetLinkLost', parentLinks(existingData)
        .filter(([c, p]) => !merged.persons[c]?.parentIds?.includes(p) && !relations?.dropLinks?.includes(`${c}<${p}`))
        .map(([c, p]) => `${personLabel(existingData.persons[c], c)} ← ${personLabel(existingData.persons[p], p)}`));
    report('targetSourceLost', Object.keys(existingData.sources ?? {}).filter(id => !mergedSources[id]));
    const mergedMediaIds = new Set(mergedMedia.map(m => m.id));
    report('targetFileLost', existingMedia.filter(m => !mergedMediaIds.has(m.id)).map(m => m.title || m.name || m.id));

    // No new reference to nothing.
    const before = [danglingReferences(existingData), danglingReferences(incomingData)];
    const newDangling: string[] = [];
    for (const [kind, where] of danglingReferences(merged)) {
        const had = before.reduce((n, d) => n + (d.get(kind)?.length ?? 0), 0);
        if (where.length > had) newDangling.push(...where.slice(had).map(w => `${kind}: ${w}`));
    }
    report('danglingRef', newDangling);

    return { ok: problems.length === 0, problems, tallies };
}

/**
 * What a failed check says, in the UI language: "The merge was not saved:
 * 3 people from the import would be lost. The tree stays unchanged."
 */
export function mergeCheckMessage(problems: readonly Pick<MergeCheckProblem, 'kind' | 'count'>[]): string {
    const t = strings.merge.mergeCheck;
    return t.failed(problems.map(p => t[p.kind](p.count)).join(', '));
}
