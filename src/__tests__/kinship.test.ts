/**
 * Kinship calculator tests against the comprehensive fixture
 * (uncles, aunts, cousins, half-siblings, in-laws are all present there).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { findRelationship } from '../kinship.js';
import { StromData, PersonId } from '../types.js';

const data = JSON.parse(
    readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8')
) as StromData;

const rel = (a: string, b: string) => findRelationship(data, a as PersonId, b as PersonId);

describe('findRelationship — blood relations', () => {
    it('parent and child', () => {
        expect(rel('focus', 'father')!.term.cs).toBe('otec');
        expect(rel('focus', 'mother')!.term.cs).toBe('matka');
        expect(rel('father', 'focus')!.term.cs).toBe('syn');
        expect(rel('focus', 'child_1')!.term.en).toMatch(/son|daughter/);
    });

    it('grandparents and beyond', () => {
        expect(rel('focus', 'gp_h_h')!.term.cs).toBe('děd');
        expect(rel('focus', 'ggp_h_w')!.term.cs).toBe('prababička');
        expect(rel('focus', 'gggp_h_h')!.term.cs).toBe('prapraděd');
        expect(rel('gggp_h_h', 'focus')!.term.en).toMatch(/great-grandson|great-granddaughter/);
    });

    it('siblings and half-siblings', () => {
        const sib = rel('focus', 'sibling_1')!;
        expect(sib.term.cs).toMatch(/^(bratr|sestra)$/);
        const half = rel('focus', 'halfsibling_1')!;
        expect(half.term.cs).toContain('nevlastní');
    });

    it('uncle, aunt, nephew', () => {
        expect(rel('focus', 'uncle_h_1')!.term.cs).toBe('strýc');
        expect(rel('focus', 'aunt_w_1')!.term.cs).toBe('teta');
        expect(rel('uncle_h_1', 'focus')!.term.cs).toMatch(/synovec|neteř/);
        expect(rel('focus', 'nephew_1_1')!.term.cs).toMatch(/synovec|neteř/);
    });

    it('cousins', () => {
        const c = rel('focus', 'cousin_h_1')!;
        expect(c.term.cs).toMatch(/^(bratranec|sestřenice)$/);
        expect(c.affinity).toBe(false);
    });

    it('path connects the two persons through the common ancestor', () => {
        const c = rel('focus', 'cousin_h_1')!;
        expect(c.path[0]).toBe('focus');
        expect(c.path[c.path.length - 1]).toBe('cousin_h_1');
        // path goes up through father and grandparent side
        expect(c.path).toContain('father');
    });
});

describe('findRelationship — affinity (in-laws)', () => {
    it('partner', () => {
        const p = rel('focus', 'focus_spouse')!;
        expect(p.affinity).toBe(true);
        expect(p.term.cs).toContain('manžel');
    });

    it('parent-in-law', () => {
        // focus_spouse's parents are placeholder-side persons if present;
        // use father's perspective instead: mother's parents are his in-laws
        const r = rel('father', 'gp_w_h');
        expect(r).not.toBeNull();
        expect(r!.affinity).toBe(true);
        expect(r!.term.cs).toBe('tchán');
    });

    it("uncle's wife is aunt by marriage", () => {
        const r = rel('focus', 'aunt_h_1_spouse');
        expect(r).not.toBeNull();
        expect(r!.affinity).toBe(true);
    });

    it('sibling-in-law', () => {
        const r = rel('focus', 'sibling_1_spouse');
        expect(r).not.toBeNull();
        expect(r!.term.cs).toMatch(/švagr|švagrová/);
    });
});

describe('findRelationship — edge cases', () => {
    it('same person returns null', () => {
        expect(rel('focus', 'focus')).toBeNull();
    });

    it('unknown ids return null', () => {
        expect(rel('focus', 'nonexistent_xyz')).toBeNull();
    });

    it('is deterministic', () => {
        const a = rel('focus', 'cousin_h_1')!;
        const b = rel('focus', 'cousin_h_1')!;
        expect(a).toEqual(b);
    });
});
