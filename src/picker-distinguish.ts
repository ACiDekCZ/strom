/**
 * Telling apart people of the same name in a person search list.
 *
 * Rows whose shown text (name with titles and the birth-surname note, plus
 * the birth year when the list shows it) is the same as another row's of the
 * same result get a second, quiet line with the shortest details that set
 * them apart: years → ⚭ partner → parents → place, leaving out a detail the
 * whole group shares. A row with a name of its own stays as it was.
 */

import { Person, PersonId, StromData } from './types.js';
import { strings } from './strings.js';
import { normalizeSearchText } from './name-search.js';
import { displayYear, dateSortKey } from './dates.js';
import { shownNameParts, birthNoteText, titlesShown, surnameDisplay } from './person-name.js';
import type { SurnameDisplay } from './types.js';

/** The four details in the order they are tried: years, partner, parents, place (null = unknown). */
export type DistFeatures = [string | null, string | null, string | null, string | null];

/** The year the list writes after the name, "(*1852)" ('' when none or not shown). */
export function rowBirthYear(person: Person, showBirthYear: boolean): string {
    return showBirthYear && person.birthDate ? person.birthDate.split('-')[0] : '';
}

/**
 * The key a row is compared by: the row's shown text folded as the search
 * folds it (diacritics, case), with the birth year when the list shows it.
 */
export function rowKey(person: Person, showBirthYear: boolean, show = titlesShown(), display: SurnameDisplay = surnameDisplay()): string {
    const parts = shownNameParts(person, '', show, display);
    const note = birthNoteText(parts.birthNote);
    // shownName() from the parts already at hand.
    const text = (`${parts.given} ${parts.surname}`.trim() || '?') + (note ? ` (${note})` : '');
    const year = rowBirthYear(person, showBirthYear);
    return foldName(text) + (year ? ` ${year}` : '');
}

/** Folded names, kept: a tree repeats its names, and folding is the costly part of a key. */
const folded = new Map<string, string>();
const FOLDED_MAX = 20000;

/** Forget the folded names (tests measure the first search after opening). */
export function clearFoldedNames(): void {
    folded.clear();
}

function foldName(text: string): string {
    let out = folded.get(text);
    if (out === undefined) {
        if (folded.size >= FOLDED_MAX) folded.clear();
        out = normalizeSearchText(text);
        folded.set(text, out);
    }
    return out;
}

/** A related person's whole name, null for a placeholder or a person without one. */
function relatedName(person: Person | undefined, show: boolean, display: SurnameDisplay): string | null {
    if (!person || person.isPlaceholder) return null;
    const { given, surname } = shownNameParts(person, '', show, display);
    return `${given} ${surname}`.trim() || null;
}

/** The names of a person's partners, in the order of the partnerships. */
export function partnerNames(person: Person, data: StromData | null, show = titlesShown(), display: SurnameDisplay = surnameDisplay()): string[] {
    if (!data) return [];
    const names: string[] = [];
    for (const uid of person.partnerships ?? []) {
        const u = data.partnerships?.[uid];
        if (!u) continue;
        const otherId = u.person1Id === person.id ? u.person2Id : u.person1Id;
        const name = relatedName(data.persons[otherId], show, display);
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

/** The place of the latest residence event with a place ('' for none). */
function lastResidence(person: Person): string {
    let best = '';
    let bestKey = '';
    for (const e of person.events ?? []) {
        if (e.type !== 'residence') continue;
        const place = e.place?.trim();
        if (!place) continue;
        const key = dateSortKey(e.date);
        if (!best || key >= bestKey) { best = place; bestKey = key; }
    }
    return best;
}

export interface FeatureOptions {
    /** The list writes the birth year after the name. */
    showBirthYear: boolean;
    /** The row's found-by line as text ("† 1866 Horní Smyšlenice · cholera"), '' for none. */
    matchText?: string;
    /** Whether another row of the group has this partner: the partner shown is the first one no other row has. */
    othersHavePartner?: (name: string) => boolean;
    show?: boolean;
    display?: SurnameDisplay;
}

/** The four details of a person for the distinguishing line. */
export function distinguishFeatures(person: Person, data: StromData | null, opts: FeatureOptions): DistFeatures {
    const show = opts.show ?? titlesShown();
    const display = opts.display ?? surnameDisplay();
    const match = opts.matchText ?? '';
    // 1. Years: only the known parts, only the year, none the row already says.
    const yearParts: string[] = [];
    if (person.birthDate && !opts.showBirthYear) yearParts.push(`* ${displayYear(person.birthDate)}`);
    if (person.deathDate) yearParts.push(`† ${displayYear(person.deathDate)}`);
    const years = yearParts.filter(part => !match.includes(part)).join(' – ') || null;
    // 2. Partner: the first one the others of the group do not have, else the first.
    const partners = partnerNames(person, data, show, display);
    const partnerName = partners.find(n => !opts.othersHavePartner?.(n)) ?? partners[0];
    const partner = partnerName ? `⚭ ${partnerName}` : null;
    // 3. Parents: father first, then mother, then others.
    let parents: string | null = null;
    if (data) {
        const rank = (p: Person): number => p.gender === 'male' ? 0 : p.gender === 'female' ? 1 : 2;
        const known = (person.parentIds ?? [])
            .map(id => data.persons[id])
            .filter((p): p is Person => !!p && !p.isPlaceholder)
            .sort((a, b) => rank(a) - rank(b))
            .map(p => relatedName(p, show, display))
            .filter((n): n is string => !!n);
        if (known.length) {
            const child = person.gender === 'female' ? strings.personPicker.distChild.f
                : person.gender === 'male' ? strings.personPicker.distChild.m
                : strings.personPicker.distChild.u;
            parents = child(known.join(` ${strings.personPicker.distAnd} `));
        }
    }
    // 4. Place: the birthplace, else the last residence.
    const born = person.birthPlace?.trim();
    const lived = born ? '' : lastResidence(person);
    const place = born ? strings.personPicker.distBorn(born) : lived ? strings.personPicker.distLived(lived) : null;
    return [years, partner, parents, place];
}

const prefixKey = (f: DistFeatures, k: number): string =>
    f.slice(0, k).map(v => v === null ? '\u0000' : v).join('\u0001');

/**
 * The distinguishing line of a row against the other rows of its group: the
 * shortest run of details (years, partner, parents, place) that no other row
 * shares, its known parts joined with " · ". A detail every row of the group
 * has the same (the parents of sisters) tells nothing and is left out, so the
 * one that does (their birthplaces) is not cut off behind it. When only an
 * unknown detail sets the row apart, its first known detail the others do not
 * all share; when there is none, "no other details". A row nothing sets apart
 * from another shows all it has, shared or not.
 */
export function distinguishLine(own: DistFeatures, others: readonly DistFeatures[]): string {
    let k = 1;
    for (; k <= 4; k++) {
        const mine = prefixKey(own, k);
        if (others.every(o => prefixKey(o, k) !== mine)) break;
    }
    if (k > 4) {
        // Another row has the same details: nothing to leave out.
        const all = own.filter((v): v is string => !!v);
        return all.length ? all.join(' · ') : strings.personPicker.distNone;
    }
    const shared = own.map((v, i) => !!v && others.every(o => o[i] === v));
    let shown = own.slice(0, k).filter((v, i): v is string => !!v && !shared[i]);
    if (!shown.length) {
        const first = own.find((v, i) => !!v && !shared[i]);
        shown = first ? [first] : [];
    }
    return shown.length ? shown.join(' · ') : strings.personPicker.distNone;
}

/**
 * The distinguishing lines of one search result. Built per result: one pass
 * over the whole result groups rows by key; a row's line is worked out when
 * the row is drawn (against its whole group in the result, also the rows not
 * drawn yet) and kept for the result's lifetime.
 */
export class PickerDistinguisher {
    private groups = new Map<string, Person[]>();
    private keyOf = new Map<PersonId, string>();
    private lines = new Map<PersonId, string | null>();
    private features = new Map<string, DistFeatures[]>();
    private readonly show = titlesShown();
    private readonly display: SurnameDisplay = surnameDisplay();

    constructor(
        result: readonly Person[],
        private data: StromData | null,
        private showBirthYear: boolean,
        private matchTextOf: (person: Person) => string = () => '',
    ) {
        for (const p of result) {
            const key = rowKey(p, showBirthYear, this.show, this.display);
            this.keyOf.set(p.id, key);
            const group = this.groups.get(key);
            if (group) group.push(p);
            else this.groups.set(key, [p]);
        }
    }

    /** How many rows of the result share the row's key (0 when the person is not in it). */
    count(person: Person): number {
        const key = this.keyOf.get(person.id);
        return key === undefined ? 0 : this.groups.get(key)?.length ?? 0;
    }

    /** The row's distinguishing line, null for a row with a name of its own. */
    line(person: Person): string | null {
        const cached = this.lines.get(person.id);
        if (cached !== undefined) return cached;
        const key = this.keyOf.get(person.id);
        const group = key === undefined ? undefined : this.groups.get(key);
        let text: string | null = null;
        if (key !== undefined && group && group.length >= 2) {
            const features = this.groupFeatures(key, group);
            const i = group.findIndex(p => p.id === person.id);
            text = distinguishLine(features[i], features.filter((_, j) => j !== i));
        }
        this.lines.set(person.id, text);
        return text;
    }

    /** The details of every row of a group, worked out once per group. */
    private groupFeatures(key: string, group: readonly Person[]): DistFeatures[] {
        const cached = this.features.get(key);
        if (cached) return cached;
        const partnersOf = group.map(p => partnerNames(p, this.data, this.show, this.display));
        // In how many rows of the group each partner name appears.
        const rowsWith = new Map<string, number>();
        partnersOf.forEach(names => names.forEach(n => rowsWith.set(n, (rowsWith.get(n) ?? 0) + 1)));
        const features = group.map((p, i) => {
            // Own names are listed once (partnerNames), so another row has a name when it is counted more than once.
            const own = partnersOf[i];
            const othersHavePartner = (name: string): boolean => (rowsWith.get(name) ?? 0) - (own.includes(name) ? 1 : 0) > 0;
            return distinguishFeatures(p, this.data, {
                showBirthYear: this.showBirthYear, matchText: this.matchTextOf(p), othersHavePartner,
                show: this.show, display: this.display,
            });
        });
        this.features.set(key, features);
        return features;
    }
}
