/**
 * Deterministically anonymize a real fixture's person names in place.
 *
 * The repository is public and `test/real-large.json` was built from the
 * author's real family. This rewrites every person's firstName/lastName to
 * fabricated Czech names while preserving:
 *   - gender (male name for men, female / -ová surname for women)
 *   - Czech diacritics
 *   - structure, birth dates, places, and all IDs (unchanged)
 *
 * Because layout depends only on structure and IDs — never on names — the
 * anonymized fixture produces byte-identical layout results, so the test
 * failure reports stay the same. Fully deterministic: the same input always
 * yields the same output.
 *
 *   npx tsx scripts/anonymize-fixture.ts [test/real-large.json]
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface RawPerson {
    id: string;
    firstName: string;
    lastName: string;
    gender: 'male' | 'female';
    isPlaceholder?: boolean;
    [k: string]: unknown;
}
interface RawData {
    persons: Record<string, RawPerson>;
    [k: string]: unknown;
}

const MALE_FIRST = [
    'Jan', 'Petr', 'Josef', 'Jiří', 'Martin', 'Tomáš', 'Miroslav', 'Pavel',
    'Jaroslav', 'František', 'Zdeněk', 'Václav', 'Michal', 'Karel', 'Milan',
    'Vladimír', 'Lukáš', 'David', 'Ladislav', 'Jakub', 'Antonín', 'Stanislav',
    'Roman', 'Ondřej', 'Rudolf', 'Marek', 'Radek', 'Vojtěch', 'Aleš', 'Filip',
];
const FEMALE_FIRST = [
    'Marie', 'Jana', 'Eva', 'Hana', 'Anna', 'Lenka', 'Kateřina', 'Lucie',
    'Věra', 'Alena', 'Petra', 'Jaroslava', 'Ludmila', 'Zdeňka', 'Martina',
    'Tereza', 'Michaela', 'Ivana', 'Jitka', 'Zuzana', 'Barbora', 'Veronika',
    'Helena', 'Monika', 'Dagmar', 'Marcela', 'Kristýna', 'Simona', 'Nikola',
    'Denisa',
];
// Aligned surname families: [male form, female (-ová/adjectival) form].
const SURNAMES: Array<[string, string]> = [
    ['Novák', 'Nováková'], ['Svoboda', 'Svobodová'], ['Novotný', 'Novotná'],
    ['Dvořák', 'Dvořáková'], ['Černý', 'Černá'], ['Procházka', 'Procházková'],
    ['Kučera', 'Kučerová'], ['Veselý', 'Veselá'], ['Horák', 'Horáková'],
    ['Němec', 'Němcová'], ['Marek', 'Marková'], ['Pospíšil', 'Pospíšilová'],
    ['Pokorný', 'Pokorná'], ['Hájek', 'Hájková'], ['Král', 'Králová'],
    ['Jelínek', 'Jelínková'], ['Růžička', 'Růžičková'], ['Beneš', 'Benešová'],
    ['Fiala', 'Fialová'], ['Sedláček', 'Sedláčková'], ['Doležal', 'Doležalová'],
    ['Zeman', 'Zemanová'], ['Kolář', 'Kolářová'], ['Navrátil', 'Navrátilová'],
    ['Čermák', 'Čermáková'], ['Vaněk', 'Vaňková'], ['Urban', 'Urbanová'],
    ['Blažek', 'Blažková'], ['Kříž', 'Křížová'], ['Šťastný', 'Šťastná'],
    ['Malý', 'Malá'], ['Kratochvíl', 'Kratochvílová'], ['Šimek', 'Šimková'],
    ['Konečný', 'Konečná'], ['Musil', 'Musilová'], ['Čížek', 'Čížková'],
    ['Bartoš', 'Bartošová'], ['Vlček', 'Vlčková'], ['Polák', 'Poláková'],
    ['Michálek', 'Michálková'],
];

/** Stable FNV-1a 32-bit hash — deterministic, no external dependency. */
function hash(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}

/**
 * Collapse a surname to a gender-neutral family key so the male and female
 * forms of one family map to the same fake surname where the morphology allows.
 */
function familyKey(lastName: string): string {
    let n = lastName.toLowerCase();
    if (n.endsWith('ová')) n = n.slice(0, -3);          // Nováková -> novák-stem
    else if (n.endsWith('á')) n = n.slice(0, -1) + 'ý'; // adjectival fem -> masc
    // Collapse the Czech fleeting vowel so a masculine "-ek/-ec/-ěk" form and
    // its feminine counterpart land on the same key (Šimek / Šimková -> "šimk").
    n = n.replace(/([bcčdďfghjklmnňpqrřsštťvwxzž])[eě]([kcčgxhň])$/, '$1$2');
    return n;
}

function anonymize(data: RawData): void {
    for (const person of Object.values(data.persons)) {
        const male = person.gender === 'male';
        // First name: keep placeholders ("?") and blanks untouched.
        if (!person.isPlaceholder && person.firstName && person.firstName !== '?') {
            const pool = male ? MALE_FIRST : FEMALE_FIRST;
            person.firstName = pool[hash(person.id) % pool.length];
        }
        // Surname: preserve blanks; map families consistently across genders.
        if (person.lastName) {
            const fam = SURNAMES[hash(familyKey(person.lastName)) % SURNAMES.length];
            person.lastName = male ? fam[0] : fam[1];
        }
    }
}

function main(): void {
    const arg = process.argv[2] ?? join('test', 'real-large.json');
    const path = join(process.cwd(), arg);
    const data = JSON.parse(readFileSync(path, 'utf-8')) as RawData;
    anonymize(data);
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`Anonymized ${Object.keys(data.persons).length} persons in ${arg}`);
}

main();
