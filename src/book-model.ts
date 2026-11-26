/**
 * The family book's structure (1031 §5.3, §5.4): which families get chapters,
 * in which order and under which lineage, and the cross-references the blocks
 * print ("→ ch. 7", "son from the family in ch. 3"). Pure; the lineages come
 * from src/lineage.ts and are never computed here.
 */

import { PartnershipId, PersonId, StromData } from './types.js';
import { giftCutIds, type GiftDepth } from './gift-tree.js';
import { buildLineages, LineageIndex, otherFamilyRods, Rod, RodId, rodLabels, rods, selection, Selection, SelectionSpec } from './lineage.js';

/** What goes into the book (§4.2). */
export type BookSelectionSpec =
    | { kind: 'tree' }
    | { kind: 'rods'; rods: RodId[] }
    | { kind: 'ancestors' | 'descendants'; person: PersonId; generations?: number | 'all' }
    /** Chosen people (linked pages only, 1102 §4.1): families only where both partners are chosen. */
    | { kind: 'persons'; ids: PersonId[] }
    /** A person's family tree (spec 093 §10): the gift's cut of the person — told as chosen people. */
    | { kind: 'gift'; personId: PersonId; depth: GiftDepth; branches?: Record<PersonId, boolean> };

/** One chapter: a family (a union) of the line. */
export interface BookChapter {
    no: number;
    unionId: PartnershipId;
    /** The lineage the chapter belongs to (null in a book of ancestors or descendants). */
    rodId: RodId | null;
    /** The generation, 1 = the oldest of its line / of the book. */
    gen: number;
    /** A childless union of a member: a subchapter (own number, indented in the contents). */
    sub: boolean;
    /** The partner the chapter follows: the lineage's member (the husband when both are). */
    memberId: PersonId | null;
}

export interface BookRodGroup {
    rod: Rod;
    label: string;
    chapters: BookChapter[];
}

export interface BookModel {
    index: LineageIndex;
    labels: Map<RodId, string>;
    spec: BookSelectionSpec;
    selection: Selection;
    /** The lineages told as chapters (tree and rods). */
    groups: BookRodGroup[];
    /** Every chapter in reading order. */
    chapters: BookChapter[];
    chapterOf: Map<PartnershipId, BookChapter>;
    /** The first chapter where the person is one of the couple. */
    ownChapter: Map<PersonId, number>;
    /** Every chapter where the person is one of the couple. */
    ownChapters: Map<PersonId, number[]>;
    /** The chapter of the family the person is a child of. */
    birthChapter: Map<PersonId, number>;
    /** The other families not told as chapters (whole tree only, see otherFamilyRods). */
    smallRods: Rod[];
    /** The people the book names (its index). */
    personIds: Set<PersonId>;
    /** A member's generation within its lineage (1 = the root). */
    rodGeneration: (personId: PersonId) => number;
}

/** Each chosen person's generation relative to the person (parents −1, children +1, partners and siblings the same), within the chosen. */
function giftLevels(data: StromData, from: PersonId, members: ReadonlySet<PersonId>): Map<PersonId, number> {
    const level = new Map<PersonId, number>([[from, 0]]);
    const queue: PersonId[] = [from];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        const p = data.persons[id];
        if (!p) continue;
        const l = level.get(id)!;
        const partners = p.partnerships.map(uid => data.partnerships[uid]).map(u => u && (u.person1Id === id ? u.person2Id : u.person1Id));
        const next: Array<[PersonId | undefined, number]> = [
            ...p.parentIds.map(n => [n, l - 1] as [PersonId, number]),
            ...p.childIds.map(n => [n, l + 1] as [PersonId, number]),
            ...partners.map(n => [n, l] as [PersonId | undefined, number]),
        ];
        for (const [n, nl] of next) {
            if (!n || !members.has(n) || level.has(n)) continue;
            level.set(n, nl);
            queue.push(n);
        }
    }
    return level;
}

/** The lineage module's selection for the book's choice (a person's family tree: the gift's cut, its one evaluation). */
export function lineageSpec(spec: BookSelectionSpec, index: LineageIndex): SelectionSpec {
    switch (spec.kind) {
        case 'tree': return { kind: 'tree' };
        case 'rods': return { kind: 'rods', rodIds: spec.rods };
        case 'persons': return { kind: 'persons', personIds: spec.ids };
        case 'gift': return { kind: 'persons', personIds: [...giftCutIds(index, { recipients: [spec.personId], depth: spec.depth, branches: spec.branches ?? {} })] };
        default: return { kind: spec.kind, personId: spec.person, ...(typeof spec.generations === 'number' ? { generations: spec.generations } : {}) };
    }
}

/** The lineages a book of the whole tree tells as chapters; the rest is "Other families". */
export function chapterRods(index: LineageIndex): Rod[] {
    const all = rods(index);
    const big = all.filter(r => !r.small && r.familyIds.length > 0);
    // A small tree without any big lineage still gets chapters.
    return big.length ? big : all.filter(r => r.familyIds.length > 0);
}

export function buildBookModel(data: StromData, spec: BookSelectionSpec, prebuilt?: LineageIndex): BookModel {
    const index = prebuilt && prebuilt.data === data ? prebuilt : buildLineages(data);
    const labels = rodLabels(index);
    const sel = selection(index, lineageSpec(spec, index));
    const chapters: BookChapter[] = [];
    const chapterOf = new Map<PartnershipId, BookChapter>();
    const groups: BookRodGroup[] = [];
    let smallRods: Rod[] = [];

    const depthCache = new Map<PersonId, number>();
    const rodGeneration = (pid: PersonId): number => {
        const known = depthCache.get(pid);
        if (known !== undefined) return known;
        const rod = index.rodByPerson.get(pid) ?? null;
        const chain: PersonId[] = [];
        let cur: PersonId | null = pid;
        let base = 0;
        const guard = new Set<PersonId>();
        while (cur && !guard.has(cur)) {
            guard.add(cur);
            const cached = depthCache.get(cur);
            if (cached !== undefined) { base = cached; break; }
            chain.push(cur);
            const up: PersonId | null = index.lineParent.get(cur) ?? null;
            if (!up || (index.rodByPerson.get(up) ?? null) !== rod) { base = 0; break; }
            cur = up;
        }
        for (let i = chain.length - 1; i >= 0; i--) depthCache.set(chain[i], ++base);
        return depthCache.get(pid) ?? 1;
    };

    const add = (unionId: PartnershipId, rodId: RodId | null, gen: number, memberId: PersonId | null): BookChapter | null => {
        if (chapterOf.has(unionId)) return null;
        const u = data.partnerships[unionId];
        if (!u) return null;
        const ch: BookChapter = { no: chapters.length + 1, unionId, rodId, gen, sub: u.childIds.length === 0, memberId };
        chapters.push(ch);
        chapterOf.set(unionId, ch);
        return ch;
    };

    const memberOf = (unionId: PartnershipId, members: (id: PersonId) => boolean): PersonId | null => {
        const u = data.partnerships[unionId];
        if (!u) return null;
        const both = [u.person1Id, u.person2Id].filter(id => !!id && members(id));
        if (both.length > 1) return both.find(id => data.persons[id]?.gender === 'male') ?? both[0];
        return both[0] ?? null;
    };

    if (spec.kind === 'tree' || spec.kind === 'rods') {
        const told = spec.kind === 'tree'
            ? chapterRods(index)
            : spec.rods.map(id => index.rods.get(id)).filter((r): r is Rod => !!r);
        for (const rod of told) {
            const members = new Set(rod.memberIds);
            const group: BookRodGroup = { rod, label: labels.get(rod.id) ?? rod.surname, chapters: [] };
            for (const uid of rod.familyIds) {
                const m = memberOf(uid, id => members.has(id));
                const ch = add(uid, rod.id, m ? rodGeneration(m) : 1, m);
                if (ch) group.chapters.push(ch);
            }
            groups.push(group);
        }
        if (spec.kind === 'tree') {
            const toldIds = new Set(told.map(r => r.id));
            smallRods = otherFamilyRods(index).filter(r => !toldIds.has(r.id) && r.realMemberCount > 0);
        }
    } else if (spec.kind === 'persons' || spec.kind === 'gift') {
        // Chosen people (a person's family tree too): the families of two chosen partners, oldest first.
        const members = new Set(sel.memberIds);
        // A person's family tree counts its generations from the oldest ancestors (spec 093 §10).
        const level = spec.kind === 'gift' ? giftLevels(data, spec.personId, members) : null;
        const top = level ? Math.min(0, ...level.values()) : 0;
        for (const uid of sel.familyIds) {
            const m = memberOf(uid, id => members.has(id));
            add(uid, null, level && m ? (level.get(m) ?? top) - top + 1 : 1, m);
        }
    } else {
        const members = new Set(sel.memberIds);
        const dist = new Map<PersonId, number>();
        dist.set(spec.person, 0);
        // The selection lists people generation by generation (ancestors) or line by line (descendants).
        for (const id of sel.memberIds) {
            const d = dist.get(id);
            if (d === undefined) continue;
            const p = data.persons[id];
            if (!p) continue;
            const next = spec.kind === 'ancestors' ? p.parentIds : p.childIds;
            for (const n of next) if (members.has(n) && !dist.has(n)) dist.set(n, d + 1);
        }
        const maxD = Math.max(0, ...dist.values());
        const families = spec.kind === 'ancestors' ? [...sel.familyIds].reverse() : sel.familyIds;
        for (const uid of families) {
            const m = memberOf(uid, id => members.has(id));
            const d = m ? dist.get(m) ?? 0 : 0;
            add(uid, null, spec.kind === 'ancestors' ? maxD - d + 1 : d + 1, m);
        }
    }

    const ownChapters = new Map<PersonId, number[]>();
    const birthChapter = new Map<PersonId, number>();
    const personIds = new Set<PersonId>();
    for (const ch of chapters) {
        const u = data.partnerships[ch.unionId];
        for (const id of [u.person1Id, u.person2Id]) {
            if (!id || !data.persons[id]) continue;
            personIds.add(id);
            const list = ownChapters.get(id) ?? [];
            list.push(ch.no);
            ownChapters.set(id, list);
        }
        for (const cid of u.childIds) {
            if (!data.persons[cid]) continue;
            personIds.add(cid);
            if (!birthChapter.has(cid)) birthChapter.set(cid, ch.no);
        }
    }
    for (const g of groups) for (const id of g.rod.memberIds) if (data.persons[id]) personIds.add(id);
    if (spec.kind === 'ancestors' || spec.kind === 'descendants' || spec.kind === 'persons' || spec.kind === 'gift') for (const id of sel.memberIds) personIds.add(id);
    const ownChapter = new Map<PersonId, number>([...ownChapters].map(([id, list]) => [id, list[0]]));

    return {
        index, labels, spec, selection: sel, groups, chapters, chapterOf, ownChapter, ownChapters,
        birthChapter, smallRods, personIds, rodGeneration,
    };
}
