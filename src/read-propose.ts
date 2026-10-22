/**
 * "Read a document" (spec 013), the tree suggestion: what an entry of a
 * reading would add to the tree. Per person a choice (new / link / no) with
 * its default, the events and relationships with what is already in the
 * tree, what a linked person gains and where the entry differs from it, and
 * the counts on the button. Pure functions over the tree's data (no DOM, no
 * writes); the dialog draws from them and writes on the click.
 */

import { gendersCompatible } from './types.js';
import type { Gender, LifeEvent, LifeEventType, Person, PersonId, StromData, Partnership, PartnershipId, Source } from './types.js';
import type { ReadEntry, ReadEvent, ReadPerson, ReadVariant } from './research-read.js';
import { researchPersonRef } from './research-link.js';
import { gedcomTagEventType, parseGedcomDate } from './ged-parser.js';
import { quickMatch, QuickMatchReason, normalizeName, stringSimilarity, compareEventDates } from './merge/matching.js';
import { parseFlexDate } from './dates.js';
import { sameSurname } from './surnames.js';
import { sameGivenName } from './given-names.js';

export type ProposeChoice = 'new' | 'link' | 'skip';

/** Roles that are not written by default (they stay in the transcription). */
export const SKIP_ROLES: ReadonlySet<string> = new Set(['godparent', 'witness', 'midwife', 'priest', 'informant', 'mentioned', 'writer', 'other']);

/** Roles an entry is about (its events belong to them when the event does not say). */
const PRINCIPAL_ROLES: ReadonlySet<string> = new Set(['principal', 'child', 'groom', 'bride', 'deceased', '']);

/** A quick match from this score on is a candidate (as on a card's "Also in"). */
export const MATCH_THRESHOLD = 50;

/** Why a candidate fits: the quick match's reasons, and a child of the person linked ('child'). */
export type ProposeReason = QuickMatchReason | 'child';

/** A tree person an entry's person may be. */
export interface ProposeCandidate {
    id: PersonId;
    /** Found by the research's own match (its REFN), not by the app's matching. */
    byResearch: boolean;
    score: number;
    reasons: ProposeReason[];
    /** The research's words why ('' = none). */
    why: string;
    /** Found through relatives by the surname alone (no given name, no date): a candidate on Link, not the default. */
    tentative?: boolean;
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
    /** A person of it is set to Link with no tree person chosen yet. */
    unchosen: boolean;
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

/** The tree persons the research's matches name (their REFNs "P0042"), each once, with the research's score. */
function researchHits(p: ReadPerson, data: StromData): ProposeCandidate[] {
    const hits: ProposeCandidate[] = [];
    for (const m of p.match) {
        const ref = researchPersonRef(m.person);
        if (!ref) continue;
        const hit = Object.values(data.persons).find(x => !x.isPlaceholder && x.refn?.trim() === ref);
        if (hit && !hits.some(h => h.id === hit.id)) hits.push({ id: hit.id, byResearch: true, score: m.score, reasons: ['name'], why: m.why });
    }
    return hits;
}

/** The one strictly best of the research's matches (equal scores: none, the user chooses). */
function strictlyBest(hits: readonly ProposeCandidate[]): ProposeCandidate | null {
    const top = Math.max(...hits.map(h => h.score));
    const best = hits.filter(h => h.score === top);
    return best.length === 1 ? best[0] : null;
}

/** A research match as the suggestion's candidate (the research's word: full score). */
function asResearch(hit: ProposeCandidate): ProposeCandidate {
    return { ...hit, score: 100 };
}

/** The research's match first (its strictly best), else the one tree person the app's matching finds above the threshold. */
export function findCandidate(entry: ReadEntry, p: ReadPerson, data: StromData, draft: StromData, taken: ReadonlySet<string> = new Set(), prior: readonly Person[] = []): ProposeCandidate | null {
    const hits = researchHits(p, data).filter(h => !taken.has(h.id));
    const research = hits.length > 0 ? strictlyBest(hits) : null;
    if (research) return asResearch(research);
    return hits.length > 0 ? null : appCandidate(entry, p, data, draft, taken, prior);
}

/** The app's own matching: a person written from this entry before, else the one tree person above the threshold. */
function appCandidate(entry: ReadEntry, p: ReadPerson, data: StromData, draft: StromData, taken: ReadonlySet<string>, prior: readonly Person[]): ProposeCandidate | null {
    const me = draft.persons[draftId(p.ref)];
    if (!me || !`${me.firstName}${me.lastName}`.trim()) return null;
    // Written from this very entry before (they cite its source): the same name is the same person.
    const name = (x: Pick<Person, 'firstName' | 'lastName'>): string => `${normalizeName(x.firstName ?? '')}|${normalizeName(x.lastName ?? '')}`;
    const same = prior.filter(o => !taken.has(o.id) && name(o) === name(me));
    if (same.length === 1) {
        const q = quickMatch(me, same[0], draft, data);
        return { id: same[0].id, byResearch: false, score: Math.max(q.score, MATCH_THRESHOLD), reasons: q.reasons, why: '' };
    }
    const alive = aliveDates(entry, p.ref);
    let best: ProposeCandidate | null = null;
    let tie = false;
    for (const other of Object.values(data.persons)) {
        if (other.isPlaceholder || taken.has(other.id) || diedBefore(other, alive)) continue;
        const q = quickMatch(me, other, draft, data);
        if (q.score < MATCH_THRESHOLD) continue;
        if (!best || q.score > best.score) { best = { id: other.id, byResearch: false, score: q.score, reasons: q.reasons, why: '' }; tie = false; }
        else if (q.score === best.score) tie = true;
    }
    // Two tree persons fit equally: the choice is the user's.
    if (tie) return null;
    return best ?? givenOnlyCandidate(me, alive, data, draft, taken);
}

/**
 * A person read by the given name only (no surname): the one tree person
 * of a similar given name born on the same day (the quick match wants a
 * surname as well).
 */
function givenOnlyCandidate(me: Person, alive: readonly string[], data: StromData, draft: StromData, taken: ReadonlySet<string>): ProposeCandidate | null {
    if ((me.lastName ?? '').trim() || !(me.firstName ?? '').trim() || !me.birthDate) return null;
    const fits = Object.values(data.persons).filter(other => !other.isPlaceholder && !taken.has(other.id)
        && compareEventDates(me.birthDate, other.birthDate) === 'day' && relativeSupport(me, other, alive, data)?.name);
    if (fits.length !== 1) return null;
    const score = Math.max(quickMatch(me, fits[0], draft, data).score, MATCH_THRESHOLD);
    return { id: fits[0].id, byResearch: false, score, reasons: ['name', 'birth'], why: '' };
}

/**
 * The source an earlier write of this entry made (the same reading and
 * entry), or null: one entry of a reading is one source in the tree.
 */
export function entrySource(data: StromData, readId: string, entryId: string): Source | null {
    if (!readId || !entryId) return null;
    return Object.values(data.sources ?? {}).find(s => !!s && s.reading === readId && s.readingEntry === entryId) ?? null;
}

/** The persons citing a source (written or linked from its entry before). */
export function personsCiting(data: StromData, sourceId: string): Person[] {
    return Object.values(data.persons).filter(p => !p.isPlaceholder && (p.sourceIds?.includes(sourceId)
        || p.birthSourceIds?.includes(sourceId) || p.deathSourceIds?.includes(sourceId)));
}

/**
 * The entry's family: its own people (roles not skipped) and, through the
 * entry's parent and spouse relations, everyone tied to them (a grandparent
 * the research gives as "other"). A godparent or a witness stays outside.
 */
export function entryFamily(entry: Pick<ReadEntry, 'persons' | 'relations'>): Set<string> {
    const family = new Set(entry.persons.filter(p => !SKIP_ROLES.has(p.role)).map(p => p.ref));
    for (let grew = true; grew;) {
        grew = false;
        for (const r of entry.relations) {
            const [a, b] = r.type === 'parent' ? [r.parent, r.child] : r.type === 'spouse' ? [r.a, r.b] : ['', ''];
            if (!a || !b) continue;
            if (family.has(a) !== family.has(b)) { family.add(family.has(a) ? b : a); grew = true; }
        }
    }
    return family;
}

/** A tree person's given-name forms and surname forms (its name, married surname, written variants). */
function treeNameForms(x: Person): { given: string[]; surnames: string[] } {
    const given = [x.firstName ?? ''];
    const surnames = [x.lastName ?? '', x.marriedSurname ?? ''];
    for (const v of x.nameVariants ?? []) {
        const words = v.trim().split(/\s+/);
        if (words.length > 1) { given.push(words.slice(0, -1).join(' ')); surnames.push(words[words.length - 1]); }
        else given.push(words[0] ?? '');
    }
    return { given: given.filter(g => g.trim()), surnames: surnames.filter(n => n.trim()) };
}

const NAME_SIMILAR = 0.8;

/** The dates the entry has a person alive on: its own events (birth, baptism, marriage…), not its death or burial. */
function aliveDates(entry: Pick<ReadEntry, 'persons' | 'events'>, ref: string): string[] {
    return entry.events.filter(ev => !['DEAT', 'BURI', 'CREM', 'PROB'].includes(ev.type.toUpperCase()) && eventPrincipals(entry, ev).includes(ref))
        .map(readEventDate).filter(Boolean);
}

/**
 * The tree person died before a day the read person was alive on (a child
 * who died young and whose name the next one was given): never the same.
 * Plain dates only, compared to the precision both give.
 */
function diedBefore(other: Person, alive: readonly string[]): boolean {
    const death = parseFlexDate(other.deathDate);
    if (!death || death.end || death.qualifier === '~' || death.qualifier === '>') return false;
    return alive.some(date => {
        const at = parseFlexDate(date);
        if (!at || at.end || at.qualifier === '~' || at.qualifier === '<') return false;
        if (death.year !== at.year) return death.year < at.year;
        if (death.month === undefined || at.month === undefined || death.month !== at.month) {
            return death.month !== undefined && at.month !== undefined && death.month < at.month;
        }
        return death.day !== undefined && at.day !== undefined && death.day < at.day;
    });
}

/**
 * What beyond the family structure says a tree relative is the read person:
 * the given name (whole, or one name of several), the birth to the day or
 * month, a surname when the given names do not disagree; null when nothing
 * does or a date rules it out (a birth or death that differs, a death before
 * the read person's own events).
 */
function relativeSupport(me: Person, other: Person, alive: readonly string[], data: StromData): { name: boolean; given: boolean; birth: boolean } | null {
    if (!gendersCompatible(me.gender, other.gender) || diedBefore(other, alive)) return null;
    const birth = compareEventDates(me.birthDate, other.birthDate);
    if (birth === 'conflict' || compareEventDates(me.deathDate, other.deathDate) === 'conflict') return null;
    const forms = treeNameForms(other);
    const given = (me.firstName ?? '').trim();
    const words = (text: string): string[] => normalizeName(text).split(' ').filter(w => w.length > 1);
    const givenFits = !!given && forms.given.some(g => sameGivenName(given, g) || stringSimilarity(given, g) >= NAME_SIMILAR
        || words(given).some(a => words(g).some(b => stringSimilarity(a, b) >= NAME_SIMILAR)));
    const surname = (me.lastName ?? '').trim();
    const surnameFits = !!surname && forms.surnames.some(n => stringSimilarity(surname, n) >= NAME_SIMILAR || sameSurname(surname, n, data));
    // Two given names that differ: a shared family surname alone is not the person.
    const givenDiffers = !!given && forms.given.length > 0 && !givenFits;
    const birthFits = birth === 'day' || birth === 'month';
    const name = givenFits || (surnameFits && !givenDiffers);
    return name || birthFits ? { name, given: givenFits, birth: birthFits } : null;
}

/**
 * Per entry relation of a person to someone already matched: the matched
 * one's tree relatives in that role (the linked child's parents, the linked
 * parent's children, the linked spouse's partners) and the reason it gives.
 */
function linkedRelatives(entry: ReadEntry, ref: string, data: StromData, found: ReadonlyMap<string, ProposeCandidate>): { index: number; relatives: Person[]; reason: ProposeReason }[] {
    const out: { index: number; relatives: Person[]; reason: ProposeReason }[] = [];
    entry.relations.forEach((r, index) => {
        let q = '';
        let role: 'parent' | 'child' | 'partner' | '' = '';
        let reason: ProposeReason = 'name';
        if (r.type === 'parent' && r.parent === ref) { q = r.child; role = 'parent'; reason = 'child'; }
        else if (r.type === 'parent' && r.child === ref) { q = r.parent; role = 'child'; reason = 'parents'; }
        else if (r.type === 'spouse' && (r.a === ref || r.b === ref)) { q = r.a === ref ? r.b : r.a; role = 'partner'; reason = 'partner'; }
        const at = q && q !== ref ? found.get(q) : undefined;
        const tree = at ? data.persons[at.id] : undefined;
        if (role && tree) out.push({ index, relatives: treeRelatives(tree, role, data), reason });
    });
    return out;
}

/** A tree person's relatives in a role: parents, children or partners. */
function treeRelatives(x: Person, role: 'parent' | 'child' | 'partner', data: StromData): Person[] {
    const ids = role === 'parent' ? x.parentIds
        : role === 'child' ? x.childIds
            : x.partnerships.map(id => data.partnerships[id]).filter(Boolean).map(u => u.person1Id === x.id ? u.person2Id : u.person1Id);
    return [...new Set(ids)].map(id => data.persons[id]).filter((p): p is Person => !!p && !p.isPlaceholder);
}

/**
 * The tree person a read person is through the entry's relatives already
 * matched: the father's child, the child's mother, the husband's wife, when
 * exactly one such relative fits by name or birth (two or more: the user's
 * choice). Works without a surname (a mother read by her given name only);
 * a fit by the surname alone is tentative (offered on Link, not linked).
 */
function relativeCandidate(entry: ReadEntry, p: ReadPerson, data: StromData, draft: StromData, found: ReadonlyMap<string, ProposeCandidate>, taken: ReadonlySet<string>): ProposeCandidate | null {
    const me = draft.persons[draftId(p.ref)];
    if (!me) return null;
    // Tree person → the entry relations that lead to it.
    const alive = aliveDates(entry, p.ref);
    const hits = new Map<PersonId, { rels: Set<number>; reasons: Set<ProposeReason>; sure: boolean }>();
    linkedRelatives(entry, p.ref, data, found).forEach(({ index: i, relatives, reason }) => {
        for (const other of relatives) {
            if (taken.has(other.id)) continue;
            const support = relativeSupport(me, other, alive, data);
            if (!support) continue;
            const hit = hits.get(other.id) ?? { rels: new Set<number>(), reasons: new Set<ProposeReason>(), sure: false };
            if (support.given || support.birth) hit.sure = true;
            hit.rels.add(i);
            hit.reasons.add(reason);
            if (support.name) hit.reasons.add('name');
            if (support.birth) hit.reasons.add('birth');
            hits.set(other.id, hit);
        }
    });
    if (hits.size === 0) return null;
    // Several fit: the one every relation leads to (the father's and the mother's child), else none.
    const most = Math.max(...[...hits.values()].map(h => h.rels.size));
    const best = [...hits].filter(([, h]) => h.rels.size === most);
    if (best.length !== 1) return null;
    const [id, hit] = best[0];
    const order: ProposeReason[] = ['name', 'birth', 'parents', 'child', 'partner'];
    const score = Math.max(quickMatch(me, data.persons[id], draft, data).score, MATCH_THRESHOLD);
    const c: ProposeCandidate = { id, byResearch: false, score, reasons: order.filter(r => hit.reasons.has(r)), why: '' };
    return hit.sure ? c : { ...c, tentative: true };
}

/**
 * The suggestion as it opens: a candidate links, no candidate is new, a
 * godparent or witness is not written unless the research says who it is
 * (an app's guess is kept for Link). The family picks first; relatives of
 * persons already matched follow them, round by round.
 */
export function initialPropose(readId: string, entry: ReadEntry, data: StromData): ProposeState {
    const draft = draftData(entry);
    const taken = new Set<string>();
    const before = entrySource(data, readId, entry.id);
    const prior = before ? personsCiting(data, before.id) : [];
    const family = entryFamily(entry);
    const found = new Map<string, ProposeCandidate>();
    const take = (ref: string, c: ProposeCandidate): void => { taken.add(c.id); found.set(ref, c); };
    // Tentative fits (the surname alone): kept for Link, but no one is found through them.
    const tentative = new Map<string, ProposeCandidate>();
    // The entry's own people pick their candidates first; no two persons link to one tree person.
    const order = [...entry.persons].sort((a, b) => Number(!family.has(a.ref)) - Number(!family.has(b.ref)));
    const hitsOf = new Map(order.map(p => [p.ref, researchHits(p, data)]));
    const open = (ref: string): ProposeCandidate[] => (hitsOf.get(ref) ?? []).filter(h => !taken.has(h.id));
    // The research's single matches, then the app's matching for the persons it did not match.
    for (const p of order) {
        const hits = open(p.ref);
        if (hits.length === 1) take(p.ref, asResearch(hits[0]));
    }
    for (const p of order) {
        if (found.has(p.ref) || open(p.ref).length > 0) continue;
        const c = appCandidate(entry, p, data, draft, taken, prior);
        if (c) take(p.ref, c);
    }
    for (let more = true; more;) {
        more = false;
        // Round by round: of several research matches the one the matched relatives point to; through relatives the rest.
        for (const p of order) {
            if (found.has(p.ref)) continue;
            const hits = open(p.ref);
            let c: ProposeCandidate | null = null;
            if (hits.length > 0) {
                const near = new Set(linkedRelatives(entry, p.ref, data, found).flatMap(l => l.relatives.map(x => x.id)));
                const fit = hits.filter(h => near.has(h.id));
                c = hits.length === 1 ? hits[0] : fit.length === 1 ? fit[0] : null;
                if (c) c = asResearch(c);
            } else c = relativeCandidate(entry, p, data, draft, found, taken);
            if (c?.tentative) { tentative.set(p.ref, c); c = null; }
            if (c) { take(p.ref, c); tentative.delete(p.ref); more = true; }
        }
        if (more) continue;
        // Nothing else decides: a strictly best research score, one person at a time (the others may follow it).
        for (const p of order) {
            const hits = open(p.ref);
            if (found.has(p.ref) || hits.length < 2) continue;
            const near = new Set(linkedRelatives(entry, p.ref, data, found).flatMap(l => l.relatives.map(x => x.id)));
            const fit = hits.filter(h => near.has(h.id));
            const best = strictlyBest(fit.length > 1 ? fit : hits);
            if (best) { take(p.ref, asResearch(best)); more = true; break; }
        }
    }
    const persons: Record<string, ProposePerson> = {};
    for (const [ref, c] of tentative) {
        if (!found.has(ref) && !taken.has(c.id)) take(ref, c);
    }
    for (const p of entry.persons) {
        const candidate = found.get(p.ref) ?? null;
        const choice: ProposeChoice = !family.has(p.ref) && !candidate?.byResearch ? 'skip' : candidate && !candidate.tentative ? 'link' : 'new';
        persons[p.ref] = {
            ref: p.ref,
            choice,
            target: choice === 'link' && candidate ? candidate.id : '',
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
            // A tree person deleted since: no target again (the user chooses), never a link to nobody.
            target: old.target && data.persons[old.target] ? old.target : '',
            given: old.edited.given ? old.given : p.given,
            surname: old.edited.surname ? old.surname : p.surname,
            edited: { ...old.edited },
        };
    }
    fresh.ticks = { ...prev.ticks };
    return fresh;
}

/**
 * The persons set to Link with no tree person chosen (or one deleted since):
 * nothing of theirs is written, and the button waits until they are chosen.
 */
export function proposeUnchosen(state: ProposeState, data?: StromData): string[] {
    return Object.values(state.persons)
        .filter(p => p.choice === 'link' && (!p.target || (!!data && !data.persons[p.target])))
        .map(p => p.ref);
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
    const unchosen = new Set(proposeUnchosen(state, data));
    const unchosenOf = (refs: string[]): boolean => refs.some(r => unchosen.has(r));
    const finish = (item: Omit<ProposeItem, 'checked' | 'enabled'>): ProposeItem => {
        const enabled = !item.inTree && !item.skipped && !item.unchosen && !item.differs;
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
        items.push(finish({ key: `ev:${i}`, kind: 'event', index: i, refs, inTree, skipped: skipOf(refs), unchosen: unchosenOf(refs), differs }));
    });
    entry.relations.forEach((r, i) => {
        const refs = r.type === 'parent' ? [r.parent, r.child] : [r.a, r.b];
        if (refs[0] === refs[1] || refs.some(ref => !entry.persons.some(p => p.ref === ref))) return;
        const a = linkedPerson(state, refs[0], data);
        const b = linkedPerson(state, refs[1], data);
        let inTree = false;
        if (a && b) inTree = r.type === 'parent' ? b.parentIds.includes(a.id) : !!partnershipOf(a, b, data);
        items.push(finish({ key: `rel:${i}`, kind: 'relation', index: i, refs, inTree, skipped: skipOf(refs), unchosen: unchosenOf(refs), differs: null }));
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
        // A register's Latin or German form (Wenceslaus, Wenzel for Václav) is the same name.
        if (p.given && tree.firstName && !sameGivenName(p.given, tree.firstName)) diffs.push({ what: 'given', tree: tree.firstName, entry: p.given });
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
