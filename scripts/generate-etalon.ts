/**
 * Deterministic synthetic etalon generator.
 *
 * Produces a systematically designed set of family-tree fixtures that cover
 * every known and conceivable constellation for the layout engine, written to
 * `test/etalon-*.json`. The set replaces the reliance on real family data
 * (`test/real-large.json`) as the primary correctness reference.
 *
 * Fully deterministic: no Math.random / Date.now. Running it twice produces
 * byte-identical files. Run with `npm run gen:etalon`.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

type Gender = 'male' | 'female';
type Status = 'married' | 'partners' | 'divorced' | 'separated';

interface PersonRec {
    id: string;
    firstName: string;
    lastName: string;
    gender: Gender;
    isPlaceholder: boolean;
    partnerships: string[];
    parentIds: string[];
    childIds: string[];
    birthDate?: string;
}

interface PartRec {
    id: string;
    person1Id: string;
    person2Id: string;
    childIds: string[];
    status: Status;
}

interface PersonOpts {
    /** Explicit first name; defaults to a humanized role label. */
    name?: string;
    /** Explicit surname; defaults to the scenario code. Pass '' for "no surname". */
    surname?: string;
    /** Birth year; when set, birthDate = `${year}-${pad(month)}-15`. */
    year?: number;
    /** Birth month (1-12) used to make sibling order deterministic. */
    month?: number;
    /** Placeholder person (unknown ancestor): firstName '?', no surname. */
    placeholder?: boolean;
}

const opposite = (g: Gender): Gender => (g === 'male' ? 'female' : 'male');
const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

function humanize(role: string): string {
    return role
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/**
 * Small builder that assembles StromData records with the same field order and
 * conventions as the hand-written `test/edge-*.json` fixtures.
 */
class Builder {
    persons: Record<string, PersonRec> = {};
    partnerships: Record<string, PartRec> = {};

    constructor(public code: string) {}

    person(role: string, gender: Gender, opts: PersonOpts = {}): string {
        const id = `e${this.code}_${role}`;
        if (this.persons[id]) {
            throw new Error(`Duplicate person role: ${id}`);
        }
        const placeholder = !!opts.placeholder;
        const rec: PersonRec = {
            id,
            firstName: placeholder ? '?' : (opts.name ?? `${this.code}-${humanize(role)}`),
            lastName: placeholder ? '' : (opts.surname ?? this.code),
            gender,
            isPlaceholder: placeholder,
            partnerships: [],
            parentIds: [],
            childIds: [],
        };
        if (opts.year !== undefined) {
            rec.birthDate = `${opts.year}-${pad(opts.month ?? 6)}-15`;
        }
        this.persons[id] = rec;
        return id;
    }

    /**
     * Create a union. Convention (matches edge fixtures): the male partner is
     * person1 (rendered LEFT), the female partner is person2 (RIGHT). For
     * same-role pairs the passed order is kept.
     */
    marry(aId: string, bId: string, status: Status = 'married'): string {
        const a = this.persons[aId];
        const b = this.persons[bId];
        let p1 = aId;
        let p2 = bId;
        if (a.gender === 'female' && b.gender === 'male') {
            p1 = bId;
            p2 = aId;
        }
        const id = `u_${p1}_${p2}`;
        if (this.partnerships[id]) {
            throw new Error(`Duplicate union: ${id}`);
        }
        this.partnerships[id] = { id, person1Id: p1, person2Id: p2, childIds: [], status };
        this.persons[p1].partnerships.push(id);
        this.persons[p2].partnerships.push(id);
        return id;
    }

    /** Attach children to a union (both parents referenced). */
    kids(unionId: string, ...childIds: string[]): void {
        const u = this.partnerships[unionId];
        for (const c of childIds) {
            u.childIds.push(c);
            this.persons[c].parentIds = [u.person1Id, u.person2Id];
            if (!this.persons[u.person1Id].childIds.includes(c)) this.persons[u.person1Id].childIds.push(c);
            if (!this.persons[u.person2Id].childIds.includes(c)) this.persons[u.person2Id].childIds.push(c);
        }
    }

    /** Attach children to a single known parent (no partnership, one parentId). */
    singleKids(parentId: string, ...childIds: string[]): void {
        for (const c of childIds) {
            this.persons[parentId].childIds.push(c);
            this.persons[c].parentIds = [parentId];
        }
    }

    merge(other: Builder): void {
        for (const [id, p] of Object.entries(other.persons)) {
            if (this.persons[id]) throw new Error(`Merge collision (person): ${id}`);
            this.persons[id] = p;
        }
        for (const [id, u] of Object.entries(other.partnerships)) {
            if (this.partnerships[id]) throw new Error(`Merge collision (union): ${id}`);
            this.partnerships[id] = u;
        }
    }

    /** First single childless person (sorted by id) matching code prefix + gender. */
    firstSingle(codePrefix: string, gender: Gender): string | null {
        const ids = Object.keys(this.persons)
            .filter(id => id.startsWith(`e${codePrefix}_`))
            .filter(id => {
                const p = this.persons[id];
                return p.gender === gender && p.partnerships.length === 0 &&
                    p.childIds.length === 0 && !p.isPlaceholder;
            })
            .sort();
        return ids[0] ?? null;
    }

    toJSON(): { persons: Record<string, PersonRec>; partnerships: Record<string, PartRec> } {
        return { persons: this.persons, partnerships: this.partnerships };
    }
}

// ============================================================================
// Scenarios A-N
// ============================================================================

const STEP = 28; // years per generation

/** A. Pure line of 10 generations (direct ancestors/descendants + partners). */
function scenarioLine(code = 'A'): Builder {
    const b = new Builder(code);
    const GENS = 10;
    const baseYear = 1740;
    let spine = b.person('spine0', 'male', { year: baseYear });
    let union: string | null = null;
    for (let g = 0; g < GENS; g++) {
        const spineGender = b.persons[spine].gender;
        const spouse = b.person(`spouse${g}`, opposite(spineGender), { year: baseYear + g * STEP + 2 });
        union = b.marry(spine, spouse);
        if (g < GENS - 1) {
            const childGender: Gender = (g + 1) % 2 === 0 ? 'male' : 'female';
            const child = b.person(`spine${g + 1}`, childGender, { year: baseYear + (g + 1) * STEP });
            b.kids(union, child);
            spine = child;
        }
    }
    return b;
}

/** B. Full binary ancestor tree of depth 5 (31 couples) above one focus. */
function scenarioBinaryAncestors(code = 'B', depth = 5): Builder {
    const b = new Builder(code);
    const focus = b.person('focus', 'male', { year: 1980 });
    const build = (childId: string, path: string, gen: number, d: number): void => {
        if (d === 0) return;
        const fa = b.person(`${path}F`, 'male', { year: 1980 + (gen - 1) * STEP });
        const mo = b.person(`${path}M`, 'female', { year: 1980 + (gen - 1) * STEP + 1 });
        const u = b.marry(fa, mo);
        b.kids(u, childId);
        build(fa, `${path}F`, gen - 1, d - 1);
        build(mo, `${path}M`, gen - 1, d - 1);
    };
    build(focus, '', 0, depth);
    return b;
}

/** C. Wide family: 12 children, each with a partner and 1-4 children. */
function scenarioWide(code = 'C'): Builder {
    const b = new Builder(code);
    const dad = b.person('dad', 'male', { year: 1940 });
    const mom = b.person('mom', 'female', { year: 1942 });
    const u = b.marry(dad, mom);
    for (let i = 0; i < 12; i++) {
        const kidGender: Gender = i % 2 === 0 ? 'male' : 'female';
        const kid = b.person(`kid${i}`, kidGender, { year: 1965 + i, month: (i % 12) + 1 });
        b.kids(u, kid);
        const sp = b.person(`kid${i}_sp`, opposite(kidGender), { year: 1966 + i });
        const ku = b.marry(kid, sp);
        const nKids = (i % 4) + 1;
        const gks: string[] = [];
        for (let j = 0; j < nKids; j++) {
            gks.push(b.person(`gk${i}_${j}`, j % 2 === 0 ? 'male' : 'female', { year: 1992 + i, month: j + 1 }));
        }
        b.kids(ku, ...gks);
    }
    return b;
}

/** D. Deep up + down (5+5 generations) with a side branch at every level. */
function scenarioDeepBoth(code = 'D'): Builder {
    const b = new Builder(code);
    const focus = b.person('focus', 'male', { year: 1960 });
    // Ancestors: 5 levels up. Each level's couple has the spine + one sibling
    // (aunt/uncle) with a small family of their own.
    let child = focus;
    for (let l = 1; l <= 5; l++) {
        const gen = -l;
        const fa = b.person(`up${l}_f`, 'male', { year: 1960 + gen * STEP });
        const mo = b.person(`up${l}_m`, 'female', { year: 1960 + gen * STEP + 1 });
        const u = b.marry(fa, mo);
        const sibGender: Gender = l % 2 === 0 ? 'male' : 'female';
        const sib = b.person(`up${l}_sib`, sibGender, { year: 1960 + (gen + 1) * STEP, month: 8 });
        b.kids(u, child, sib);
        const sibSp = b.person(`up${l}_sibsp`, opposite(sibGender), { year: 1960 + (gen + 1) * STEP + 1 });
        const su = b.marry(sib, sibSp);
        const sibKid = b.person(`up${l}_sibkid`, 'male', { year: 1960 + (gen + 2) * STEP });
        b.kids(su, sibKid);
        child = fa;
    }
    // Descendants: 5 levels down. Each level: heir (continues) + sibling family.
    const focusSp = b.person('focus_sp', 'female', { year: 1961 });
    let parentUnion = b.marry(focus, focusSp);
    for (let l = 1; l <= 5; l++) {
        const gen = l;
        const heirGender: Gender = l % 2 === 0 ? 'male' : 'female';
        const heir = b.person(`dn${l}_heir`, heirGender, { year: 1960 + gen * STEP, month: 1 });
        const sib = b.person(`dn${l}_sib`, opposite(heirGender), { year: 1960 + gen * STEP, month: 6 });
        b.kids(parentUnion, heir, sib);
        const sibSp = b.person(`dn${l}_sibsp`, heirGender, { year: 1960 + gen * STEP + 1 });
        const su = b.marry(sib, sibSp);
        const sibKid = b.person(`dn${l}_sibkid`, 'male', { year: 1960 + (gen + 1) * STEP });
        b.kids(su, sibKid);
        const heirSp = b.person(`dn${l}_heirsp`, opposite(heirGender), { year: 1960 + gen * STEP + 1 });
        parentUnion = b.marry(heir, heirSp);
    }
    return b;
}

/** E. One person with 2 / 3 / 4 partners; children per union; grandchildren under middle unions. */
function scenarioMultiPartners(code = 'E'): Builder {
    const b = new Builder(code);
    const buildStar = (tag: string, nPartners: number, baseYear: number): void => {
        const hub = b.person(`${tag}_hub`, 'male', { year: baseYear });
        const mid = Math.floor(nPartners / 2);
        for (let i = 0; i < nPartners; i++) {
            const partner = b.person(`${tag}_p${i}`, 'female', { year: baseYear + i });
            const u = b.marry(hub, partner);
            const kidGender: Gender = i % 2 === 0 ? 'male' : 'female';
            const kid = b.person(`${tag}_k${i}`, kidGender, { year: baseYear + 25, month: i + 1 });
            b.kids(u, kid);
            // Grandchildren under the middle union(s): the middle one, plus the
            // one before it when there are 4 partners.
            if (i === mid || (nPartners >= 4 && i === mid - 1)) {
                const kidSp = b.person(`${tag}_k${i}_sp`, opposite(kidGender), { year: baseYear + 26 });
                const ku = b.marry(kid, kidSp);
                const gk = b.person(`${tag}_gk${i}`, 'male', { year: baseYear + 50 });
                b.kids(ku, gk);
            }
        }
    };
    buildStar('v2', 2, 1940);
    buildStar('v3', 3, 1945);
    buildStar('v4', 4, 1950);
    return b;
}

/** F. Merged chains: transitive union chain P1-P2-P3-P4-P5, children in each. */
function scenarioMergedChain(code = 'F'): Builder {
    const b = new Builder(code);
    const genders: Gender[] = ['male', 'female', 'male', 'female', 'male'];
    const ids = genders.map((g, i) => b.person(`p${i + 1}`, g, { year: 1950, month: i + 1 }));
    for (let i = 0; i < ids.length - 1; i++) {
        const u = b.marry(ids[i], ids[i + 1]);
        const kidGender: Gender = i % 2 === 0 ? 'female' : 'male';
        const kid = b.person(`k${i}`, kidGender, { year: 1978, month: i + 1 });
        b.kids(u, kid);
        // Grandchildren under the middle union (P2-P3).
        if (i === 1) {
            const kidSp = b.person(`k${i}_sp`, opposite(kidGender), { year: 1979 });
            const ku = b.marry(kid, kidSp);
            const gk = b.person(`gk${i}`, 'male', { year: 2004 });
            b.kids(ku, gk);
        }
    }
    return b;
}

/** G. Chains in the ancestor role: focus parents with extra partners + half-siblings with families. */
function scenarioAncestorChain(code = 'G'): Builder {
    const b = new Builder(code);
    const focus = b.person('focus', 'female', { year: 1980 });
    const fa = b.person('father', 'male', { year: 1950 });
    const mo = b.person('mother', 'female', { year: 1952 });
    const prim = b.marry(fa, mo);
    b.kids(prim, focus);

    // Father's second partner -> paternal half-sibling with own family.
    const ow = b.person('father_ow', 'female', { year: 1955 });
    const u2 = b.marry(fa, ow);
    const half1 = b.person('half_pat', 'male', { year: 1978 });
    b.kids(u2, half1);
    const h1sp = b.person('half_pat_sp', 'female', { year: 1979 });
    const h1u = b.marry(half1, h1sp);
    b.kids(h1u, b.person('half_pat_kid', 'male', { year: 2005 }));

    // Mother's second partner -> maternal half-sibling with own family.
    const oh = b.person('mother_oh', 'male', { year: 1948 });
    const u3 = b.marry(oh, mo);
    const half2 = b.person('half_mat', 'female', { year: 1974 });
    b.kids(u3, half2);
    const h2sp = b.person('half_mat_sp', 'male', { year: 1973 });
    const h2u = b.marry(half2, h2sp);
    b.kids(h2u, b.person('half_mat_kid', 'female', { year: 2000 }));

    // Focus's own family for downward depth.
    const fsp = b.person('focus_sp', 'male', { year: 1979 });
    const fu = b.marry(focus, fsp);
    b.kids(fu, b.person('focus_kid', 'male', { year: 2008 }));
    return b;
}

/** H. Cousin marriage (1st degree = pedigree collapse) + a 2nd-degree variant. */
function scenarioCousinMarriage(code = 'H'): Builder {
    const b = new Builder(code);
    // --- 1st degree ---
    const gf = b.person('gf', 'male', { year: 1900 });
    const gm = b.person('gm', 'female', { year: 1902 });
    const gu = b.marry(gf, gm);
    const s1 = b.person('s1', 'male', { year: 1928, month: 1 });
    const s2 = b.person('s2', 'female', { year: 1930, month: 2 });
    b.kids(gu, s1, s2);
    const u1 = b.marry(s1, b.person('s1_sp', 'female', { year: 1929 }));
    const u2 = b.marry(s2, b.person('s2_sp', 'male', { year: 1927 }));
    const c1 = b.person('c1', 'male', { year: 1955 });
    const c2 = b.person('c2', 'female', { year: 1957 });
    b.kids(u1, c1);
    b.kids(u2, c2);
    const cu = b.marry(c1, c2); // first cousins marry
    b.kids(cu, b.person('cc', 'male', { year: 1985 }));

    // --- 2nd degree ---
    const ggf = b.person('d2_ggf', 'male', { year: 1870 });
    const ggm = b.person('d2_ggm', 'female', { year: 1872 });
    const ggu = b.marry(ggf, ggm);
    const a1 = b.person('d2_a1', 'male', { year: 1898, month: 1 });
    const a2 = b.person('d2_a2', 'female', { year: 1900, month: 2 });
    b.kids(ggu, a1, a2);
    const a1u = b.marry(a1, b.person('d2_a1_sp', 'female', { year: 1899 }));
    const a2u = b.marry(a2, b.person('d2_a2_sp', 'male', { year: 1897 }));
    const b1 = b.person('d2_b1', 'male', { year: 1926 });
    const b2 = b.person('d2_b2', 'female', { year: 1928 });
    b.kids(a1u, b1); // first cousins b1, b2
    b.kids(a2u, b2);
    const b1u = b.marry(b1, b.person('d2_b1_sp', 'female', { year: 1927 }));
    const b2u = b.marry(b2, b.person('d2_b2_sp', 'male', { year: 1925 }));
    const cc1 = b.person('d2_cc1', 'male', { year: 1954 });
    const cc2 = b.person('d2_cc2', 'female', { year: 1956 });
    b.kids(b1u, cc1); // second cousins cc1, cc2
    b.kids(b2u, cc2);
    const ccu = b.marry(cc1, cc2); // second cousins marry
    b.kids(ccu, b.person('d2_ccc', 'female', { year: 1984 }));
    return b;
}

/** I. Two brothers marry two sisters (double in-law). */
function scenarioDoubleInlaw(code = 'I'): Builder {
    const b = new Builder(code);
    const aFa = b.person('a_fa', 'male', { year: 1920 });
    const aMo = b.person('a_mo', 'female', { year: 1922 });
    const au = b.marry(aFa, aMo);
    const bro1 = b.person('bro1', 'male', { year: 1948, month: 1 });
    const bro2 = b.person('bro2', 'male', { year: 1950, month: 2 });
    b.kids(au, bro1, bro2);

    const cFa = b.person('c_fa', 'male', { year: 1921 });
    const cMo = b.person('c_mo', 'female', { year: 1923 });
    const cu = b.marry(cFa, cMo);
    const sis1 = b.person('sis1', 'female', { year: 1949, month: 1 });
    const sis2 = b.person('sis2', 'female', { year: 1951, month: 2 });
    b.kids(cu, sis1, sis2);

    const m1 = b.marry(bro1, sis1);
    const m2 = b.marry(bro2, sis2);
    b.kids(m1, b.person('k1a', 'male', { year: 1975, month: 1 }), b.person('k1b', 'female', { year: 1977, month: 2 }));
    b.kids(m2, b.person('k2a', 'female', { year: 1976, month: 1 }), b.person('k2b', 'male', { year: 1978, month: 2 }));
    return b;
}

/** J. In-law loop: focus's sibling marries focus's partner's sibling. */
function scenarioInlawLoop(code = 'J'): Builder {
    const b = new Builder(code);
    const fFa = b.person('f_fa', 'male', { year: 1925 });
    const fMo = b.person('f_mo', 'female', { year: 1927 });
    const fu = b.marry(fFa, fMo);
    const focus = b.person('focus', 'male', { year: 1952, month: 1 });
    const fsib = b.person('focus_sib', 'female', { year: 1954, month: 2 });
    b.kids(fu, focus, fsib);

    const pFa = b.person('p_fa', 'male', { year: 1926 });
    const pMo = b.person('p_mo', 'female', { year: 1928 });
    const pu = b.marry(pFa, pMo);
    const partner = b.person('partner', 'female', { year: 1953, month: 1 });
    const psib = b.person('partner_sib', 'male', { year: 1955, month: 2 });
    b.kids(pu, partner, psib);

    const m1 = b.marry(focus, partner);
    const m2 = b.marry(fsib, psib);
    b.kids(m1, b.person('focus_kid', 'male', { year: 1980 }));
    b.kids(m2, b.person('sib_kid', 'female', { year: 1982 }));
    return b;
}

/**
 * K. Minimal reproduction of the known line-knot: focus, her uncle with a large
 * family, focus's husband whose parents and grandparents (with their own
 * siblings) form a column between the uncle and the focus's father.
 */
function scenarioInlawColumn(code = 'K'): Builder {
    const b = new Builder(code);
    // Paternal grandparents; their children = focus's father + the uncle.
    const pga = b.person('pgf', 'male', { year: 1900 });
    const pgb = b.person('pgm', 'female', { year: 1902 });
    const pgu = b.marry(pga, pgb);
    const father = b.person('father', 'male', { year: 1930, month: 2 });
    const uncle = b.person('uncle', 'male', { year: 1928, month: 1 });
    b.kids(pgu, uncle, father);
    // Focus's mother + focus.
    const mother = b.person('mother', 'female', { year: 1932 });
    const fu = b.marry(father, mother);
    const focus = b.person('focus', 'female', { year: 1958 });
    b.kids(fu, focus);
    // Uncle's large family.
    const uncleW = b.person('uncle_w', 'female', { year: 1930 });
    const uu = b.marry(uncle, uncleW);
    const ukids: string[] = [];
    for (let i = 0; i < 4; i++) {
        ukids.push(b.person(`uncle_k${i}`, i % 2 === 0 ? 'male' : 'female', { year: 1955 + i, month: i + 1 }));
    }
    b.kids(uu, ...ukids);
    // Give two of the uncle's children their own children (widen the bus span).
    const uk0sp = b.person('uncle_k0_sp', 'female', { year: 1956 });
    const uk0u = b.marry(ukids[0], uk0sp);
    b.kids(uk0u, b.person('uncle_gk0', 'male', { year: 1982 }));
    const uk1sp = b.person('uncle_k1_sp', 'male', { year: 1955 });
    const uk1u = b.marry(ukids[1], uk1sp);
    b.kids(uk1u, b.person('uncle_gk1', 'female', { year: 1983 }));
    // Focus's husband + his married-in ancestor column.
    const husband = b.person('husband', 'male', { year: 1957 });
    const hu = b.marry(focus, husband);
    b.kids(hu, b.person('focus_kid', 'female', { year: 1985 }));
    const hFa = b.person('h_father', 'male', { year: 1930 });
    const hMo = b.person('h_mother', 'female', { year: 1932 });
    const hpu = b.marry(hFa, hMo);
    b.kids(hpu, husband);
    // Husband's paternal grandparents + their sibling (great-uncle) with a family.
    const hga = b.person('h_pgf', 'male', { year: 1902 });
    const hgb = b.person('h_pgm', 'female', { year: 1904 });
    const hgu = b.marry(hga, hgb);
    const hGreatUncle = b.person('h_great_uncle', 'male', { year: 1928, month: 1 });
    b.kids(hgu, hGreatUncle, hFa);
    const guSp = b.person('h_great_uncle_sp', 'female', { year: 1929 });
    const guU = b.marry(hGreatUncle, guSp);
    b.kids(guU, b.person('h_great_uncle_kid', 'male', { year: 1956 }));
    return b;
}

/** L. Ancestors of a descendant's partner: focus's child's partner has 2 full generations of ancestors. */
function scenarioDescPartnerAncestors(code = 'L'): Builder {
    const b = new Builder(code);
    const focus = b.person('focus', 'male', { year: 1950 });
    const focusSp = b.person('focus_sp', 'female', { year: 1951 });
    const fu = b.marry(focus, focusSp);
    const child = b.person('child', 'male', { year: 1978, month: 1 });
    const childSib = b.person('child_sib', 'female', { year: 1980, month: 2 });
    b.kids(fu, child, childSib);
    const cp = b.person('child_partner', 'female', { year: 1979 });
    const cu = b.marry(child, cp);
    b.kids(cu, b.person('gchild', 'male', { year: 2005 }));
    // child_partner's 2 generations of ancestors.
    const cpFa = b.person('cp_fa', 'male', { year: 1950 });
    const cpMo = b.person('cp_mo', 'female', { year: 1952 });
    const cpu = b.marry(cpFa, cpMo);
    b.kids(cpu, cp);
    // paternal + maternal grandparents of child_partner.
    const gpu1 = b.marry(
        b.person('cp_pgf', 'male', { year: 1920 }),
        b.person('cp_pgm', 'female', { year: 1922 }),
    );
    b.kids(gpu1, cpFa);
    const gpu2 = b.marry(
        b.person('cp_mgf', 'male', { year: 1921 }),
        b.person('cp_mgm', 'female', { year: 1923 }),
    );
    b.kids(gpu2, cpMo);
    return b;
}

/** M. Incomplete data: placeholder/single parents at several levels, missing surnames, missing birthdates, mixed sibling ordering. */
function scenarioIncomplete(code = 'M'): Builder {
    const b = new Builder(code);
    // Single known grandmother (no partnership) -> mother.
    const gmother = b.person('gmother', 'female', { year: 1920 });
    const mother = b.person('mother', 'female', { year: 1945 });
    b.singleKids(gmother, mother);
    // Unknown father modelled as a placeholder partner.
    const phFather = b.person('ph_father', 'male', { placeholder: true });
    const u = b.marry(phFather, mother);
    // Children: a mix of dated/undated, some without a surname (determinism of ordering).
    const k1 = b.person('kid_dated1', 'male', { year: 1970, month: 3 });
    const k2 = b.person('kid_undated_a', 'female'); // no birthDate
    const k3 = b.person('kid_nosurname', 'male', { year: 1972, month: 1, surname: '' });
    const k4 = b.person('kid_undated_b', 'female', { surname: '' }); // no birthDate, no surname
    const k5 = b.person('kid_dated2', 'female', { year: 1971, month: 6 });
    b.kids(u, k1, k2, k3, k4, k5);
    // A dated child continues with a single known parent of the next generation.
    const gcSingle = b.person('grandchild_single_parent', 'male', { year: 1995 });
    b.singleKids(k1, gcSingle);
    // Another child with a placeholder spouse and undated grandchildren.
    const phSpouse = b.person('kid_dated2_ph_sp', 'male', { placeholder: true });
    const u2 = b.marry(phSpouse, k5);
    b.kids(u2, b.person('gc_undated', 'male'), b.person('gc_dated', 'female', { year: 1998, month: 4 }));
    return b;
}

/** N. Stress: ~250-300 persons combining representative scenarios, joined by marriages. */
function scenarioStress(code = 'N'): Builder {
    const b = new Builder(code);
    b.merge(scenarioLine(`${code}A`));
    b.merge(scenarioBinaryAncestors(`${code}B`));
    b.merge(scenarioWide(`${code}C`));
    b.merge(scenarioDeepBoth(`${code}D`));
    b.merge(scenarioMultiPartners(`${code}E`));
    b.merge(scenarioCousinMarriage(`${code}H`));
    b.merge(scenarioDoubleInlaw(`${code}I`));

    // Bridge otherwise-disconnected components by marrying single childless
    // leaves of different sub-scenarios and giving them a shared child. The
    // firstSingle picker recomputes live, so a bridged person is never reused.
    const bridges: Array<[string, Gender, string, Gender]> = [
        [`${code}B`, 'male', `${code}C`, 'female'],
        [`${code}C`, 'male', `${code}E`, 'female'],
        [`${code}D`, 'male', `${code}H`, 'female'],
        [`${code}I`, 'male', `${code}A`, 'female'],
        [`${code}E`, 'male', `${code}I`, 'female'],
    ];
    let n = 0;
    for (const [ca, ga, cb, gb] of bridges) {
        const a = b.firstSingle(ca, ga);
        const c = b.firstSingle(cb, gb);
        if (!a || !c || a === c) continue;
        const u = b.marry(a, c);
        b.kids(u, b.person(`bridge_kid${n}`, n % 2 === 0 ? 'male' : 'female', { year: 2010, month: (n % 12) + 1 }));
        n++;
    }
    return b;
}

// ============================================================================
// Registry + emit
// ============================================================================

const SCENARIOS: Array<{ file: string; build: () => Builder }> = [
    { file: 'etalon-line-10gen', build: () => scenarioLine('A') },
    { file: 'etalon-ancestors-binary5', build: () => scenarioBinaryAncestors('B') },
    { file: 'etalon-wide-12', build: () => scenarioWide('C') },
    { file: 'etalon-deep-both', build: () => scenarioDeepBoth('D') },
    { file: 'etalon-multi-partners', build: () => scenarioMultiPartners('E') },
    { file: 'etalon-merged-chain', build: () => scenarioMergedChain('F') },
    { file: 'etalon-ancestor-chain', build: () => scenarioAncestorChain('G') },
    { file: 'etalon-cousin-marriage', build: () => scenarioCousinMarriage('H') },
    { file: 'etalon-double-inlaw', build: () => scenarioDoubleInlaw('I') },
    { file: 'etalon-inlaw-loop', build: () => scenarioInlawLoop('J') },
    { file: 'etalon-inlaw-column', build: () => scenarioInlawColumn('K') },
    { file: 'etalon-descendant-partner-ancestors', build: () => scenarioDescPartnerAncestors('L') },
    { file: 'etalon-incomplete-data', build: () => scenarioIncomplete('M') },
    { file: 'etalon-stress-all', build: () => scenarioStress('N') },
];

function main(): void {
    const testDir = join(process.cwd(), 'test');
    for (const { file, build } of SCENARIOS) {
        const data = build().toJSON();
        const nPersons = Object.keys(data.persons).length;
        const nUnions = Object.keys(data.partnerships).length;
        const out = join(testDir, `${file}.json`);
        writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        console.log(`${file}.json  (${nPersons} persons, ${nUnions} unions)`);
    }
}

main();
