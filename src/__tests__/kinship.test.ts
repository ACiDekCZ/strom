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

describe('audit fixes: EN great- offset and adoptive lines', () => {
    it("grandparent's sibling is a granduncle/grandaunt, not GREAT-grand (EN)", () => {
        // gp_h_h's sibling relative to focus = m=3, n=1 line.
        const structured = structuredClone(data) as StromData;
        // Build: focus -> father -> gp_h_h; give gp_h_h a brother.
        const gp = structured.persons['gp_h_h' as PersonId];
        const bro = {
            ...gp, id: 'gp_brother' as PersonId, firstName: 'Bratr',
            parentIds: [...gp.parentIds], childIds: [], partnerships: [],
        };
        structured.persons[bro.id] = bro;
        for (const pid of bro.parentIds) {
            structured.persons[pid]?.childIds.push(bro.id);
        }
        const r = findRelationship(structured, 'focus' as PersonId, 'gp_brother' as PersonId)!;
        expect(r.term.cs).toBe('prastrýc');
        expect(r.term.en).toBe('granduncle');   // was 'great-granduncle'
    });

    it('a blood term across an adoptive link is marked as adoptive line', () => {
        const structured = structuredClone(data) as StromData;
        const focus = structured.persons['focus' as PersonId];
        focus.parentRelTypes = { ['father' as PersonId]: 'adoptive' };
        const r = findRelationship(structured, 'focus' as PersonId, 'gp_h_h' as PersonId)!;
        expect(r.term.cs).toContain('(adoptivní linie)');
        expect(r.term.en).toContain('(adoptive line)');
        // A path not crossing the adoptive link stays unmarked.
        const clean = findRelationship(structured, 'focus' as PersonId, 'mother' as PersonId)!;
        expect(clean.term.cs).not.toContain('adoptivní');
    });
});

/**
 * U01: a person of unknown sex is named without a sex — child, parent,
 * sibling, spouse — in every language; where a language has no neutral word
 * both stand ("strýc / teta"). The same fixture with B's sex unknown.
 */
describe('findRelationship — a person of unknown sex (U01)', () => {
    const unknownAs = (...ids: string[]): StromData => {
        const copy = structuredClone(data);
        for (const id of ids) copy.persons[id as PersonId].gender = 'unknown';
        return copy;
    };
    const relU = (a: string, b: string) => findRelationship(unknownAs(b), a as PersonId, b as PersonId)!.term;

    it('parent, grandparent and beyond', () => {
        expect(relU('focus', 'father')).toEqual({ cs: 'rodič', en: 'parent', de: 'Elternteil' });
        expect(relU('focus', 'gp_h_h')).toEqual({ cs: 'prarodič', en: 'grandparent', de: 'Großelternteil' });
        expect(relU('focus', 'gggp_h_h')).toEqual({ cs: 'prapraprarodič', en: 'great-great-grandparent', de: 'Ururgroßelternteil' });
    });

    it('child, grandchild and beyond', () => {
        expect(relU('father', 'focus')).toEqual({ cs: 'dítě', en: 'child', de: 'Kind' });
        expect(relU('gp_h_h', 'focus')).toEqual({ cs: 'vnouče', en: 'grandchild', de: 'Enkelkind' });
        expect(relU('gggp_h_h', 'focus')).toEqual({ cs: 'prapravnouče', en: 'great-great-grandchild', de: 'Ururenkelkind' });
    });

    it('sibling, half-sibling, uncle/aunt, nephew/niece, cousin', () => {
        expect(relU('focus', 'sibling_1')).toEqual({ cs: 'sourozenec', en: 'sibling', de: 'Geschwister' });
        expect(relU('focus', 'halfsibling_1').en).toBe('half-sibling');
        expect(relU('focus', 'uncle_h_1')).toEqual({ cs: 'strýc / teta', en: 'uncle / aunt', de: 'Onkel / Tante' });
        expect(relU('focus', 'nephew_1_1').en).toBe('nephew / niece');
        expect(relU('focus', 'cousin_h_1').cs).toBe('bratranec / sestřenice');
    });

    it('spouse and in-laws', () => {
        const spouseId = data.persons['focus' as PersonId].partnerships
            .map(u => data.partnerships[u])
            .map(u => (u.person1Id === 'focus' ? u.person2Id : u.person1Id))[0];
        expect(relU('focus', spouseId).en).toBe('spouse / partner');
        expect(relU('focus', spouseId).cs).toBe('choť / partner');
        expect(relU(spouseId, 'father').en).toBe('parent-in-law');
    });

    it('a known sex keeps its word', () => {
        expect(findRelationship(unknownAs('mother'), 'focus' as PersonId, 'father' as PersonId)!.term.cs).toBe('otec');
    });
});

/**
 * T27: a tie through two marriages. The husband of the husband's sister is a
 * brother-in-law; any other partner–blood–partner tie is "related by
 * marriage", never no relation.
 */
describe('findRelationship — through two marriages (T27)', () => {
    type G = 'male' | 'female' | 'unknown';
    const build = (): StromData => {
        const d = { persons: {}, partnerships: {} } as unknown as StromData;
        const person = (id: string, gender: G, parentIds: string[] = []) => {
            d.persons[id as PersonId] = {
                id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false,
                partnerships: [], parentIds: parentIds as PersonId[], childIds: [],
            } as unknown as StromData['persons'][PersonId];
            for (const p of parentIds) d.persons[p as PersonId].childIds.push(id as PersonId);
        };
        const marry = (a: string, b: string) => {
            const id = `u_${a}_${b}` as StromData['partnerships'][never]['id'];
            d.partnerships[id] = { id, person1Id: a as PersonId, person2Id: b as PersonId, childIds: [], status: 'married' };
            d.persons[a as PersonId].partnerships.push(id);
            d.persons[b as PersonId].partnerships.push(id);
        };
        person('gf', 'male'); person('gm', 'female'); marry('gf', 'gm');
        person('father', 'male', ['gf', 'gm']); person('mother', 'female'); marry('father', 'mother');
        person('uncle', 'male', ['gf', 'gm']); person('uncleWife', 'female'); marry('uncle', 'uncleWife');
        person('pavel', 'male', ['father', 'mother']);
        person('jana', 'female', ['father', 'mother']);
        person('cousin', 'female', ['uncle', 'uncleWife']);
        person('alena', 'female'); marry('pavel', 'alena');
        person('vlastimil', 'male'); marry('vlastimil', 'jana');
        person('cousinHusband', 'unknown'); marry('cousinHusband', 'cousin');
        person('pavelEx', 'female'); marry('pavel', 'pavelEx');
        return d;
    };
    const d = build();
    const r = (a: string, b: string) => findRelationship(d, a as PersonId, b as PersonId);

    it("the husband of the husband's sister is a brother-in-law, and back", () => {
        const fwd = r('alena', 'vlastimil')!;
        expect(fwd.term).toEqual({ cs: 'švagr', en: 'brother-in-law', de: 'Schwager' });
        expect(fwd.affinity).toBe(true);
        expect(fwd.path).toEqual(['alena', 'pavel', 'father', 'jana', 'vlastimil']);
        expect(r('vlastimil', 'alena')!.term).toEqual({ cs: 'švagrová', en: 'sister-in-law', de: 'Schwägerin' });
    });

    it('another tie through two marriages is related by marriage', () => {
        const t = r('alena', 'cousinHusband')!;
        expect(t.term).toEqual({ cs: 'příbuzný / příbuzná sňatkem', en: 'related by marriage', de: 'verschwägert' });
        expect(t.path[0]).toBe('alena');
        expect(t.path[t.path.length - 1]).toBe('cousinHusband');
        expect(r('cousinHusband', 'alena')!.term.cs).toBe('příbuzná sňatkem');
        expect(r('vlastimil', 'uncleWife')!.term.cs).toBe('příbuzná sňatkem');
    });

    it('one marriage hop keeps its own words', () => {
        expect(r('alena', 'jana')!.term.cs).toBe('švagrová');
        expect(r('vlastimil', 'pavel')!.term.cs).toBe('švagr');
    });

    it('two partners of the same person stay without a relation', () => {
        expect(r('alena', 'pavelEx')).toBeNull();
    });

    it('the partner of a blood relative is named without addressing anyone', () => {
        expect(r('pavel', 'cousinHusband')!.term.en).toBe('spouse of a first cousin');
        expect(r('gf', 'vlastimil')!.term.en).toBe('husband of a granddaughter');
        expect(r('gm', 'alena')!.term.en).toBe('wife of a grandson');
        expect(r('gf', 'vlastimil')!.term.cs).toBe('manžel — vnučka');
    });
});

describe('kinship terms are impersonal', () => {
    it('no term addresses the reader, in any language', () => {
        const ids = Object.keys(data.persons) as PersonId[];
        const addressing = /\b(your|you|yours)\b|\b(váš|vaše|vašeho|tvůj|tvoje|tvého)\b|\b(Ihr|Ihre|Ihres|dein|deine|deines|Sie|du)\b/;
        let checked = 0;
        for (const a of ids) {
            for (const b of ids) {
                if (a === b) continue;
                const res = findRelationship(data, a, b);
                if (!res) continue;
                checked++;
                for (const text of [res.term.en, res.term.cs, res.term.de]) expect(text).not.toMatch(addressing);
            }
        }
        expect(checked).toBeGreaterThan(100);
    });
});
