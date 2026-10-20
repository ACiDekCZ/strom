/**
 * "Read a document" (spec 013), the tree suggestion: what an entry of a
 * reading would add to the tree. Per person a choice (new / link / no) with
 * its default, the events and relationships with what is already in the
 * tree, what a linked person gains and where the entry differs from it, and
 * the counts on the button. Pure functions over the tree's data (no DOM, no
 * writes); the dialog draws from them and writes on the click.
 */

import type { Gender, LifeEvent, LifeEventType, Person, PersonId, StromData, Partnership, PartnershipId } from './types.js';
import type { ReadEntry, ReadEvent, ReadPerson, ReadVariant } from './research-read.js';
import { researchPersonRef } from './research-link.js';
import { gedcomTagEventType, parseGedcomDate } from './ged-parser.js';
import { quickMatch, QuickMatchReason } from './merge/matching.js';

export type ProposeChoice = 'new' | 'link' | 'skip';

/** Roles that are not written by default (they stay in the transcription). */
export const SKIP_ROLES: ReadonlySet<string> = new Set(['godparent', 'witness', 'midwife', 'priest', 'informant', 'mentioned', 'writer', 'other']);

/** Roles an entry is about (its events belong to them when the event does not say). */
const PRINCIPAL_ROLES: ReadonlySet<string> = new Set(['principal', 'child', 'groom', 'bride', 'deceased', '']);

/** A quick match from this score on is a candidate (as on a card's "Also in"). */
export const MATCH_THRESHOLD = 50;

/** A tree person an entry's person may be. */
export interface ProposeCandidate {
    id: PersonId;
    /** Found by the research's own match (its REFN), not by the app's matching. */
    byResearch: boolean;
    score: number;
    reasons: QuickMatchReason[];
    /** The research's words why ('' = none). */
    why: string;
}

/** One person's choice in the suggestion. */
export interface ProposePerson {
    ref: string;
    choice: ProposeChoice;
    /** The tree person linked ('' = none chosen yet). */
    target: PersonId | '';
    candidate: ProposeCandidate | null;
    /** The names a new person gets (editable). */
    given: string;
    surname: string;
    /** The user changed the field: it is theirs, not an uncertain reading. */
    edited: { given: boolean; surname: boolean };
}

/** The suggestion of one entry: the choices per person and the ticks the user changed. */
export interface ProposeState {
    readId: string;
    entryId: string;
    persons: Record<string, ProposePerson>;
    /** Items ticked or unticked by hand (key → ticked). */
    ticks: Record<string, boolean>;
}

/** An event or a relationship of the entry, as the suggestion lists it. */
export interface ProposeItem {
    key: string;
    kind: 'event' | 'relation';
    /** Index into `entry.events` or `entry.relations`. */
    index: number;
    /** The entry's persons it concerns (refs). */
    refs: string[];
    /** Already in the tree: nothing to add. */
    inTree: boolean;
    /** A person of it is not written. */
    skipped: boolean;
    /** The tree says otherwise (a date): not overwritten. */
    differs: { what: string; tree: string; entry: string } | null;
    /** Written on the click. */
    checked: boolean;
    /** Can be ticked or unticked. */
    enabled: boolean;
}

/** What a linked person gains from the entry. */
export interface LinkAddition {
    kind: 'occupation' | 'residence' | 'variant' | 'sex';
    value: string;
}

/** A value of a linked person the entry gives differently (never overwritten). */
export interface LinkDifference {
    what: 'given' | 'surname' | 'sex' | 'birth' | 'death';
    tree: string;
    entry: string;
}

/** The person's sex as read, else as its role implies. */
export function readGender(p: Pick<ReadPerson, 'sex' | 'role'>): Gender {
    if (p.sex === 'M') return 'male';
    if (p.sex === 'F') return 'female';
    if (p.role === 'father' || p.role === 'groom') return 'male';
    if (p.role === 'mother' || p.role === 'bride' || p.role === 'midwife') return 'female';
    return 'unknown';
}

/** A read date as the app keeps it ('' = none). */
export function readEventDate(ev: Pick<ReadEvent, 'date'>): string {
    const g = ev.date?.gedcom?.trim();
    if (!g) return '';
    try { return parseGedcomDate(g) || ''; } catch { return ''; }
}

/** The entry's persons an event belongs to: those it names as principals, else by the entry's roles. */
export function eventPrincipals(entry: Pick<ReadEntry, 'persons'>, ev: Pick<ReadEvent, 'type' | 'persons'>): string[] {
    const known = new Set(entry.persons.map(p => p.ref));
    const named = ev.persons.filter(x => known.has(x.ref) && PRINCIPAL_ROLES.has(x.role)).map(x => x.ref);
    if (named.length > 0) return [...new Set(named)];
    const tag = ev.type.toUpperCase();
    const roles = tag === 'MARR' ? ['groom', 'bride']
        : tag === 'DEAT' || tag === 'BURI' ? ['deceased']
            : tag === 'BAPM' || tag === 'BIRT' || tag === 'CHR' ? ['child'] : [];
    const byRole = entry.persons.filter(p => roles.includes(p.role)).map(p => p.ref);
    if (byRole.length > 0) return byRole;
    // One person in the event's own list: it is theirs.
    const own = ev.persons.filter(x => known.has(x.ref)).map(x => x.ref);
    return own.length === 1 ? own : [];
}

function draftId(ref: string): PersonId {
    return `read_${ref}` as PersonId;
}

/** The entry as a small tree of its own (for matching its persons against the tree with their relatives). */
export function draftData(entry: ReadEntry): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    for (const p of entry.persons) {
        persons[draftId(p.ref)] = {
            id: draftId(p.ref), firstName: p.given, lastName: p.surname, gender: readGender(p), isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [],
        };
    }
    for (const ev of entry.events) {
        const tag = ev.type.toUpperCase();
        const date = readEventDate(ev);
        if (!date) continue;
        for (const ref of eventPrincipals(entry, ev)) {
            const d = persons[draftId(ref)];
            if (!d) continue;
            if ((tag === 'BIRT' || tag === 'BAPM' || tag === 'CHR') && !d.birthDate) d.birthDate = date;
            if ((tag === 'DEAT' || tag === 'BURI') && !d.deathDate) d.deathDate = date;
        }
    }
    let n = 0;
    const couple = (a: string, b: string): void => {
        const pa = persons[draftId(a)];
        const pb = persons[draftId(b)];
        if (!pa || !pb || pa === pb) return;
        if (pa.partnerships.some(id => partnerships[id]?.person1Id === pb.id || partnerships[id]?.person2Id === pb.id)) return;
        const id = `read_u${++n}` as PartnershipId;
        partnerships[id] = { id, person1Id: pa.id, person2Id: pb.id, childIds: [], status: 'married' } as unknown as Partnership;
        pa.partnerships.push(id);
        pb.partnerships.push(id);
    };
    for (const r of entry.relations) {
        if (r.type === 'spouse') couple(r.a, r.b);
        else {
            const parent = persons[draftId(r.parent)];
            const child = persons[draftId(r.child)];
            if (!parent || !child || parent === child) continue;
            if (!child.parentIds.includes(parent.id)) child.parentIds.push(parent.id);
            if (!parent.childIds.includes(child.id)) parent.childIds.push(child.id);
        }
    }
    for (const ev of entry.events) {
        if (ev.type.toUpperCase() !== 'MARR') continue;
        const pr = eventPrincipals(entry, ev);
        if (pr.length === 2) couple(pr[0], pr[1]);
    }
    return { persons, partnerships } as unknown as StromData;
}

/** The tree person a research's match names (its REFN "P0042"), or null. */
function researchCandidate(p: ReadPerson, data: StromData, taken: ReadonlySet<string>): ProposeCandidate | null {
    for (const m of p.match) {
        const ref = researchPersonRef(m.person);
        if (!ref) continue;
        const hit = Object.values(data.persons).find(x => !x.isPlaceholder && x.refn?.trim() === ref);
        if (hit && !taken.has(hit.id)) return { id: hit.id, byResearch: true, score: 100, reasons: ['name'], why: m.why };
    }
    return null;
}

/** The research's match first, else the one tree person the app's matching finds above the threshold. */
export function findCandidate(entry: ReadEntry, p: ReadPerson, data: StromData, draft: StromData, taken: ReadonlySet<string> = new Set()): ProposeCandidate | null {
    const research = researchCandidate(p, data, taken);
    if (research) return research;
    const me = draft.persons[draftId(p.ref)];
    if (!me || !`${me.firstName}${me.lastName}`.trim()) return null;
    let best: ProposeCandidate | null = null;
    let tie = false;
    for (const other of Object.values(data.persons)) {
        if (other.isPlaceholder || taken.has(other.id)) continue;
        const q = quickMatch(me, other, draft, data);
        if (q.score < MATCH_THRESHOLD) continue;
        if (!best || q.score > best.score) { best = { id: other.id, byResearch: false, score: q.score, reasons: q.reasons, why: '' }; tie = false; }
        else if (q.score === best.score) tie = true;
    }
    // Two tree persons fit equally: the choice is the user's.
    return tie ? null : best;
}

/** The suggestion as it opens: a candidate links, no candidate is new, a godparent or witness is not written. */
export function initialPropose(readId: string, entry: ReadEntry, data: StromData): ProposeState {
    const draft = draftData(entry);
    const taken = new Set<string>();
    const persons: Record<string, ProposePerson> = {};
    // The entry's own people pick their candidates first; no two persons link to one tree person.
    const order = [...entry.persons].sort((a, b) => Number(SKIP_ROLES.has(a.role)) - Number(SKIP_ROLES.has(b.role)));
    for (const p of order) {
        const skip = SKIP_ROLES.has(p.role);
        const candidate = skip ? null : findCandidate(entry, p, data, draft, taken);
        if (candidate) taken.add(candidate.id);
        persons[p.ref] = {
            ref: p.ref,
            choice: skip ? 'skip' : candidate ? 'link' : 'new',
            target: candidate?.id ?? '',
            candidate,
            given: p.given, surname: p.surname,
            edited: { given: false, surname: false },
        };
    }
    return { readId, entryId: entry.id, persons, ticks: {} };
}

/**
 * The suggestion again for a new result of the same entry (a second reader):
 * the choices made stay, a person new in the result gets its default.
 */
export function carryPropose(prev: ProposeState, readId: string, entry: ReadEntry, data: StromData): ProposeState {
    const fresh = initialPropose(readId, entry, data);
    for (const [ref, p] of Object.entries(fresh.persons)) {
        const old = prev.persons[ref];
        if (!old) continue;
        fresh.persons[ref] = {
            ...p,
            choice: old.choice,
            target: old.target,
            given: old.edited.given ? old.given : p.given,
            surname: old.edited.surname ? old.surname : p.surname,
            edited: { ...old.edited },
        };
    }
    fresh.ticks = { ...prev.ticks };
    return fresh;
}

/** The tree person a person is linked to (null: not linked, or gone). */
export function linkedPerson(state: ProposeState, ref: string, data: StromData): Person | null {
    const p = state.persons[ref];
    if (!p || p.choice !== 'link' || !p.target) return null;
    return data.persons[p.target] ?? null;
}

function fold(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The tree's events of a type on a person (birth and death are the person's own fields). */
function eventsOf(person: Person, type: LifeEventType): LifeEvent[] {
    return (person.events ?? []).filter(e => e.type === type);
}

/** How a single-person event of the entry stands against a linked tree person. */
function eventAgainstTree(tag: string, type: LifeEventType | null, date: string, person: Person): { inTree: boolean; differs: { tree: string; what: 'birth' | 'death' } | null } {
    if (tag === 'BIRT' || tag === 'DEAT') {
        const what = tag === 'BIRT' ? 'birth' : 'death';
        const have = tag === 'BIRT' ? person.birthDate : person.deathDate;
        if (!have) return { inTree: false, differs: null };
        if (!date || have === date) return { inTree: true, differs: null };
        return { inTree: false, differs: { tree: have, what } };
    }
    if (!type) return { inTree: false, differs: null };
    const same = eventsOf(person, type).some(e => !date || !e.date || e.date === date);
    return { inTree: same, differs: null };
}

/** The partnership of two tree persons, if any. */
function partnershipOf(a: Person, b: Person, data: StromData): Partnership | null {
    for (const id of a.partnerships) {
        const u = data.partnerships[id];
        if (u && (u.person1Id === b.id || u.person2Id === b.id)) return u;
    }
    return null;
}

/** The entry's events and relationships with what the tree already has and what the click writes. */
export function proposeItems(entry: ReadEntry, state: ProposeState, data: StromData): ProposeItem[] {
    const items: ProposeItem[] = [];
    const skipOf = (refs: string[]): boolean => refs.some(r => state.persons[r]?.choice === 'skip');
    const finish = (item: Omit<ProposeItem, 'checked' | 'enabled'>): ProposeItem => {
        const enabled = !item.inTree && !item.skipped && !item.differs;
        const checked = enabled && (state.ticks[item.key] ?? true);
        return { ...item, checked, enabled };
    };
    entry.events.forEach((ev, i) => {
        const tag = ev.type.toUpperCase();
        const type = gedcomTagEventType(tag);
        if (tag !== 'MARR' && tag !== 'BIRT' && tag !== 'DEAT' && !type) return;
        const refs = eventPrincipals(entry, ev);
        if (refs.length === 0 || (tag === 'MARR' && refs.length !== 2)) return;
        const date = readEventDate(ev);
        let inTree = false;
        let differs: ProposeItem['differs'] = null;
        if (tag === 'MARR') {
            const a = linkedPerson(state, refs[0], data);
            const b = linkedPerson(state, refs[1], data);
            const u = a && b ? partnershipOf(a, b, data) : null;
            if (u?.startDate) {
                if (!date || u.startDate === date) inTree = true;
                else differs = { what: 'marriage', tree: u.startDate, entry: date };
            }
        } else {
            const linked = refs.map(r => linkedPerson(state, r, data));
            if (linked.every(Boolean)) {
                const said = linked.map(p => eventAgainstTree(tag, type, date, p!));
                inTree = said.every(s => s.inTree);
                const d = said.find(s => s.differs)?.differs;
                if (d) differs = { what: d.what, tree: d.tree, entry: date };
            }
        }
        items.push(finish({ key: `ev:${i}`, kind: 'event', index: i, refs, inTree, skipped: skipOf(refs), differs }));
    });
    entry.relations.forEach((r, i) => {
        const refs = r.type === 'parent' ? [r.parent, r.child] : [r.a, r.b];
        if (refs[0] === refs[1] || refs.some(ref => !entry.persons.some(p => p.ref === ref))) return;
        const a = linkedPerson(state, refs[0], data);
        const b = linkedPerson(state, refs[1], data);
        let inTree = false;
        if (a && b) inTree = r.type === 'parent' ? b.parentIds.includes(a.id) : !!partnershipOf(a, b, data);
        items.push(finish({ key: `rel:${i}`, kind: 'relation', index: i, refs, inTree, skipped: skipOf(refs), differs: null }));
    });
    return items;
}

/** What a linked person gains from the entry and where the entry differs from it. */
export function linkAdditions(p: ReadPerson, tree: Person): { adds: LinkAddition[]; diffs: LinkDifference[] } {
    const adds: LinkAddition[] = [];
    const diffs: LinkDifference[] = [];
    const known = [
        `${tree.firstName} ${tree.lastName}`, tree.marriedSurname ? `${tree.firstName} ${tree.marriedSurname}` : '',
        ...(tree.nameVariants ?? []),
    ].filter(Boolean).map(fold);
    const read = [p.given, p.surname].filter(Boolean).join(' ');
    if (read && !known.includes(fold(read))) {
        if (p.given && tree.firstName && fold(p.given) !== fold(tree.firstName)) diffs.push({ what: 'given', tree: tree.firstName, entry: p.given });
        const surnames = [tree.lastName, tree.marriedSurname ?? ''].filter(Boolean).map(fold);
        if (p.surname && tree.lastName && !surnames.includes(fold(p.surname))) diffs.push({ what: 'surname', tree: tree.lastName, entry: p.surname });
        // Another written form of the name: kept beside the tree's (Person.nameVariants).
        adds.push({ kind: 'variant', value: read });
    }
    const sex = readGender({ sex: p.sex, role: p.role });
    if (p.sex && sex !== 'unknown') {
        if (tree.gender === 'unknown') adds.push({ kind: 'sex', value: sex });
        else if (tree.gender !== sex) diffs.push({ what: 'sex', tree: tree.gender, entry: sex });
    }
    const occupation = p.occupation.trim();
    if (occupation && !eventsOf(tree, 'occupation').some(e => fold(e.note ?? '') === fold(occupation))) {
        adds.push({ kind: 'occupation', value: occupation });
    }
    const residence = p.residence.trim();
    if (residence && !eventsOf(tree, 'residence').some(e => fold([e.place, e.address].filter(Boolean).join(' ')) === fold(residence) || fold(e.place ?? '') === fold(residence))) {
        adds.push({ kind: 'residence', value: residence });
    }
    return { adds, diffs };
}

/** The button's counts: new persons, and facts (ticked events and relationships, additions to linked persons). */
export function proposeCounts(entry: ReadEntry, state: ProposeState, data: StromData): { n: number; m: number } {
    let n = 0;
    let m = 0;
    for (const p of entry.persons) {
        const s = state.persons[p.ref];
        if (s?.choice === 'new') n++;
        const linked = linkedPerson(state, p.ref, data);
        if (linked) m += linkAdditions(p, linked).adds.length;
    }
    m += proposeItems(entry, state, data).filter(i => i.checked).length;
    return { n, m };
}

/** A variant's text without the transcription's marks. */
function plain(text: string): string {
    return text.replace(/\[\?\]|\[(?:\.{2,}|…)\]/g, '').replace(/\s*\|\s*/g, ' ').trim();
}

/** The places the readers differ in that concern a person ("Jan / Josef"). */
export function personVariants(p: Pick<ReadPerson, 'given' | 'surname' | 'written'>, variants: readonly ReadVariant[]): ReadVariant[] {
    const written = fold(plain(p.written));
    const names = [p.given, p.surname].filter(Boolean).map(fold);
    return variants.filter(v => {
        const at = fold(plain(v.at));
        const other = fold(plain(v.other));
        if (!at) return false;
        return (!!written && written.includes(at)) || names.includes(at) || names.includes(other);
    });
}

/** The variants as a line ("Jan / Josef; Nowak / Novák"). */
export function variantsText(variants: readonly ReadVariant[]): string {
    return variants.map(v => `${plain(v.at)} / ${plain(v.other)}`).join('; ');
}

/** A variant's identity (to tell the new ones after a second reading). */
export function variantKey(v: ReadVariant): string {
    return `${v.at}\u0000${v.other}`;
}
