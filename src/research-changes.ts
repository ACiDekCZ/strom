/**
 * Changes per person (A2): what the user changed since the research's last
 * version, person by person — the base is a copy of the tree as the research
 * last gave it (or as it last took it), kept in this browser without images.
 * Pure: no DOM, no storage.
 */

import { StromData, Person, Partnership, Source, EventParticipant, PersonId, LifeEvent, Attachment, PlaceGeo } from './types.js';
import { isPurePlaceholder } from './single-parent.js';
import { collectPlaces } from './places.js';

export type ChangeKind =
    | 'added' | 'deleted' | 'name' | 'gender' | 'birth' | 'death' | 'marriage' | 'event'
    | 'godparent' | 'witness' | 'citation' | 'source' | 'attachment' | 'attachmentRemoved' | 'note' | 'parents' | 'other';

/** The order kinds are told in (the most telling first). */
const KIND_ORDER: ChangeKind[] = ['added', 'deleted', 'name', 'gender', 'birth', 'death', 'marriage', 'event', 'godparent', 'witness',
    'citation', 'source', 'attachment', 'attachmentRemoved', 'note', 'parents', 'other'];

export interface PersonChange {
    personId: PersonId;
    name: string;
    kinds: ChangeKind[];
    /** Removed in the app: no longer in the tree (no link to it). */
    deleted?: boolean;
    /** A removed person's number in the research (its REFN in the base), to pair what the research did not write. */
    refn?: string;
}

const NAME_FIELDS: (keyof Person)[] = ['firstName', 'lastName', 'titleBefore', 'titleAfter', 'marriedSurname', 'nameVariants'];
const BIRTH_FIELDS: (keyof Person)[] = ['birthDate', 'birthPlace', 'birthAddress'];
const DEATH_FIELDS: (keyof Person)[] = ['deathDate', 'deathPlace', 'deathCause', 'deathAge', 'deathAddress', 'isDeceased'];
const CITATION_FIELDS: (keyof Person)[] = ['sourceIds', 'birthSourceIds', 'deathSourceIds'];
/** Not the user's: the research's own knowledge and statuses, and what the app keeps for itself. */
const IGNORED_FIELDS = new Set<string>(['research', 'birthStatus', 'deathStatus', 'photoOriginalName', 'partnerships', 'childIds', 'isLocked',
    'dismissedMarriedSuggestion']);
const MARRIAGE_FIELDS: (keyof Partnership)[] = ['status', 'startDate', 'startPlace', 'endDate', 'endPlace', 'address', 'ages', 'note'];

/** JSON with sorted keys and images reduced to their length (two copies of one tree compare equal). */
export function stable(value: unknown): string {
    return JSON.stringify(value, (_k, v) => {
        if (typeof v === 'string' && v.length >= 256 && v.startsWith('data:')) return `img:${v.length}`;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return Object.keys(v).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = (v as Record<string, unknown>)[k]; return o; }, {});
        }
        return v;
    }) ?? '';
}

const differs = (a: unknown, b: unknown): boolean => stable(a) !== stable(b);
const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`.trim() || '?';
/** The name with its titles ("Ing. Josef Novák st."): a title the load takes away is a value it overwrites (B18-1). */
const titledName = (p: Person): string => [p.titleBefore, p.firstName, p.lastName, p.titleAfter].map(v => v?.trim() ?? '').filter(Boolean).join(' ');

/**
 * The base kept for a tree: the data as the research last had them, images
 * replaced by their length (a photo or scan changed still compares unequal)
 * — small enough to keep beside the tree.
 */
export function baseCopy(data: StromData): StromData {
    // A copy kept before places and surname variants were kept stays without them (not known in it), also
    // when it is kept again (retagged, taken back): an empty list there would read as all of them changed.
    const older = (data as BaseCopy).olderCopy === true;
    const kept = older
        ? { persons: data.persons, partnerships: data.partnerships, sources: data.sources ?? {}, olderCopy: true }
        : { persons: data.persons, partnerships: data.partnerships, sources: data.sources ?? {},
            places: data.places ?? {}, surnameVariants: data.surnameVariants ?? [],
            // The rejected spelling suggestions: what the research holds of them (its "not sent yet").
            surnameRejections: data.surnameRejections ?? [] };
    return JSON.parse(JSON.stringify(kept,
        (_k, v) => typeof v === 'string' && v.length >= 256 && v.startsWith('data:') ? `img:${v.length}` : v)) as StromData;
}

/**
 * A kept copy. `olderCopy`: kept before 3.14 (no places, no surname
 * variants in it) — set when such a copy is read, so it is never taken for
 * a tree without places.
 */
export type BaseCopy = StromData & { olderCopy?: true };

/** Mark a copy read from storage that was kept before places and surname variants were (see BaseCopy). */
export function markOlderCopy(copy: StromData): StromData {
    if (!('places' in copy) && !('surnameVariants' in copy)) (copy as BaseCopy).olderCopy = true;
    return copy;
}

/** Participants added or changed at an event: godparents apart from everyone else. */
function participantKinds(before: EventParticipant[] | undefined, after: EventParticipant[] | undefined): ChangeKind[] {
    if (!differs(before ?? [], after ?? [])) return [];
    const all = [...(before ?? []), ...(after ?? [])];
    const changed = all.filter(p => {
        const other = (before ?? []).find(b => b.id === p.id);
        const now = (after ?? []).find(a => a.id === p.id);
        return !other || !now || differs(other, now);
    });
    const out = new Set<ChangeKind>();
    for (const p of changed) out.add(p.role === 'godparent' ? 'godparent' : 'witness');
    return [...out];
}

function personKinds(before: Person, after: Person): Set<ChangeKind> {
    const kinds = new Set<ChangeKind>();
    if (NAME_FIELDS.some(f => differs(before[f], after[f]))) kinds.add('name');
    if (before.gender !== after.gender) kinds.add('gender');
    if (BIRTH_FIELDS.some(f => differs(before[f], after[f]))) kinds.add('birth');
    if (DEATH_FIELDS.some(f => differs(before[f], after[f]))) kinds.add('death');
    if (CITATION_FIELDS.some(f => differs(before[f] ?? [], after[f] ?? []))) kinds.add('citation');
    if (differs(before.notes ?? '', after.notes ?? '')) kinds.add('note');
    // Events: the event itself, its people, its citations.
    const evBefore = new Map((before.events ?? []).map(e => [e.id, e]));
    const evAfter = new Map((after.events ?? []).map(e => [e.id, e]));
    for (const id of new Set([...evBefore.keys(), ...evAfter.keys()])) {
        const a = evBefore.get(id);
        const b = evAfter.get(id);
        if (!a || !b) { kinds.add(b?.type === 'birth' || a?.type === 'birth' ? 'birth' : 'event'); if (b?.participants?.length) participantKinds([], b.participants).forEach(k => kinds.add(k)); continue; }
        const { participants: pa, sourceIds: sa, status: _st1, ...restA } = a;
        const { participants: pb, sourceIds: sb, status: _st2, ...restB } = b;
        if (differs(restA, restB)) kinds.add('event');
        participantKinds(pa, pb).forEach(k => kinds.add(k));
        if (differs(sa ?? [], sb ?? [])) kinds.add('citation');
    }
    // Attachments: added, removed (by id); a changed note or crop is "other". One that belongs to a
    // source (here or in the research's version) is the source's change, told there (diffOther).
    const ofSource = new Set([...(before.attachments ?? []), ...(after.attachments ?? [])].filter(a => a.sourceId).map(a => a.id));
    const ownAtts = (p: Person): Attachment[] => (p.attachments ?? []).filter(a => !ofSource.has(a.id));
    const attBefore = new Set(ownAtts(before).map(a => a.id));
    const attAfter = new Set(ownAtts(after).map(a => a.id));
    if ([...attAfter].some(id => !attBefore.has(id))) kinds.add('attachment');
    if ([...attBefore].some(id => !attAfter.has(id))) kinds.add('attachmentRemoved');
    // A changed source this person cites is the source's change (diffOther), not the person's: told once.
    // Anything else of the person (gender, the number, the question, the story, parents…).
    const known = new Set<string>([...NAME_FIELDS, ...BIRTH_FIELDS, ...DEATH_FIELDS, ...CITATION_FIELDS, 'gender', 'notes', 'events', 'attachments', 'id']);
    const rest = (p: Person): Record<string, unknown> => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p)) if (!known.has(k) && !IGNORED_FIELDS.has(k)) o[k] = v;
        return o;
    };
    if (differs(rest(before), rest(after))) kinds.add('other');
    if (differs(ownAtts(before).map(a => ({ ...a, dataUrl: undefined })), ownAtts(after).map(a => ({ ...a, dataUrl: undefined })))
        && !kinds.has('attachment') && !kinds.has('attachmentRemoved')) kinds.add('other');
    return kinds;
}

/** What changed for each person since `base` (an empty list: nothing). Sorted by name. */
export function diffByPerson(base: StromData, current: StromData): PersonChange[] {
    const out = new Map<string, { name: string; kinds: Set<ChangeKind>; deleted?: boolean; refn?: string }>();
    const touch = (id: string, name: string): Set<ChangeKind> => {
        let e = out.get(id);
        if (!e) { e = { name, kinds: new Set() }; out.set(id, e); }
        return e.kinds;
    };
    const bp = base.persons as Record<string, Person>;
    const cp = current.persons as Record<string, Person>;

    for (const p of Object.values(cp)) {
        const before = bp[p.id];
        if (!before) {
            if (!p.isPlaceholder) touch(p.id, fullName(p)).add('added');
            continue;
        }
        // A "?" given a name is someone new for the research (it never had the "?"), and its children
        // have a parent they did not have there.
        if (before.isPlaceholder && !p.isPlaceholder) {
            touch(p.id, fullName(p)).add('added');
            for (const cid of p.childIds) if (cp[cid] && !cp[cid].isPlaceholder) touch(cid, fullName(cp[cid])).add('parents');
            continue;
        }
        // Most people did not change: one comparison of the whole record, not one per field.
        if (stable(before) === stable(p)) continue;
        const kinds = personKinds(before, p);
        if (kinds.size) kinds.forEach(k => touch(p.id, fullName(p)).add(k));
    }
    for (const p of Object.values(bp)) {
        if (cp[p.id] || p.isPlaceholder) continue;
        touch(p.id, fullName(p)).add('deleted');
        const e = out.get(p.id)!;
        e.deleted = true;
        if (p.refn?.trim()) e.refn = p.refn.trim();
    }

    // Couples: the wedding and divorce, the witnesses, the couple's events and citations — told at both partners.
    const bu = base.partnerships as Record<string, Partnership>;
    const cu = current.partnerships as Record<string, Partnership>;
    for (const id of new Set([...Object.keys(bu), ...Object.keys(cu)])) {
        const a = bu[id];
        const b = cu[id];
        if (a && b && stable(a) === stable(b)) continue;
        const kinds = new Set<ChangeKind>();
        if (!a || !b) {
            // A family of one parent and a "?" stand-in with children is no marriage (the GEDCOM
            // family has one parent): its parent gains a child, told as a couple's new child is (not at all).
            const u = (b ?? a)!;
            const d = b ? current : base;
            const oneParent = u.childIds.length > 0 && (isPurePlaceholder(d, u.person1Id) || isPurePlaceholder(d, u.person2Id));
            if (!oneParent) kinds.add('marriage');
        } else {
            if (MARRIAGE_FIELDS.some(f => differs(a[f], b[f]))) kinds.add('marriage');
            participantKinds(a.participants, b.participants).forEach(k => kinds.add(k));
            if (differs(a.events ?? [], b.events ?? [])) kinds.add('event');
            if (differs(a.sourceIds ?? [], b.sourceIds ?? [])) kinds.add('citation');
            if (differs(a.story, b.story)) kinds.add('other');
        }
        if (!kinds.size) continue;
        const u = (b ?? a)!;
        for (const pid of [u.person1Id, u.person2Id]) {
            const person = cp[pid] ?? bp[pid];
            if (!person || person.isPlaceholder) continue;
            if (out.get(pid)?.deleted) continue;
            kinds.forEach(k => touch(pid, fullName(person)).add(k));
        }
    }

    return [...out.entries()]
        .map(([personId, e]) => ({
            personId: personId as PersonId,
            name: e.name,
            kinds: KIND_ORDER.filter(k => e.kinds.has(k)),
            ...(e.deleted ? { deleted: true } : {}),
            ...(e.deleted && e.refn ? { refn: e.refn } : {}),
        }))
        .sort((x, y) => x.name.localeCompare(y.name));
}

// ==================== CHANGES BEYOND PEOPLE ====================

export type SourceChangeKind = 'added' | 'deleted' | 'title' | 'transcript' | 'page' | 'excerptAdded' | 'excerptRemoved' | 'attachment' | 'other';
export type CoupleChangeKind = 'childOrder' | 'mainMarriage' | 'marriageEvidence' | 'singleParent';

const SOURCE_KIND_ORDER: SourceChangeKind[] = ['added', 'deleted', 'title', 'transcript', 'page', 'excerptAdded', 'excerptRemoved', 'attachment', 'other'];
const COUPLE_KIND_ORDER: CoupleChangeKind[] = ['childOrder', 'mainMarriage', 'marriageEvidence', 'singleParent'];

/** A source (or an attachment of one) changed since the research's version. */
export interface SourceChange {
    sourceId: string;
    /** The source's title (a deleted one: as the research's version has it; a lone attachment: its file name). */
    title: string;
    kinds: SourceChangeKind[];
    /** Who cites it now: how many people, else a couple (for the row's context line). */
    citedBy: { persons: number; couple?: [PersonId, PersonId] };
    /** Gone from the tree (no link to it). */
    deleted?: boolean;
    /** An attachment whose source is in neither version: the row stands for the attachment alone (no link). */
    attachmentOnly?: boolean;
}

/** A couple's change that the people's rows do not tell. */
export interface CoupleChange {
    partnershipId: string;
    p1: PersonId;
    p2: PersonId;
    kinds: CoupleChangeKind[];
    /** Gone from the tree (no link to it). */
    deleted?: boolean;
}

/** One place whose coordinates changed (lat/lon undefined: none now). */
export interface PlaceChange { key: string; name: string; lat?: number; lon?: number }

/** One surname variant added (or removed) since the research's version. */
export interface VariantChange { surname: string; variant: string; removed?: boolean }

/** What changed beyond the people, against the same copy as diffByPerson. */
export interface OtherChanges {
    sources: SourceChange[];
    couples: CoupleChange[];
    /** undefined: the copy has no places (kept before they were). */
    places?: { count: number; items: PlaceChange[] };
    /** undefined: the copy has no surname variants (kept before they were). */
    surnameVariants?: { count: number; items: VariantChange[] };
}

/** Every source a person cites (the person, the birth, the death, the events). */
function personCites(p: Person): string[] {
    return [...(p.sourceIds ?? []), ...(p.birthSourceIds ?? []), ...(p.deathSourceIds ?? []), ...(p.events ?? []).flatMap(e => e.sourceIds ?? [])];
}

/** Every source a couple cites (the couple, its events). */
function coupleCites(u: Partnership): string[] {
    return [...(u.sourceIds ?? []), ...(u.events ?? []).flatMap(e => e.sourceIds ?? [])];
}

/**
 * Surname variants added and removed: each group now matched to the group
 * of the copy it shares most names with. The surname a variant belongs to is
 * a name of the group the copy already had (a new group: a surname someone in
 * the tree has, else its first).
 */
function variantChanges(before: string[][], after: string[][], known: ReadonlySet<string> = new Set()): VariantChange[] {
    const out: VariantChange[] = [];
    const clean = (g: unknown): string[] => Array.isArray(g) ? g.filter((n): n is string => typeof n === 'string' && !!n.trim()) : [];
    const was = before.map(clean);
    const now = after.map(clean);
    const covered = new Map<number, Set<string>>();
    for (const g of now) {
        let best = -1;
        let bestShared = 0;
        was.forEach((b, i) => {
            const shared = g.filter(n => b.includes(n)).length;
            if (shared > bestShared) { best = i; bestShared = shared; }
        });
        if (best < 0) {
            const surname = g.find(n => known.has(n)) ?? g[0];
            for (const v of g) if (v !== surname) out.push({ surname, variant: v });
            continue;
        }
        const b = was[best];
        const set = covered.get(best) ?? new Set<string>();
        g.forEach(n => set.add(n));
        covered.set(best, set);
        const surname = g.find(n => b.includes(n)) ?? g[0];
        for (const v of g) if (!b.includes(v)) out.push({ surname, variant: v });
    }
    was.forEach((b, i) => {
        const set = covered.get(i);
        const surname = set ? b.find(n => set.has(n)) ?? b[0] : b[0];
        for (const v of b) if (v !== surname && !set?.has(v)) out.push({ surname, variant: v, removed: true });
    });
    return out;
}

/**
 * What changed beyond the people since `base` (the copy of the research's
 * version): sources (with the attachments that belong to one), couples
 * (their children's order, the main marriage, the wedding's evidence, a
 * family of one parent), places' coordinates and surname variants. null: no
 * base. A source's change is told here only — the people citing it keep
 * just their own citations (diffByPerson). Pure.
 */
export function diffOther(base: StromData | null, current: StromData): OtherChanges | null {
    if (!base) return null;
    const bp = base.persons as Record<string, Person>;
    const cp = current.persons as Record<string, Person>;
    const bs = (base.sources ?? {}) as Record<string, Source>;
    const cs = (current.sources ?? {}) as Record<string, Source>;
    const bu = base.partnerships as Record<string, Partnership>;
    const cu = current.partnerships as Record<string, Partnership>;

    // Attachments that belong to a source, of the people in both versions (a new or deleted person's
    // attachments are that person's), by source: added, removed or changed.
    const attChanged = new Map<string, Attachment>();
    for (const id of Object.keys(cp)) {
        const before = bp[id];
        if (!before) continue;
        const a = new Map((before.attachments ?? []).map(x => [x.id, x]));
        const b = new Map((cp[id].attachments ?? []).map(x => [x.id, x]));
        for (const attId of new Set([...a.keys(), ...b.keys()])) {
            const x = a.get(attId);
            const y = b.get(attId);
            if (x && y && !differs(x, y)) continue;
            for (const att of [x, y]) if (att?.sourceId && !attChanged.has(att.sourceId)) attChanged.set(att.sourceId, att);
        }
    }

    const sources: SourceChange[] = [];
    const citedBy = (sid: string): SourceChange['citedBy'] => {
        const persons = Object.values(cp).filter(p => !p.isPlaceholder && personCites(p).includes(sid)).length;
        if (persons > 0) return { persons };
        const u = Object.values(cu).find(x => coupleCites(x).includes(sid));
        return u ? { persons: 0, couple: [u.person1Id, u.person2Id] } : { persons: 0 };
    };
    for (const sid of new Set([...Object.keys(bs), ...Object.keys(cs)])) {
        const a = bs[sid];
        const b = cs[sid];
        const kinds = new Set<SourceChangeKind>();
        if (!b) {
            sources.push({ sourceId: sid, title: a.title?.trim() || sid, kinds: ['deleted'], citedBy: { persons: 0 }, deleted: true });
            continue;
        }
        if (!a) {
            kinds.add('added');
            if (b.transcript?.trim()) kinds.add('transcript');
            if (b.excerpts?.length) kinds.add('excerptAdded');
        } else if (differs(a, b)) {
            if (differs(a.title ?? '', b.title ?? '')) kinds.add('title');
            if (differs(a.transcript ?? '', b.transcript ?? '')) kinds.add('transcript');
            if (differs(a.reference ?? '', b.reference ?? '')) kinds.add('page');
            const ea = new Map((a.excerpts ?? []).map(e => [e.id, e]));
            const eb = new Map((b.excerpts ?? []).map(e => [e.id, e]));
            if ([...eb.keys()].some(id => !ea.has(id))) kinds.add('excerptAdded');
            if ([...ea.keys()].some(id => !eb.has(id))) kinds.add('excerptRemoved');
            // Anything else of the entry (the archive, the date, a re-cropped excerpt, the reading…).
            const { title: _t1, transcript: _r1, reference: _p1, excerpts: ex1, ...restA } = a;
            const { title: _t2, transcript: _r2, reference: _p2, excerpts: ex2, ...restB } = b;
            const sameExcerpts = (ex1 ?? []).filter(e => eb.has(e.id)).every(e => !differs(e, eb.get(e.id)));
            if (differs(restA, restB) || !sameExcerpts) kinds.add('other');
        }
        if (attChanged.has(sid)) kinds.add('attachment');
        if (!kinds.size) continue;
        sources.push({ sourceId: sid, title: b.title?.trim() || sid, kinds: SOURCE_KIND_ORDER.filter(k => kinds.has(k)), citedBy: citedBy(sid) });
    }
    // An attachment naming a source that is in neither version: a row of its own, named by its file.
    for (const [sid, att] of attChanged) {
        if (bs[sid] || cs[sid]) continue;
        sources.push({ sourceId: sid, title: att.name || sid, kinds: ['attachment'], citedBy: { persons: 0 }, attachmentOnly: true });
    }
    sources.sort((x, y) => x.title.localeCompare(y.title));

    // Couples: what the people's rows do not tell.
    const couples: CoupleChange[] = [];
    for (const id of new Set([...Object.keys(bu), ...Object.keys(cu)])) {
        const a = bu[id];
        const b = cu[id];
        const kinds = new Set<CoupleChangeKind>();
        if (!a || !b) {
            // A family of one parent and a "?" stand-in (diffByPerson tells it at nobody).
            const u = (b ?? a)!;
            const d = b ? current : base;
            if (u.childIds.length > 0 && (isPurePlaceholder(d, u.person1Id) || isPurePlaceholder(d, u.person2Id))) kinds.add('singleParent');
        } else if (stable(a) !== stable(b)) {
            const sameSet = a.childIds.length === b.childIds.length && a.childIds.every(c => b.childIds.includes(c));
            if (sameSet && a.childIds.some((c, i) => b.childIds[i] !== c)) kinds.add('childOrder');
            if (!!a.isPrimary !== !!b.isPrimary) kinds.add('mainMarriage');
            if ((a.startStatus ?? '') !== (b.startStatus ?? '') || (a.endStatus ?? '') !== (b.endStatus ?? '')) kinds.add('marriageEvidence');
        }
        if (!kinds.size) continue;
        const u = (b ?? a)!;
        couples.push({ partnershipId: id, p1: u.person1Id, p2: u.person2Id, kinds: COUPLE_KIND_ORDER.filter(k => kinds.has(k)), ...(b ? {} : { deleted: true }) });
    }
    const coupleKey = (c: CoupleChange): string => [c.p1, c.p2].map(pid => cp[pid] ?? bp[pid]).filter(p => p && !p.isPlaceholder).map(p => fullName(p!)).join(' ');
    couples.sort((x, y) => coupleKey(x).localeCompare(coupleKey(y)));

    // Places: coordinates only (a renamed place moves its key, the names are the people's change).
    let places: OtherChanges['places'];
    if (base.places !== undefined) {
        const pa = (base.places ?? {}) as Record<string, PlaceGeo>;
        const pb = (current.places ?? {}) as Record<string, PlaceGeo>;
        const names = collectPlaces(current);
        const items: PlaceChange[] = [];
        for (const key of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
            const x = pa[key];
            const y = pb[key];
            if (x && y && x.lat === y.lat && x.lon === y.lon) continue;
            items.push({ key, name: names.get(key)?.display ?? (y ?? x)?.label?.split(',')[0]?.trim() ?? key, ...(y ? { lat: y.lat, lon: y.lon } : {}) });
        }
        items.sort((x, y) => x.name.localeCompare(y.name));
        places = { count: items.length, items };
    }

    let surnameVariants: OtherChanges['surnameVariants'];
    if (base.surnameVariants !== undefined) {
        const known = new Set(Object.values(cp).flatMap(p => [p.lastName, p.marriedSurname ?? ''].map(n => n.trim()).filter(Boolean)));
        const items = variantChanges(base.surnameVariants ?? [], current.surnameVariants ?? [], known);
        surnameVariants = { count: items.length, items };
    }

    return { sources, couples, ...(places ? { places } : {}), ...(surnameVariants ? { surnameVariants } : {}) };
}

/** Rows beyond the people (the places and the surname variants are one row each). */
export function otherRowCount(o: OtherChanges | null): number {
    if (!o) return 0;
    return o.sources.length + o.couples.length + (o.places?.count ? 1 : 0) + (o.surnameVariants?.count ? 1 : 0);
}

/**
 * "What will be sent" cannot tell its list exactly: there is no base to compare with (`persons` null — the copy
 * not read yet, a restore before loading, a send taken back with no copy before it), the caller knows the base
 * moved (`opts.inexact`), or, about to send, nothing it could name although the tree is not where the
 * research's version is. An empty list of people with other rows is exact.
 */
export function previewInexact(persons: readonly PersonChange[] | null, other: OtherChanges | null, opts: { confirm?: boolean; inexact?: boolean } = {}): boolean {
    if (persons === null || opts.inexact) return true;
    return !!opts.confirm && persons.length === 0 && otherRowCount(other) === 0;
}

// ==================== WHAT THE RESEARCH DOES NOT READ ====================

/**
 * Kinds of change the research does not read from the app's file at all
 * (Strom Research 1.18, its answer 3c): the order of children and of
 * marriages, the main marriage (no GEDCOM for it), the evidence status of a
 * wedding (`_STROM_STATUS`), a source's images and attachments (OBJE,
 * `_STROM_CLIP`), removed coordinates of a place and the groups of surname
 * variants. Such a change stays in the app only. Empty: the research reads
 * everything (no "app only" anywhere).
 */
export const RESEARCH_UNREAD_KINDS: ReadonlySet<string> = new Set([
    'source.excerptAdded', 'source.excerptRemoved', 'source.attachment',
    'couple.childOrder', 'couple.mainMarriage', 'couple.marriageEvidence',
    'places.removed', 'variants',
]);

/** Every one of a row's kinds is one the research does not read (a row with none is read). */
function allUnread(keys: readonly string[], unread: ReadonlySet<string>): boolean {
    return keys.length > 0 && keys.every(k => unread.has(k));
}

export function sourceAppOnly(kinds: readonly SourceChangeKind[], unread: ReadonlySet<string> = RESEARCH_UNREAD_KINDS): boolean {
    return allUnread(kinds.map(k => `source.${k}`), unread);
}

export function coupleAppOnly(kinds: readonly CoupleChangeKind[], unread: ReadonlySet<string> = RESEARCH_UNREAD_KINDS): boolean {
    return allUnread(kinds.map(k => `couple.${k}`), unread);
}

/** The places' row: only removed coordinates (new and changed ones are read). */
export function placesAppOnly(items: readonly PlaceChange[], unread: ReadonlySet<string> = RESEARCH_UNREAD_KINDS): boolean {
    return allUnread(items.map(p => (p.lat === undefined || p.lon === undefined ? 'places.removed' : 'places.coords')), unread);
}

export function variantsAppOnly(unread: ReadonlySet<string> = RESEARCH_UNREAD_KINDS): boolean {
    return unread.has('variants');
}

// ==================== WHAT A SEND CARRIED BEYOND THE PEOPLE ====================

/**
 * One row beyond the people as a send carried it, kept for "What was
 * written": a source, a couple, the places' or the surname variants' summary
 * (their count). `appOnly`: the research does not read it.
 */
export interface SentOtherRow {
    type: 'source' | 'couple' | 'places' | 'variants';
    /** The source's id, the partnership's id; '' for a summary. */
    id: string;
    /** The source's title as sent ('' for the others: told from the tree). */
    title: string;
    kinds: string[];
    p1?: PersonId;
    p2?: PersonId;
    count?: number;
    /** The one surname of the variants' row, when there is one. */
    surname?: string;
    deleted?: true;
    appOnly?: true;
}

/** The rows beyond the people a send carries, in the panel's order. */
export function sentOtherRows(other: OtherChanges | null, unread: ReadonlySet<string> = RESEARCH_UNREAD_KINDS): SentOtherRow[] {
    if (!other) return [];
    const out: SentOtherRow[] = [];
    for (const s of other.sources) {
        out.push({ type: 'source', id: s.sourceId, title: s.title, kinds: [...s.kinds],
            ...(s.deleted || s.attachmentOnly ? { deleted: true as const } : {}), ...(sourceAppOnly(s.kinds, unread) ? { appOnly: true as const } : {}) });
    }
    for (const c of other.couples) {
        out.push({ type: 'couple', id: c.partnershipId, title: '', kinds: [...c.kinds], p1: c.p1, p2: c.p2,
            ...(c.deleted ? { deleted: true as const } : {}), ...(coupleAppOnly(c.kinds, unread) ? { appOnly: true as const } : {}) });
    }
    if (other.places?.count) {
        out.push({ type: 'places', id: '', title: '', kinds: [], count: other.places.count, ...(placesAppOnly(other.places.items, unread) ? { appOnly: true as const } : {}) });
    }
    if (other.surnameVariants?.count) {
        const v = other.surnameVariants;
        const surnames = new Set(v.items.map(i => i.surname));
        out.push({ type: 'variants', id: '', title: '', kinds: [], count: v.count, ...(surnames.size === 1 ? { surname: [...surnames][0] } : {}),
            ...(variantsAppOnly(unread) ? { appOnly: true as const } : {}) });
    }
    return out;
}

/** A kept row, checked (untrusted: from storage). */
export function sanitizeSentOtherRow(v: unknown): SentOtherRow | null {
    const r = v as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return null;
    const type = r.type === 'source' || r.type === 'couple' || r.type === 'places' || r.type === 'variants' ? r.type : null;
    if (!type) return null;
    const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '');
    const count = typeof r.count === 'number' && r.count > 0 ? Math.floor(r.count) : undefined;
    return {
        type, id: str(r.id, 80), title: str(r.title, 300),
        kinds: Array.isArray(r.kinds) ? r.kinds.filter((k): k is string => typeof k === 'string').slice(0, 12) : [],
        ...(typeof r.p1 === 'string' ? { p1: r.p1 as PersonId } : {}),
        ...(typeof r.p2 === 'string' ? { p2: r.p2 as PersonId } : {}),
        ...(count ? { count } : {}),
        ...(typeof r.surname === 'string' && r.surname ? { surname: r.surname.slice(0, 120) } : {}),
        ...(r.deleted === true ? { deleted: true as const } : {}),
        ...(r.appOnly === true ? { appOnly: true as const } : {}),
    };
}

// ==================== WHAT THE RESEARCH DID NOT WRITE ====================

/** One change the research named as not written, as kept (research-device `ResearchNotWritten.items`). */
export interface NotWrittenItem {
    person: string;
    fact: string;
    why: string;
    name?: string;
    family?: string;
    /** The research's source ("S0012") or the sent file's xref of one it does not have ("@S12@"). */
    source?: string;
    /** That source in the app, when the send's file told it (its xref). */
    sourceId?: string;
    /** A place by its name as the file has it (`place.coords`). */
    place?: string;
    /** `why: removed`: the research's send that removed the person ("I0042"). */
    removedBy?: string;
}

/** A not-written item put to what it is about here. */
export type PairedNotWritten =
    /** `deleted`: a person this send removed here (by its number in the research), named as it was. */
    | { type: 'person'; item: NotWrittenItem; personId: PersonId | null; deleted?: { name: string } }
    | { type: 'source'; item: NotWrittenItem; sourceId: string; title: string }
    | { type: 'places'; item: NotWrittenItem; place: string };

/**
 * Put what the research did not write to its rows: a person (as before, also
 * one the tree no longer has: its name), a source (by the app's id from the
 * send, else the research's number), a place. What names none of them, or a
 * source the tree does not have, is counted as not named (`unnamed`): the
 * app does not know the research's families (a couple's item without a person).
 * A person the tree no longer has is paired with the send's removal of it
 * (`sent`, by its number in the research): the window had that person.
 */
export function pairNotWritten(items: readonly NotWrittenItem[], data: StromData, sent: readonly PersonChange[] = []): { rows: PairedNotWritten[]; unnamed: number } {
    const rows: PairedNotWritten[] = [];
    let unnamed = 0;
    const sources = (data.sources ?? {}) as Record<string, Source>;
    let byRefn: Map<string, string> | null = null;
    const sourceByRef = (ref: string): string | null => {
        if (!byRefn) {
            byRefn = new Map();
            for (const s of Object.values(sources)) if (s?.refn?.trim()) byRefn.set(s.refn.trim(), s.id);
        }
        return byRefn.get(ref) ?? null;
    };
    for (const item of items) {
        if (item.person) {
            const hit = Object.values(data.persons ?? {}).find(p => p?.refn?.trim() === item.person);
            const removed = hit ? undefined : sent.find(ch => ch.deleted && ch.refn === item.person);
            rows.push(removed
                ? { type: 'person', item, personId: removed.personId, deleted: { name: removed.name } }
                : { type: 'person', item, personId: hit ? hit.id : null });
            continue;
        }
        if (item.source) {
            const id = item.sourceId && sources[item.sourceId] ? item.sourceId : sourceByRef(item.source);
            if (id && sources[id]) {
                rows.push({ type: 'source', item, sourceId: id, title: sources[id].title?.trim() || item.source });
                continue;
            }
        } else if (item.place) {
            rows.push({ type: 'places', item, place: item.place });
            continue;
        } else if (item.name) {
            // A person the research named by name only (`child.gone`): a row as before.
            rows.push({ type: 'person', item, personId: null });
            continue;
        }
        unnamed++;
    }
    return { rows, unnamed };
}

// ==================== VALUES THE RESEARCH'S VERSION WOULD OVERWRITE ====================

/** Which value a row is about (the UI names it). */
export type ValueField =
    | 'name' | 'marriedSurname' | 'gender' | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace' | 'deathCause' | 'notes'
    | 'person' | 'event' | 'eventDate' | 'eventPlace' | 'eventValue' | 'citation' | 'marriageDate' | 'marriagePlace';

/** One value here that loading the research's version replaces or removes. */
export interface ValueChange {
    /** The person (a couple: the first partner), for the name column and selecting. */
    personId: PersonId;
    /** The person's name ("Jan Fíšek"; a couple "Jan Fíšek & Anna Fíšková"). */
    name: string;
    field: ValueField;
    /** The event's type for event rows; the fact a citation belongs to ('birth', 'death', 'person' or an event type). */
    of?: string;
    /** As it is here, and as the research's version has it ('' = none). Dates as stored (flex dates). */
    here: string;
    there: string;
    /** The field holds a date (the UI formats it). */
    date?: boolean;
    /** An open conflict of the research is about this fact. */
    conflict?: boolean;
}

export interface ValueDiff {
    /** Values here that change or go, in person order. */
    rows: ValueChange[];
    /** People the research's version adds. */
    addedPersons: number;
    /** Facts it adds where there are none here (on people here and on the added ones). */
    addedFacts: number;
    /**
     * Of those, the values it puts into a field of a person here that is
     * empty here (a deleted date coming back), one each as a row would say
     * it (`here` empty) — counted in addedFacts, never listed as rows. A
     * married surname is the exception: it changes the name on the card, so
     * it comes as a row with `here` empty, not here.
     */
    filled: ValueChange[];
}

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';

/** The open conflicts of a person in the research's version, by fact tag. */
function openConflictFacts(p: Person | undefined): Set<string> {
    return new Set((p?.research?.conflicts ?? []).filter(c => c.status === 'open').map(c => c.fact.toUpperCase()));
}

const EVENT_TAG: Record<string, string> = {
    baptism: 'BAPM', burial: 'BURI', occupation: 'OCCU', residence: 'RESI', emigration: 'EMIG', immigration: 'IMMI',
    education: 'EDUC', religion: 'RELI', confirmation: 'CONF', firstCommunion: 'FCOM', cremation: 'CREM', title: 'TITL',
};

/** The titles of sources (or their ids when unnamed), sorted. */
function sourceTitles(ids: readonly string[], sources: Record<string, Source>): string {
    return ids.map(id => sources[id]?.title?.trim() || id).sort((a, b) => a.localeCompare(b)).join(', ');
}

/** What a fact of a new person adds: its filled fields and events. */
function factsOf(p: Person): number {
    const fields: (keyof Person)[] = ['birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'deathCause'];
    return fields.filter(f => str(p[f])).length + (p.events?.length ?? 0);
}

/**
 * A person's events here paired with theirs in the research's version: by id first — but an event read
 * from a GEDCOM gets a new id at every reading (the file has none of its own), so then by what it says
 * (type, label, date, place, value, house), by type, label and date, and by type alone where one each is
 * left. Unpaired: gone here, added there.
 */
export function pairEvents(here: readonly LifeEvent[], there: readonly LifeEvent[]): Map<LifeEvent, LifeEvent> {
    const out = new Map<LifeEvent, LifeEvent>();
    const left = new Set(there);
    const take = (key: (e: LifeEvent) => string): void => {
        const byKey = new Map<string, LifeEvent[]>();
        for (const t of left) {
            const k = key(t);
            byKey.set(k, [...(byKey.get(k) ?? []), t]);
        }
        for (const h of here) {
            if (out.has(h)) continue;
            const t = byKey.get(key(h))?.find(x => left.has(x));
            if (!t) continue;
            out.set(h, t);
            left.delete(t);
        }
    };
    take(e => `id\u0000${e.id}`);
    take(e => [e.type, e.customLabel, e.date, e.place, e.note, e.address].map(str).join('\u0000'));
    take(e => [e.type, e.customLabel, e.date].map(str).join('\u0000'));
    // One of a type left on each side: the same event, its values changed.
    const restHere = here.filter(h => !out.has(h));
    for (const h of restHere) {
        const same = (e: LifeEvent): boolean => e.type === h.type && str(e.customLabel) === str(h.customLabel);
        const theirs = [...left].filter(same);
        if (theirs.length === 1 && restHere.filter(same).length === 1) {
            out.set(h, theirs[0]);
            left.delete(theirs[0]);
        }
    }
    return out;
}

/**
 * Values the research's version (`there`) would put over the tree here:
 * every value here that changes or goes, one row each (a value only there
 * is counted as added, not listed). Matched by id — `there` stabilized to
 * this tree's ids. Pure.
 */
export function diffValues(here: StromData, there: StromData): ValueDiff {
    const rows: ValueChange[] = [];
    const filled: ValueChange[] = [];
    let addedFacts = 0;
    const hp = here.persons as Record<string, Person>;
    const tp = there.persons as Record<string, Person>;
    const hs = (here.sources ?? {}) as Record<string, Source>;
    const ts = (there.sources ?? {}) as Record<string, Source>;
    const people = Object.values(hp).filter(p => !p.isPlaceholder).sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const field = (p: Person, f: ValueField, a: string, b: string, extra: Partial<ValueChange> = {}): void => {
        if (a === b) return;
        const row: ValueChange = { personId: p.id, name: fullName(p), field: f, here: a, there: b, ...extra };
        // A married surname coming into an empty field changes the name the
        // card shows (emptied in the app, the research still has it): said
        // as a row ("– → Nováková"), not counted among the added facts.
        if (!a && f !== 'marriedSurname') {
            addedFacts++;
            filled.push(row);
            return;
        }
        rows.push(row);
    };
    for (const h of people) {
        const t = tp[h.id];
        if (!t) {
            rows.push({ personId: h.id, name: fullName(h), field: 'person', here: fullName(h), there: '' });
            continue;
        }
        if (stable(h) === stable(t)) continue;
        const open = openConflictFacts(t);
        field(h, 'name', fullName(h) === '?' ? '' : titledName(h), fullName(t) === '?' ? '' : titledName(t),
            open.has('NAME') || open.has('NPFX') || open.has('NSFX') ? { conflict: true } : {});
        field(h, 'marriedSurname', str(h.marriedSurname), str(t.marriedSurname), open.has('NAME') ? { conflict: true } : {});
        if (h.gender !== t.gender && h.gender && t.gender) rows.push({ personId: h.id, name: fullName(h), field: 'gender', here: h.gender, there: t.gender, ...(open.has('SEX') ? { conflict: true } : {}) });
        const birth = open.has('BIRT') ? { conflict: true } : {};
        const death = open.has('DEAT') ? { conflict: true } : {};
        field(h, 'birthDate', str(h.birthDate), str(t.birthDate), { date: true, ...birth });
        field(h, 'birthPlace', str(h.birthPlace), str(t.birthPlace), birth);
        field(h, 'deathDate', str(h.deathDate), str(t.deathDate), { date: true, ...death });
        field(h, 'deathPlace', str(h.deathPlace), str(t.deathPlace), death);
        field(h, 'deathCause', str(h.deathCause), str(t.deathCause), death);
        field(h, 'notes', str(h.notes), str(t.notes));
        // Events paired (by id, else by what they say): their date, place, value; one here only goes.
        const paired = pairEvents(h.events ?? [], t.events ?? []);
        for (const e of h.events ?? []) {
            const o = paired.get(e);
            const ev = { of: e.type, ...(open.has(EVENT_TAG[e.type] ?? '') ? { conflict: true } : {}) };
            if (!o) {
                rows.push({ personId: h.id, name: fullName(h), field: 'event', here: str(e.note) || str(e.date) || str(e.place) || e.type, there: '', ...ev,
                    ...(!str(e.note) && str(e.date) ? { date: true } : {}) });
                continue;
            }
            field(h, 'eventDate', str(e.date), str(o.date), { date: true, ...ev });
            field(h, 'eventPlace', str(e.place), str(o.place), ev);
            field(h, 'eventValue', str(e.note), str(o.note), ev);
            // Its citations: a source cited here and not there goes.
            const gone = (e.sourceIds ?? []).filter(id => !(o.sourceIds ?? []).includes(id));
            if (gone.length) rows.push({ personId: h.id, name: fullName(h), field: 'citation', of: e.type, here: sourceTitles(gone, hs), there: sourceTitles(o.sourceIds ?? [], ts) });
        }
        const pairedThere = new Set(paired.values());
        addedFacts += (t.events ?? []).filter(e => !pairedThere.has(e)).length;
        // Citations of the person, the birth, the death: what is cited here and not there.
        for (const [key, of] of [['sourceIds', 'person'], ['birthSourceIds', 'birth'], ['deathSourceIds', 'death']] as const) {
            const a = h[key] ?? [];
            const b = t[key] ?? [];
            const gone = a.filter(id => !b.includes(id));
            if (gone.length) rows.push({ personId: h.id, name: fullName(h), field: 'citation', of, here: sourceTitles(gone, hs), there: sourceTitles(b, ts) });
            addedFacts += b.filter(id => !a.includes(id)).length;
        }
    }
    // Couples: the wedding's date and place.
    const hu = here.partnerships as Record<string, Partnership>;
    const tu = there.partnerships as Record<string, Partnership>;
    for (const u of Object.values(hu)) {
        const o = tu[u.id];
        const a = hp[u.person1Id];
        const b = hp[u.person2Id];
        if (!o || !a) continue;
        const who = { ...a, firstName: [fullName(a), b && !b.isPlaceholder ? fullName(b) : ''].filter(Boolean).join(' & '), lastName: '' } as Person;
        field(who, 'marriageDate', str(u.startDate), str(o.startDate), { date: true });
        field(who, 'marriagePlace', str(u.startPlace), str(o.startPlace));
    }
    const added = Object.values(tp).filter(p => !p.isPlaceholder && !hp[p.id]);
    addedFacts += added.reduce((n, p) => n + factsOf(p), 0);
    return { rows, addedPersons: added.length, addedFacts, filled };
}
