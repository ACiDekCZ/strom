/**
 * The GEDCOM export with living-person privacy (initials, anonymous): what
 * the export dialog runs (src/ui/import-export.ts exportTargetTreeGedcom),
 * applyLivingPrivacy and then exportToGedcom. A living person and her
 * marriage leave no variant, note, date, place or witness in the file; the
 * deceased keep theirs. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { applyLivingPrivacy } from '../privacy.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData } from '../types.js';

const NOW = 2026;

/** A living couple under a deceased one, all detail-rich. */
function privacyTree(): StromData {
    return {
        version: 11,
        persons: {
            p_old: {
                id: 'p_old', firstName: 'Ambrose', lastName: 'Oakridge', gender: 'male',
                birthDate: '1935', deathDate: '2010', isPlaceholder: false,
                nameVariants: ['Ambrosius Eichrucken'], notes: 'Deceased note kept',
                partnerships: ['u_old'], parentIds: [], childIds: ['p_liv'],
            },
            p_oldw: {
                id: 'p_oldw', firstName: 'Beatrix', lastName: 'Oakridge', gender: 'female',
                birthDate: '1938', deathDate: '2012', isPlaceholder: false,
                partnerships: ['u_old'], parentIds: [], childIds: ['p_liv'],
            },
            p_liv: {
                id: 'p_liv', firstName: 'Livia', lastName: 'Oakridge', gender: 'female',
                birthDate: '1965-04-02', birthPlace: 'Livingtown', isPlaceholder: false,
                nameVariants: ['Liviana Secretvariant'], notes: 'Living secret note',
                partnerships: ['u_liv'], parentIds: ['p_old', 'p_oldw'], childIds: [],
            },
            p_livh: {
                id: 'p_livh', firstName: 'Lucius', lastName: 'Marrowby', gender: 'male',
                birthDate: '1963', isPlaceholder: false,
                partnerships: ['u_liv'], parentIds: [], childIds: [],
            },
        },
        partnerships: {
            u_old: {
                id: 'u_old', person1Id: 'p_old', person2Id: 'p_oldw', status: 'married',
                startDate: '1958-06-11', startPlace: 'Oldchapel',
                participants: [{ id: 'w_old', role: 'witness', name: 'Cornelius Oldwitness' }],
                note: 'Old wedding note kept',
                childIds: ['p_liv'],
            },
            u_liv: {
                id: 'u_liv', person1Id: 'p_livh', person2Id: 'p_liv', status: 'married',
                startDate: '1994-08-22', startPlace: 'Secretchapel',
                participants: [{ id: 'w_liv', role: 'witness', name: 'Theodora Hiddenwitness' }],
                note: 'Living wedding secret note',
                childIds: [],
            },
        },
    } as unknown as StromData;
}

const ged = (mode: 'initials' | 'anonymous'): string =>
    exportToGedcom(applyLivingPrivacy(privacyTree(), mode, NOW), 'Privacy').content;

describe('GEDCOM export with living privacy', () => {
    for (const mode of ['initials', 'anonymous'] as const) {
        it(`${mode}: drops the living person's and her marriage's details, keeps the deceased`, () => {
            const out = ged(mode);
            // Living person and her marriage: no variant, note, date, place, witness.
            for (const secret of [
                'Liviana', 'Secretvariant', 'Living secret note', 'Livingtown', 'APR 1965',
                '22 AUG 1994', 'AUG 1994', 'Secretchapel', 'Theodora', 'Hiddenwitness', 'Living wedding secret note',
            ]) {
                expect(out, `leaked "${secret}"`).not.toContain(secret);
            }
            // Deceased ancestors keep their data.
            for (const kept of [
                'Ambrose', 'Ambrosius Eichrucken', 'Deceased note kept', '1935', '2010',
                'Oldchapel', '11 JUN 1958', 'Cornelius Oldwitness', 'Old wedding note kept',
            ]) {
                expect(out, `lost "${kept}"`).toContain(kept);
            }
        });
    }

    it('anonymous drops the living names and the wedding year too (initials keeps the year, as on the person)', () => {
        const out = ged('anonymous');
        expect(out).not.toContain('Livia');
        expect(out).not.toContain('Lucius');
        expect(out).not.toContain('1994');
    });
});
