/**
 * A new research for a copy of a research tree (spec 139 K5.4): the tree it
 * is handed (POST /adopt) carries none of the old research's numbers, so the
 * new research numbers every person and source itself and names them back by
 * the file's xrefs. Other numbers stay. Invented data (Rodina Kalinovských).
 */

import { describe, it, expect } from 'vitest';
import { withoutResearchNumbers } from '../research-link.js';
import { exportToGedcom } from '../ged-exporter.js';
import type { PersonId, StromData } from '../types.js';

function copyOfResearchTree(): StromData {
    const p = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
        id, firstName, lastName: 'Kalinovský', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
    });
    return {
        version: 11,
        persons: {
            a: p('a', 'Václav', { refn: 'P0012', refnType: 'strom-research' }),
            b: p('b', 'Jan', { refn: 'P0013' }),
            c: p('c', 'Karel', { refn: 'A-17', refnType: 'Archiv Klenov' }),
            d: p('d', 'Josef', { refn: 'P0099', refnType: 'MyHeritage' }),
        },
        partnerships: {},
        sources: {
            s1: { id: 's1', title: 'Matrika Klenov 1850', refn: 'S0004' },
            s2: { id: 's2', title: 'Kronika', refn: 'K12' },
        },
    } as unknown as StromData;
}

describe('the tree a new research is handed', () => {
    it('leaves out the old research\'s numbers of people and sources, keeps the others', () => {
        const data = copyOfResearchTree();
        const out = withoutResearchNumbers(data);
        const p = (id: string) => out.persons[id as PersonId];
        expect(p('a').refn).toBeUndefined();
        expect(p('a').refnType).toBeUndefined();
        expect(p('b').refn).toBeUndefined();
        expect(p('c')).toMatchObject({ refn: 'A-17', refnType: 'Archiv Klenov' });
        // Another program's number of the same shape is not the research's.
        expect(p('d')).toMatchObject({ refn: 'P0099', refnType: 'MyHeritage' });
        expect(out.sources?.s1.refn).toBeUndefined();
        expect(out.sources?.s2.refn).toBe('K12');
        // The tree itself is not changed.
        expect(data.persons['a' as PersonId].refn).toBe('P0012');
        expect(data.sources?.s1.refn).toBe('S0004');
    });

    it('its GEDCOM names no person or source by the old research\'s number', () => {
        const ged = exportToGedcom(withoutResearchNumbers(copyOfResearchTree()), 'Rodina Kalinovských (kopie)').content;
        expect(ged).not.toMatch(/\n1 REFN (P0012|P0013|S0004)\b/);
        expect(ged).toContain('1 REFN A-17');
    });

    it('a tree without such numbers is handed as it is', () => {
        const data = copyOfResearchTree();
        for (const p of Object.values(data.persons)) if (p.refnType !== 'Archiv Klenov' && p.refnType !== 'MyHeritage') delete p.refn;
        delete data.sources!.s1.refn;
        expect(withoutResearchNumbers(data)).toBe(data);
    });
});
