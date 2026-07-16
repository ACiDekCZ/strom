/**
 * Surnames that mean the same family (K3 v2).
 *
 * Before about 1900 spelling was not fixed: one register writes Víšek, the next
 * Vyšek, a German-kept one Wischek. That is a fact about the NAME, so it is
 * written down once for the whole tree (StromData.surnameVariants) — the same
 * reasoning as a place's coordinates belonging to the place rather than to
 * whoever was born there.
 *
 * A group is an EQUIVALENCE, not "the right spelling plus its variants". Your
 * great-grandfather is written Vyšek and you are Víšek; neither is a variant of
 * the other, and a search for either has to find both. Per-person spellings
 * (Person.nameVariants) stay for what really belongs to one person: an alias, or
 * the farm a family was known by.
 */

import { StromData } from './types.js';
import { getCurrentLanguage } from './strings.js';

/**
 * The feminine-surname rules below are Czech. On Bulgarian or Russian data they
 * would be wrong — there "-ova" belongs to "-ov" (Ivanova ↔ Ivanov), not to the
 * bare name — so the rules only apply when the tree is plausibly Czech: the UI
 * runs in Czech, or the surnames themselves carry Czech letters. Groups the
 * user entered (surnameVariants) are facts, not rules, and always apply.
 * Same gating idea as isCzechRelevant in archives.ts.
 */
const CZECH_LETTERS = /[áéíýčďěňřšťůžúóľĺŕäô]/i;

const czechRelevanceCache = new WeakMap<StromData, { personCount: number; relevant: boolean }>();

export function czechRulesApply(data: StromData): boolean {
    if (getCurrentLanguage() === 'cs') return true;
    const personCount = Object.keys(data.persons).length;
    const cached = czechRelevanceCache.get(data);
    if (cached && cached.personCount === personCount) return cached.relevant;
    const relevant = Object.values(data.persons).some(p => CZECH_LETTERS.test(p.lastName ?? ''))
        || (data.surnameVariants ?? []).some(g => g.some(n => CZECH_LETTERS.test(n)));
    czechRelevanceCache.set(data, { personCount, relevant });
    return relevant;
}

/**
 * The masculine form of a Czech feminine surname, or null if it does not look
 * like one.
 *
 * Not a guess — Czech has rules. A woman in the family is Víšková where the men
 * are Víšek, and today searching "Víšek" finds fourteen men and none of the ten
 * women, because the "e" drops when the name is made feminine. It only ever
 * worked by accident, where the feminine form happens to contain the masculine
 * one as a substring (Novák → Nováková).
 *
 * Deliberately conservative: only endings that are unmistakably Czech feminine
 * forms, so a tree in another language never sees any of this.
 */
export function masculineForm(surname: string): string | null {
    const name = surname.trim();
    // Endings are tested on a lowercase copy: registers and GEDCOM exports
    // often write NOVOTNÁ, and the rule is about the ending, not the casing.
    const t = name.toLowerCase();

    // Adjectival: Brodská → Brodský, Zelená → Zelený, Roštejnská → Roštejnský.
    if (/ská$/.test(t) || /cká$/.test(t)) return name.slice(0, -1) + 'ý';

    // -ová with a real stem: Víšková → Víšk…. A one- or two-letter remainder is
    // not a stem — Nová is the adjective Nový, and "N"/"Na" would pull in real
    // foreign surnames — so such names fall through to the adjectival rule.
    // ASCII "-ova" is accepted too: old exports strip diacritics, and no Czech
    // masculine surname ends in -ova.
    if (/ov[áa]$/.test(t)) {
        const stem = name.slice(0, -3);
        // The vowel that drops when the name is made feminine: Víšek → Víšková,
        // Adamec → Adamcová, Pavel → Pavlová. Putting it back is a guess about
        // WHICH vowel, so all candidates are offered by sameSurname below.
        if (stem.length >= 3) return stem;
    }

    // Any other -á is adjectival: Tichá → Tichý, Mokrá → Mokrý, Nová → Nový.
    // Plain -a (Svoboda, Kalina) is a noun and stays untouched — which is also
    // why the ASCII forms Ticha/Novotna cannot be helped: they are not
    // distinguishable from nouns once the diacritic is gone.
    if (/á$/.test(t)) return name.slice(0, -1) + 'ý';

    return null;
}

/** Every masculine spelling a feminine surname could have come from. */
function masculineCandidates(surname: string): string[] {
    const base = masculineForm(surname);
    if (!base) return [];
    if (/ý$/i.test(base)) return [base];   // adjectival: one answer
    // Which spelling the -ová was built from cannot be known, so offer each one
    // the rules allow and let the caller compare: Novák(ová) → "Novák";
    // Svobod(ová) → "Svoboda"; Víšk(ová) → "Víšek"; Adamc(ová) → "Adamec".
    const out = [base, base + 'a'];
    const last = base.slice(-1);
    const beforeLast = base.slice(-2, -1);
    if (/[^aeiouyáéíóúýůě]/i.test(last) && /[^aeiouyáéíóúýůě]/i.test(beforeLast)) {
        out.push(base.slice(0, -1) + 'e' + last);   // Víšk → Víšek, Adamc → Adamec
    }
    return out;
}

/**
 * The feminine form of a Czech masculine surname — the same rules read the other
 * way, so that searching either form reaches the whole family. Without it,
 * "Víšek" found all 24 and "Víšková" only the 10 women, which is the kind of
 * inconsistency nobody can explain to themselves.
 */
export function feminineForm(surname: string): string | null {
    const name = surname.trim();
    const t = name.toLowerCase();   // endings, not casing (NOVÁK → NOVÁKová)
    if (!name || /ov[áa]$/.test(t)) return null;   // already feminine (incl. ASCII)

    // Indeclinable: Macků, Kočí, Nových are the same for everyone.
    if (/[ůí]$/.test(t) || /ých$/.test(t)) return null;

    // Adjectival: Brodský → Brodská, Zelený → Zelená.
    if (/ý$/.test(t)) return name.slice(0, -1) + 'á';
    if (/á$/.test(t)) return null;   // already feminine

    // Too short to carry an ending at all: Na, Ho, Wu are whole names, and
    // Na + ová would equate them with real Czech ones (N-ová ↔ Nová).
    if (name.length < 3) return null;

    // The vowel that drops: Víšek → Víšková, Adamec → Adamcová, Pavel → Pavlová.
    const dropped = /^(.*[^aeiouyáéíóúýůě])[eě]([kcl])$/i.exec(name);
    if (dropped) return `${dropped[1]}${dropped[2]}ová`;

    // Ending in -a loses it: Svoboda → Svobodová, Kopřiva → Kopřivová, Mika → Miková.
    if (/a$/.test(t)) return name.slice(0, -1) + 'ová';

    return name + 'ová';
}

/** Compare surnames the way search does: no case, no diacritics. */
export function surnameKey(raw: string): string {
    return raw
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Every written form of this surname, itself included. An unknown surname comes
 * back as just itself, so callers never need to special-case it.
 */
export function surnameForms(surname: string, data: StromData): string[] {
    const key = surnameKey(surname);
    if (!key) return [];

    // Both genders: a woman's surname carries the men's form and vice versa, so
    // searching either reaches the whole family. Rule-generated forms only on
    // Czech-relevant trees; the user's own groups always count.
    const rules = czechRulesApply(data);
    const other = rules ? feminineForm(surname) : null;
    const seeds = [surname, ...(rules ? masculineCandidates(surname) : []), ...(other ? [other] : [])];
    const out: string[] = [];
    const add = (n: string): void => {
        if (n && !out.some(o => surnameKey(o) === surnameKey(n))) out.push(n);
    };
    seeds.forEach(add);

    // Plus every spelling the tree groups with any of those forms.
    for (const group of data.surnameVariants ?? []) {
        const keys = group.map(surnameKey);
        if (seeds.some(f => keys.includes(surnameKey(f)))) group.forEach(add);
    }
    return out;
}

/**
 * Do these two surnames mean the same family? True for the same name, for a
 * masculine/feminine pair (a rule), and for spellings the tree has grouped
 * (a fact the user gave us).
 */
export function sameSurname(a: string, b: string, data: StromData): boolean {
    const ka = surnameKey(a);
    const kb = surnameKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;

    // Víšek and Víšková are one family; nobody should have to say so — but only
    // where the Czech rules apply at all (see czechRulesApply above).
    const rules = czechRulesApply(data);
    if (rules) {
        if (masculineCandidates(a).some(m => surnameKey(m) === kb)) return true;
        if (masculineCandidates(b).some(m => surnameKey(m) === ka)) return true;
        if (surnameKey(feminineForm(a) ?? '') === kb) return true;
        if (surnameKey(feminineForm(b) ?? '') === ka) return true;
    }

    // …and the two could be a grouped spelling of each other's masculine form.
    const formsA = rules ? [a, ...masculineCandidates(a), feminineForm(a) ?? ''].map(surnameKey) : [ka];
    const formsB = rules ? [b, ...masculineCandidates(b), feminineForm(b) ?? ''].map(surnameKey) : [kb];
    return (data.surnameVariants ?? []).some(g => {
        const keys = g.map(surnameKey);
        return formsA.some(x => keys.includes(x)) && formsB.some(y => keys.includes(y));
    });
}

/**
 * Add a group, merging it into any group it overlaps. Adding {Víšek, Vyšek} when
 * {Vyšek, Wischek} exists has to end with one group of three — otherwise Víšek
 * and Wischek would stay strangers despite both being Vyšek.
 */
export function addSurnameGroup(data: StromData, names: string[]): string[][] {
    const cleaned = [...new Set(names.map(n => n.trim()).filter(Boolean))];
    if (cleaned.length < 2) return data.surnameVariants ?? [];

    const keys = new Set(cleaned.map(surnameKey));
    const groups = data.surnameVariants ?? [];
    const untouched: string[][] = [];
    const merged: string[] = [...cleaned];

    for (const group of groups) {
        if (group.some(n => keys.has(surnameKey(n)))) {
            for (const name of group) {
                if (!merged.some(m => surnameKey(m) === surnameKey(name))) merged.push(name);
            }
        } else {
            untouched.push(group);
        }
    }
    return [...untouched, merged.sort((a, b) => a.localeCompare(b))];
}

/** Drop the group this surname belongs to. */
export function removeSurnameGroup(data: StromData, surname: string): string[][] {
    const key = surnameKey(surname);
    return (data.surnameVariants ?? []).filter(g => !g.some(n => surnameKey(n) === key));
}

/** Surnames actually used in the tree, most common first — for suggesting groups. */
export function surnamesInTree(data: StromData): { surname: string; count: number }[] {
    const counts = new Map<string, { surname: string; count: number }>();
    for (const person of Object.values(data.persons)) {
        const name = person.lastName?.trim();
        if (!name || person.isPlaceholder) continue;
        const key = surnameKey(name);
        const seen = counts.get(key);
        if (seen) seen.count++;
        else counts.set(key, { surname: name, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.surname.localeCompare(b.surname));
}
