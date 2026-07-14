/**
 * CSV export: a flat person table for spreadsheets. Pure builder (no DOM).
 *
 * Semicolon-separated with a UTF-8 BOM — that is what desktop Excel expects in
 * the Czech/European locales, and Google Sheets / LibreOffice auto-detect it.
 * Dates are kept in the canonical flex form (unambiguous, sortable).
 */

import { StromData, Person, PersonId } from './types.js';
import { strings } from './strings.js';

const SEP = ';';

function csvField(value: string): string {
    if (value === '') return '';
    if (/[";\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

function personName(p?: Person): string {
    if (!p) return '';
    return `${p.firstName} ${p.lastName}`.trim();
}

/** Build the CSV text for every non-placeholder person of the tree. */
export function buildPersonsCsv(data: StromData): string {
    const s = strings.csv;
    const header = [
        s.firstName, s.lastName, s.gender, s.birthDate, s.birthPlace,
        s.deathDate, s.deathPlace, s.father, s.mother, s.partners, s.notes,
    ];

    const rows: string[][] = [header];
    const persons = Object.values(data.persons)
        .filter(p => !p.isPlaceholder)
        .sort((a, b) => a.lastName.localeCompare(b.lastName)
            || a.firstName.localeCompare(b.firstName));

    for (const p of persons) {
        const parents = p.parentIds
            .map(id => data.persons[id])
            .filter((x): x is Person => !!x && !x.isPlaceholder);
        const father = parents.find(x => x.gender === 'male');
        const mother = parents.find(x => x.gender === 'female');
        const partnerNames = p.partnerships
            .map(uid => {
                const u = data.partnerships[uid];
                if (!u) return null;
                const otherId: PersonId = u.person1Id === p.id ? u.person2Id : u.person1Id;
                const other = data.persons[otherId];
                return other && !other.isPlaceholder ? personName(other) : null;
            })
            .filter((x): x is string => !!x);

        rows.push([
            p.firstName, p.lastName,
            p.gender === 'male' ? strings.gender.male : strings.gender.female,
            p.birthDate ?? '', p.birthPlace ?? '',
            p.deathDate ?? '', p.deathPlace ?? '',
            personName(father), personName(mother),
            partnerNames.join(', '),
            p.notes ?? '',
        ]);
    }

    // BOM so Excel opens UTF-8 (Czech diacritics) correctly.
    return '﻿' + rows.map(r => r.map(csvField).join(SEP)).join('\r\n');
}
