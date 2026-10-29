/**
 * A woman with two partners (GitHub issue #6): family F1 = A + B with the
 * child D1 (no marriage), family F2 = C + B with a marriage and the children
 * D2, D3. B is drawn as a partner chain A – B – C. The chain's second union
 * led its children from the bottom of the other partner's card only, so D1
 * (with F2 first) or D2, D3 (with F1 first) looked like children of one
 * parent. Every union of the chain now leads its children from its own
 * spouse line, in the middle between the two parents, whatever the order of
 * the families, the marriage or the focus.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline } from '../pipeline/index.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { parseGedcom, convertToStrom } from '../../ged-parser.js';
import { DEFAULT_LAYOUT_CONFIG, PersonId, PartnershipId, Person, StromData } from '../../types.js';
import type { LayoutResult, Connection } from '../pipeline/types.js';

const W = DEFAULT_LAYOUT_CONFIG.cardWidth;

function issueGedcom(f2First: boolean, f1Married: boolean): StromData {
    const indi = (id: string, name: string, sex: string) => `0 @${id}@ INDI\n1 NAME ${name}\n1 SEX ${sex}\n`;
    const f1 = `0 @F1@ FAM\n1 HUSB @A@\n1 WIFE @B@\n${f1Married ? '1 MARR\n' : ''}1 CHIL @D1@\n`;
    const f2 = '0 @F2@ FAM\n1 HUSB @C@\n1 WIFE @B@\n1 MARR\n1 CHIL @D2@\n1 CHIL @D3@\n';
    const ged = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n'
        + indi('A', 'Adam /Lindqvist/', 'M') + indi('B', 'Berit /Holm/', 'F') + indi('C', 'Carl /Sandberg/', 'M')
        + indi('D1', 'Dagny /Lindqvist/', 'F') + indi('D2', 'Erik /Sandberg/', 'M') + indi('D3', 'Frej /Sandberg/', 'M')
        + (f2First ? f2 + f1 : f1 + f2) + '0 TRLR\n';
    return convertToStrom(parseGedcom(ged)).data;
}

function layout(data: StromData, focus: PersonId, mode: 'standard' | 'expanded'): LayoutResult {
    return runLayoutPipeline({
        data, focusPersonId: focus, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 5, descendantDepth: 5,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode, autoExpand: true },
    });
}

const lineTo = (r: LayoutResult, child: PersonId): Connection =>
    r.connections.find(c => c.drops.some(d => d.personId === child))!;

/** The stem leaves the couple's own spouse line in the middle of the gap between the two cards. */
function expectFromCoupleMiddle(r: LayoutResult, conn: Connection, p: PersonId, q: PersonId): void {
    const [left, right] = [r.positions.get(p)!.x, r.positions.get(q)!.x].sort((a, b) => a - b);
    expect(conn.stemPersonId).toBeUndefined();
    expect(conn.stemX).toBe((left + W + right) / 2);
    expect(conn.stemTopY).toBe(r.spouseLines.find(l => l.unionId === conn.unionId)!.y);
}

describe('a child of a woman with two partners is linked to both parents (issue #6)', () => {
    for (const f2First of [false, true]) {
        for (const f1Married of [false, true]) {
            const data = issueGedcom(f2First, f1Married);
            const id = (first: string) => Object.values(data.persons).find(p => p.firstName === first)!.id;
            const [a, b, c, d1, d2, d3] = ['Adam', 'Berit', 'Carl', 'Dagny', 'Erik', 'Frej'].map(id);
            for (const [focusName, focus] of [['B', b], ['A', a], ['C', c], ['D1', d1]] as const) {
                for (const mode of ['standard', 'expanded'] as const) {
                    it(`${f2First ? 'F2 first' : 'F1 first'}${f1Married ? ', F1 married' : ''}, focus ${focusName} (${mode})`, () => {
                        const r = layout(data, focus, mode);
                        expectFromCoupleMiddle(r, lineTo(r, d1), a, b);
                        const second = lineTo(r, d2);
                        expect(lineTo(r, d3)).toBe(second);
                        expectFromCoupleMiddle(r, second, b, c);
                        expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
                    });
                }
            }
        }
    }
});

describe('a chain union\'s stem stays clear of the other lines in its gap', () => {
    function tree(build: (person: (id: string, g: 'male' | 'female') => PersonId,
        family: (id: string, x: PersonId, y: PersonId, kids: PersonId[]) => void) => void): StromData {
        const d = { persons: {}, partnerships: {} } as unknown as StromData;
        const person = (id: string, gender: 'male' | 'female'): PersonId => {
            d.persons[id as PersonId] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [] } as Person;
            return id as PersonId;
        };
        const family = (id: string, x: PersonId, y: PersonId, kids: PersonId[]): void => {
            d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: x, person2Id: y, childIds: [...kids], status: 'partners' };
            for (const p of [x, y]) d.persons[p].partnerships.push(id as PartnershipId);
            for (const k of kids) {
                d.persons[k].parentIds.push(x, y);
                d.persons[x].childIds.push(k);
                d.persons[y].childIds.push(k);
            }
        };
        build(person, family);
        return d;
    }

    it('wide families: the first family\'s line reaches under the second couple\'s gap', () => {
        const data = tree((person, family) => {
            const b = person('B', 'female');
            family('u1', person('A', 'male'), b, ['a1', 'a2', 'a3', 'a4'].map(k => person(k, 'male')));
            family('u2', person('C', 'male'), b, ['c1', 'c2', 'c3', 'c4'].map(k => person(k, 'male')));
        });
        for (const mode of ['standard', 'expanded'] as const) {
            const r = layout(data, 'B' as PersonId, mode);
            const first = lineTo(r, 'a1' as PersonId);
            const second = lineTo(r, 'c1' as PersonId);
            const bRight = r.positions.get('B' as PersonId)!.x + W;
            const cLeft = r.positions.get('C' as PersonId)!.x;
            expect(second.stemPersonId).toBeUndefined();
            expect(second.stemX).toBeGreaterThan(bRight);
            expect(second.stemX).toBeLessThan(cLeft);
            expect(second.stemX).toBeGreaterThanOrEqual(first.branchRightX + DEFAULT_LAYOUT_CONFIG.minEdgeClearance);
            expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
        }
    });

    it('three partners: the far partner\'s line leaves the spouse line in the gap beside that partner', () => {
        const data = tree((person, family) => {
            const b = person('B', 'female');
            family('u1', person('A', 'male'), b, [person('a1', 'male')]);
            family('u2', person('C', 'male'), b, [person('c1', 'male'), person('c2', 'female')]);
            family('u3', person('E', 'male'), b, [person('e1', 'male')]);
        });
        for (const mode of ['standard', 'expanded'] as const) {
            const r = layout(data, 'B' as PersonId, mode);
            const x = (p: string) => r.positions.get(p as PersonId)!.x;
            expect(x('C')).toBeLessThan(x('E'));
            const far = lineTo(r, 'e1' as PersonId);
            expect(far.stemPersonId).toBeUndefined();
            expect(far.stemX).toBeGreaterThan(x('C') + W);
            expect(far.stemX).toBeLessThan(x('E'));
            expect(far.stemTopY).toBe(r.spouseLines.find(l => l.unionId === far.unionId)!.y);
            expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
        }
    });
});
