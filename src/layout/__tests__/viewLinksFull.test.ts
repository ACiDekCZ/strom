/**
 * Full pipeline invariants with links "linked in the view only" laid out
 * (src/layout/pipeline/view-layer.ts): a virtual link must behave exactly as
 * a real one for the layout.
 *
 * 1. Every person of each scenario as focus, in the standard and expanded
 *    modes, cards of one height and of their own heights: valid positions,
 *    no card overlap, the built-in validation and the strict geometry audit
 *    (crossings, collinear merges, T-touches, lines through cards) — the
 *    same checks as allPersonsFull.test.ts, no tolerance widened. The tree's
 *    data stay untouched.
 * 2. Every link of a scenario is laid out with its line flagged.
 * 3. Equivalence: every focus and mode, the view link lays out exactly as
 *    the same link made real (the derived data stored as a tree).
 *
 * Scenarios (invented data only):
 * - the research fixture (e2e/fixtures/research-hypothesis-links.ged): H0022
 *   B (an island of five as parents), C (one parent alone), B with the
 *   partners link H0024 and the chained H0030, C with H0024; a real mother
 *   and a "?" father the shown father replaces (alone in the "?" family, and
 *   with a sibling staying there);
 * - the comprehensive fixture with families attached: parents (and theirs)
 *   of a child's spouse with a chain inside that family, one parent alone, a
 *   partner, parents replacing a named stand-in, a real parent + "?" filled
 *   by a shown one, parents of the stepmother; a partner of the focus's spouse.
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline, buildViewLayer } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, PartnershipId, Person, StromData, LayoutConfig, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { ViewLink } from '../../view-links.js';
import { loadHypothesisLinksTree } from '../../__tests__/helpers/hypothesis-links-fixture.js';

const DEPTH = 6;

const MODES = [
    { name: 'standard', heights: false, displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded', heights: false, displayPolicy: { mode: 'standard' as const, autoExpand: true } },
    { name: 'standard-v3', heights: true, displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded-v3', heights: true, displayPolicy: { mode: 'standard' as const, autoExpand: true } },
];

const vl = (hypo: string, kind: ViewLink['kind'], anchorId: PersonId, islandIds: PersonId[], addedAt = 1): ViewLink =>
    ({ hypo, variant: 'A', kind, anchorId, islandIds, on: true, addedAt });

function addPerson(d: StromData, id: string, gender: 'male' | 'female', birth?: string): PersonId {
    d.persons[id as PersonId] = {
        id: id as PersonId, firstName: id, lastName: 'Island', gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...(birth ? { birthDate: birth } : {}),
    } as Person;
    return id as PersonId;
}

function addFamily(d: StromData, id: string, a: PersonId, b: PersonId, children: PersonId[]): void {
    const uid = id as PartnershipId;
    d.partnerships[uid] = { id: uid, person1Id: a, person2Id: b, childIds: [...children], status: 'married' };
    d.persons[a].partnerships.push(uid);
    d.persons[b].partnerships.push(uid);
    for (const c of children) {
        d.persons[c].parentIds.push(a, b);
        d.persons[a].childIds.push(c);
        d.persons[b].childIds.push(c);
    }
}

/** A child of `parent` alone (normalized into a "?" family, as the app keeps it). */
function addSingleParentChild(d: StromData, parent: PersonId, child: PersonId): void {
    d.persons[child].parentIds.push(parent);
    d.persons[parent].childIds.push(child);
}

interface Scenario { name: string; data: StromData; links: ViewLink[] }

function researchScenarios(): { strict: Scenario[]; equivalence: Scenario[] } {
    const { data, id } = loadHypothesisLinksTree();
    const VACLAV = id('P0010'), ANTONIN = id('P0012'), JAKUB = id('P0125'), MARIE = id('P0126'), JAN = id('P0130');
    const B = vl('H0022', 'child', VACLAV, [JAKUB, MARIE]);
    const C = vl('H0022', 'child', VACLAV, [JAN]);
    const PARTNER = vl('H0024', 'partners', id('P0011'), [id('P0140')], 2);
    const CHAIN = vl('H0030', 'child', id('P0128'), [id('P0150')], 3);

    // Václav with a real mother and a "?" father the shown father replaces.
    const withMother = structuredClone(data);
    const mother = addPerson(withMother, 'real_mother', 'female', '1795');
    addSingleParentChild(withMother, mother, VACLAV);
    normalizeSingleParents(withMother);

    // Antonín with a real mother and a "?" father, a sibling in that "?" family:
    // the shown father takes Antonín into a family of his own with the mother.
    const withSibling = structuredClone(data);
    const aMother = addPerson(withSibling, 'real_mother', 'female', '1770');
    addSingleParentChild(withSibling, aMother, ANTONIN);
    normalizeSingleParents(withSibling);
    const sib = addPerson(withSibling, 'real_sibling', 'female', '1805');
    const qFamily = Object.values(withSibling.partnerships).find(u => u.childIds.includes(ANTONIN))!;
    const stand = qFamily.person1Id === aMother ? qFamily.person2Id : qFamily.person1Id;
    qFamily.childIds.push(sib);
    withSibling.persons[sib].parentIds.push(aMother, stand);
    withSibling.persons[aMother].childIds.push(sib);
    withSibling.persons[stand].childIds.push(sib);
    const aFather = addPerson(withSibling, 'island_father', 'male', '1768');
    const A_FATHER = vl('H0028', 'child', ANTONIN, [aFather], 4);

    // The same with Václav: his half-sibling stands on his wife's side.
    const vSibling = structuredClone(withMother);
    const vSib = addPerson(vSibling, 'real_sibling', 'female', '1820');
    const vq = Object.values(vSibling.partnerships).find(u => u.childIds.includes(VACLAV))!;
    const vStand = vq.person1Id === mother ? vq.person2Id : vq.person1Id;
    vq.childIds.push(vSib);
    vSibling.persons[vSib].parentIds.push(mother, vStand);
    vSibling.persons[mother].childIds.push(vSib);
    vSibling.persons[vStand].childIds.push(vSib);

    return {
        strict: [
            { name: 'H0022 B', data, links: [B] },
            { name: 'H0022 C', data, links: [C] },
            { name: 'H0022 B + H0024 + H0030 chain', data, links: [B, PARTNER, CHAIN] },
            { name: 'H0022 C + H0024', data, links: [C, PARTNER] },
            { name: 'real mother + shown father (fills "?")', data: withMother, links: [C, PARTNER] },
            { name: 'real mother + shown father, sibling stays with "?"', data: withSibling, links: [B, A_FATHER, PARTNER] },
        ],
        equivalence: [
            { name: 'Václav: half-sibling on the wife\'s side', data: vSibling, links: [C, PARTNER] },
        ],
    };
}

/** The comprehensive fixture with families outside it, and the links that attach them. */
function comprehensiveScenarios(): { strict: Scenario[]; equivalence: Scenario[] } {
    const d = loadFixture('comprehensive');
    const P = (id: string) => id as PersonId;
    // Parents of a child's spouse (a sibling, the father's parents); a chain inside that island.
    const af = addPerson(d, 'iA_father', 'male', '1958'), am = addPerson(d, 'iA_mother', 'female', '1960');
    const asib = addPerson(d, 'iA_sibling', 'male', '1990');
    addFamily(d, 'u_iA', af, am, [asib]);
    const agf = addPerson(d, 'iA_gfather', 'male', '1930'), agm = addPerson(d, 'iA_gmother', 'female', '1932');
    addFamily(d, 'u_iA_g', agf, agm, [af]);
    const ad = addPerson(d, 'iD_parent', 'male', '1900');
    // One parent alone; partners; parents replacing a named stand-in; parents of the stepmother.
    const bp = addPerson(d, 'iB_parent', 'female', '1960');
    const cp = addPerson(d, 'iC_partner', 'male', '1985');
    const cp2 = addPerson(d, 'iC2_partner', 'male', '1960');
    const ef = addPerson(d, 'iE_father', 'male', '1925'), em = addPerson(d, 'iE_mother', 'female', '1927');
    addFamily(d, 'u_iE', ef, em, []);
    const gf = addPerson(d, 'iG_father', 'male', '1925'), gm = addPerson(d, 'iG_mother', 'female', '1927');
    addFamily(d, 'u_iG', gf, gm, []);
    // A real mother of the uncle's husband (a "?" family), filled by a shown father.
    const rm = addPerson(d, 'real_mother', 'female', '1928');
    addSingleParentChild(d, rm, P('uncle_w_1_husband'));
    normalizeSingleParents(d);
    const ff = addPerson(d, 'iF_father', 'male', '1926');
    // Parents (with theirs) of the focus's spouse: both partners of the focus couple have ancestors.
    const sf = addPerson(d, 'iS_father', 'male', '1930'), sm = addPerson(d, 'iS_mother', 'female', '1932');
    const ssib = addPerson(d, 'iS_sibling', 'male', '1958');
    addFamily(d, 'u_iS', sf, sm, [ssib]);
    const sgf = addPerson(d, 'iS_gfather', 'male', '1900'), sgm = addPerson(d, 'iS_gmother', 'female', '1902');
    addFamily(d, 'u_iS_g', sgf, sgm, [sf]);

    const ISLANDS = [
        vl('H0101', 'child', P('child_1_spouse'), [af, am], 1),
        vl('H0102', 'child', agf, [ad], 2),
        vl('H0103', 'child', P('nephew_1_1_spouse'), [bp], 3),
        vl('H0105', 'child', P('aunt_h_1_spouse'), [ef, em], 5),
        vl('H0106', 'child', P('uncle_w_1_husband'), [ff], 6),
        vl('H0107', 'child', P('stepmother'), [gf, gm], 7),
        vl('H0108', 'partners', P('cousin_h_1_spouse'), [cp2], 8),
    ];
    const SPOUSE_PARTNER = vl('H0104', 'partners', P('focus_spouse'), [cp], 4);
    const SPOUSE_PARENTS = vl('H0109', 'child', P('focus_spouse'), [sf, sm], 9);
    return {
        strict: [
            { name: 'comprehensive + islands', data: d, links: ISLANDS },
            { name: 'comprehensive + partner of the focus\'s spouse', data: d, links: [SPOUSE_PARTNER] },
        ],
        equivalence: [
            { name: 'comprehensive: parents of the focus\'s spouse', data: d, links: [SPOUSE_PARENTS] },
            { name: 'comprehensive: all islands', data: d, links: [...ISLANDS, SPOUSE_PARTNER, SPOUSE_PARENTS] },
        ],
    };
}

const research = researchScenarios();
const comprehensive = comprehensiveScenarios();
const SCENARIOS: Scenario[] = [...research.strict, ...comprehensive.strict];
/**
 * Constellations the layout does not yet draw without a crossing even when
 * the link is real — the in-law column of a spouse beside a sibling family on
 * that spouse's side (a parent's other family there; the parents of the
 * focus's spouse beside the focus's maternal aunts). The class needs couple
 * re-orientation planning (see KNOWN_LINE_KNOTS in allPersonsFull.test.ts);
 * here they prove that the view link draws them exactly as the real link.
 */
const EQUIVALENCE_ONLY: Scenario[] = [...research.equivalence, ...comprehensive.equivalence];

for (const scenario of SCENARIOS) {
    const { data, links } = scenario;
    const personIds = Object.keys(data.persons) as PersonId[];
    const v3Config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(personIds) };
    const before = JSON.stringify(data);

    describe(`View links: full pipeline invariants [${scenario.name}]`, () => {
        for (const personId of personIds) {
            for (const mode of MODES) {
                it(`${personId} [${mode.name}]`, () => {
                    const failures: string[] = [];
                    const modeConfig = mode.heights ? v3Config : DEFAULT_LAYOUT_CONFIG;
                    const run = (cfg: LayoutConfig) => runLayoutPipeline({
                        data, focusPersonId: personId, config: cfg,
                        ancestorDepth: DEPTH, descendantDepth: DEPTH,
                        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
                        displayPolicy: mode.displayPolicy, viewLinks: links,
                    });
                    const result = run(modeConfig);
                    try { assertValidPositions(result.positions); } catch (e) { failures.push(`Positions: ${(e as Error).message.split('\n')[0]}`); }
                    try { assertNoNodeOverlap(result.positions, modeConfig.cardWidth, modeConfig.cardHeight); } catch (e) { failures.push(`Overlap: ${(e as Error).message.split('\n')[0]}`); }
                    if (!result.diagnostics.validationPassed) for (const err of result.diagnostics.errors.slice(0, 5)) failures.push(`Validation: ${err}`);
                    const layoutData = result.viewLayer?.data ?? data;
                    for (const v of auditGeometry(result, modeConfig, layoutData).filter(v => v.type !== 'inherent-crossing').slice(0, 5)) {
                        failures.push(`Geometry: [${v.type}] ${v.detail}`);
                    }
                    if (mode.heights) for (const v of auditBands(result, modeConfig, run(DEFAULT_LAYOUT_CONFIG)).slice(0, 5)) failures.push(`Bands: ${v}`);
                    expect(failures, `${scenario.name} / ${personId} [${mode.name}]`).toEqual([]);
                    // The tree's data are never changed by laying out a view link.
                    expect(JSON.stringify(data)).toBe(before);
                });
            }
        }

        it('every link is laid out, and its line is flagged where both ends are drawn', () => {
            for (const link of links) {
                // Focus on the anchor: it and its shown people are in the view.
                const result = runLayoutPipeline({
                    data, focusPersonId: link.anchorId, config: DEFAULT_LAYOUT_CONFIG,
                    ancestorDepth: DEPTH, descendantDepth: DEPTH,
                    includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
                    displayPolicy: { mode: 'standard', autoExpand: true }, viewLinks: links,
                });
                expect(result.viewLayer?.links).toContain(link);
                for (const id of link.islandIds) {
                    expect(result.positions.has(id), `${link.hypo}: ${id} drawn`).toBe(true);
                    expect(result.viewLayer!.ghostIds.has(id)).toBe(true);
                }
                if (link.kind === 'child') {
                    const drop = result.connections.flatMap(c => c.drops).find(d => d.personId === link.anchorId);
                    expect(drop?.view, `${link.hypo}: drop to the anchor`).toBe('virtual');
                } else {
                    const line = result.spouseLines.find(s => [s.person1Id, s.person2Id].includes(link.anchorId) && [s.person1Id, s.person2Id].includes(link.islandIds[0]));
                    expect(line?.view, `${link.hypo}: partner line`).toBe('virtual');
                }
            }
        });
    });
}

/** A layout without the view flags (for comparing with the same links made real). */
function geometry(result: ReturnType<typeof runLayoutPipeline>): unknown {
    const strip = <T extends { view?: unknown }>(x: T): Omit<T, 'view'> => { const { view: _view, ...rest } = x; return rest; };
    return {
        positions: [...result.positions],
        connections: result.connections.map(c => ({ ...strip(c), unionId: undefined, drops: c.drops.map(strip) })),
        spouseLines: result.spouseLines.map(l => ({ ...strip(l), unionId: undefined, partnershipId: undefined })),
    };
}

describe('View links: laid out exactly as the same links made real', () => {
    for (const scenario of [...SCENARIOS, ...EQUIVALENCE_ONLY]) {
        it(scenario.name, () => {
            const { data, links } = scenario;
            // The links made real: the derived data stored as a tree of its own.
            const real = structuredClone(buildViewLayer(data, links)!.data);
            for (const personId of Object.keys(data.persons) as PersonId[]) {
                for (const mode of MODES.filter(m => !m.heights)) {
                    const input = {
                        focusPersonId: personId, config: DEFAULT_LAYOUT_CONFIG,
                        ancestorDepth: DEPTH, descendantDepth: DEPTH,
                        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
                        displayPolicy: mode.displayPolicy,
                    };
                    const shown = runLayoutPipeline({ ...input, data, viewLinks: links });
                    const made = runLayoutPipeline({ ...input, data: real });
                    expect(geometry(shown), `${personId} [${mode.name}]`).toEqual(geometry(made));
                }
            }
        });
    }
});
