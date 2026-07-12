/**
 * Kinship calculator: determines the relationship between two persons and
 * the connecting path, with Czech and English naming.
 *
 * Blood relations are derived from the closest common ancestor: person A is
 * `m` generations below it, person B is `n` generations below it. Affinity
 * (in-law) relations are blood relations reached through exactly one
 * partnership hop on either end.
 */

import { StromData, PersonId, Person, Gender } from './types.js';

export interface KinshipResult {
    /** Person IDs forming the connecting path (A ... B), for highlighting. */
    path: PersonId[];
    /** Localized description: "B je váš bratranec" body (term only). */
    term: { cs: string; en: string };
    /** True when the relation goes through a partnership (in-law). */
    affinity: boolean;
}

interface AncestorEntry {
    depth: number;
    path: PersonId[];  // from the person up to (and including) the ancestor
}

/** BFS upward: all ancestors of a person with depth and path. */
function collectAncestors(data: StromData, start: PersonId, maxDepth = 20): Map<PersonId, AncestorEntry> {
    const result = new Map<PersonId, AncestorEntry>();
    result.set(start, { depth: 0, path: [start] });
    let frontier: PersonId[] = [start];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: PersonId[] = [];
        for (const pid of frontier) {
            const person = data.persons[pid];
            if (!person) continue;
            for (const parentId of person.parentIds) {
                if (result.has(parentId)) continue;
                const entry = result.get(pid)!;
                result.set(parentId, { depth, path: [...entry.path, parentId] });
                next.push(parentId);
            }
        }
        frontier = next;
    }
    return result;
}

function isMale(person: Person | undefined): boolean {
    return person?.gender !== 'female';
}

/** 'pra' repeated n times (Czech) / 'great-' repeated n times (English). */
function pra(n: number): string { return 'pra'.repeat(n); }
function great(n: number): string { return 'great-'.repeat(n); }

/** Blood term for (up m, down n) with B's gender. Returns null when uncovered. */
function bloodTerm(m: number, n: number, bGender: Gender): { cs: string; en: string } {
    const male = bGender !== 'female';

    // Direct ancestor of A (B is m=0? no: B is the one n steps under CA...)
    // Convention here: A is m steps below the common ancestor, B is n steps below.
    // B is A's ANCESTOR when n === 0; B is A's DESCENDANT when m === 0.
    if (n === 0) {
        // B is ancestor, m generations up
        if (m === 1) return male ? { cs: 'otec', en: 'father' } : { cs: 'matka', en: 'mother' };
        if (m === 2) return male ? { cs: 'děd', en: 'grandfather' } : { cs: 'babička', en: 'grandmother' };
        return male
            ? { cs: `${pra(m - 2)}děd`, en: `${great(m - 2)}grandfather` }
            : { cs: `${pra(m - 2)}babička`, en: `${great(m - 2)}grandmother` };
    }
    if (m === 0) {
        // B is descendant, n generations down
        if (n === 1) return male ? { cs: 'syn', en: 'son' } : { cs: 'dcera', en: 'daughter' };
        if (n === 2) return male ? { cs: 'vnuk', en: 'grandson' } : { cs: 'vnučka', en: 'granddaughter' };
        return male
            ? { cs: `${pra(n - 2)}vnuk`, en: `${great(n - 2)}grandson` }
            : { cs: `${pra(n - 2)}vnučka`, en: `${great(n - 2)}granddaughter` };
    }
    if (m === 1 && n === 1) {
        return male ? { cs: 'bratr', en: 'brother' } : { cs: 'sestra', en: 'sister' };
    }
    if (n === 1) {
        // B is a sibling of A's ancestor: uncle/aunt line (m >= 2)
        if (m === 2) return male ? { cs: 'strýc', en: 'uncle' } : { cs: 'teta', en: 'aunt' };
        return male
            ? { cs: `${pra(m - 2)}strýc`, en: `${great(m - 2)}granduncle` }
            : { cs: `${pra(m - 2)}teta`, en: `${great(m - 2)}grandaunt` };
    }
    if (m === 1) {
        // B is a descendant of A's sibling: nephew/niece line (n >= 2)
        if (n === 2) return male ? { cs: 'synovec', en: 'nephew' } : { cs: 'neteř', en: 'niece' };
        return male
            ? { cs: `${pra(n - 2)}synovec`, en: `${great(n - 2)}grandnephew` }
            : { cs: `${pra(n - 2)}neteř`, en: `${great(n - 2)}grandniece` };
    }

    // Cousins: both m, n >= 2
    const degree = Math.min(m, n) - 1;
    const removal = Math.abs(m - n);
    const csBase = male ? 'bratranec' : 'sestřenice';
    const enBase = male ? 'cousin' : 'cousin';
    const csDegree = degree === 1 ? csBase : `${csBase} ${degree}. stupně`;
    const enDegree = `${ordinalEn(degree)} ${enBase}`;
    if (removal === 0) {
        return { cs: csDegree, en: enDegree };
    }
    return {
        cs: `${csDegree} (posunutí o ${removal} ${removal === 1 ? 'generaci' : removal <= 4 ? 'generace' : 'generací'})`,
        en: `${enDegree} ${removal === 1 ? 'once' : removal === 2 ? 'twice' : `${removal} times`} removed`,
    };
}

function ordinalEn(n: number): string {
    if (n === 1) return 'first';
    if (n === 2) return 'second';
    if (n === 3) return 'third';
    return `${n}th`;
}

/** Affinity terms for close in-law relations reached through one marriage. */
function affinityTerm(
    viaPartnerOfA: boolean,   // true: B is blood relative of A's partner; false: B is partner of A's blood relative
    m: number, n: number,     // blood geometry between the blood-related pair
    bGender: Gender
): { cs: string; en: string } | null {
    const male = bGender !== 'female';

    if (viaPartnerOfA) {
        // B is A's partner's blood relative
        if (n === 0 && m === 1) return male ? { cs: 'tchán', en: 'father-in-law' } : { cs: 'tchyně', en: 'mother-in-law' };
        if (m === 1 && n === 1) return male ? { cs: 'švagr', en: 'brother-in-law' } : { cs: 'švagrová', en: 'sister-in-law' };
    } else {
        // B is the partner of A's blood relative
        if (m === 0 && n === 1) return male ? { cs: 'zeť', en: 'son-in-law' } : { cs: 'snacha', en: 'daughter-in-law' };
        if (m === 1 && n === 1) return male ? { cs: 'švagr', en: 'brother-in-law' } : { cs: 'švagrová', en: 'sister-in-law' };
        if (m === 2 && n === 1) return male ? { cs: 'strýc (přiženěný)', en: 'uncle (by marriage)' } : { cs: 'teta (přivdaná)', en: 'aunt (by marriage)' };
    }
    return null;
}

/** All partners of a person (via partnerships). */
function partnersOf(data: StromData, pid: PersonId): PersonId[] {
    const person = data.persons[pid];
    if (!person) return [];
    const result: PersonId[] = [];
    for (const partnershipId of person.partnerships) {
        const p = data.partnerships[partnershipId];
        if (!p) continue;
        const other = p.person1Id === pid ? p.person2Id : p.person1Id;
        if (other && data.persons[other]) result.push(other);
    }
    return result;
}

interface BloodRelation {
    m: number;
    n: number;
    path: PersonId[];
    commonAncestors: PersonId[];
}

/** Closest blood relation between two persons (smallest m+n, then smallest max). */
function findBloodRelation(data: StromData, aId: PersonId, bId: PersonId): BloodRelation | null {
    const aAnc = collectAncestors(data, aId);
    const bAnc = collectAncestors(data, bId);

    let best: BloodRelation | null = null;
    for (const [ancestorId, aEntry] of aAnc) {
        const bEntry = bAnc.get(ancestorId);
        if (!bEntry) continue;
        const m = aEntry.depth;
        const n = bEntry.depth;
        const candidate: BloodRelation = {
            m, n,
            path: [...aEntry.path, ...bEntry.path.slice(0, -1).reverse()],
            commonAncestors: [ancestorId],
        };
        if (!best
            || m + n < best.m + best.n
            || (m + n === best.m + best.n && Math.max(m, n) < Math.max(best.m, best.n))) {
            best = candidate;
        } else if (m + n === best.m + best.n && m === best.m && n === best.n
            && !best.commonAncestors.includes(ancestorId)) {
            // The other member of the ancestor couple — full vs. half relation
            best.commonAncestors.push(ancestorId);
        }
    }
    return best;
}

/**
 * Full kinship lookup. Returns null when no relation within limits is found.
 */
export function findRelationship(data: StromData, aId: PersonId, bId: PersonId): KinshipResult | null {
    if (aId === bId) return null;
    const b = data.persons[bId];
    if (!data.persons[aId] || !b) return null;

    // 1. Direct partners?
    if (partnersOf(data, aId).includes(bId)) {
        return {
            path: [aId, bId],
            term: isMale(b) ? { cs: 'manžel / partner', en: 'husband / partner' } : { cs: 'manželka / partnerka', en: 'wife / partner' },
            affinity: true,
        };
    }

    // 2. Blood relation
    const blood = findBloodRelation(data, aId, bId);
    if (blood) {
        let term = bloodTerm(blood.m, blood.n, b.gender);
        // Half siblings: single shared parent out of a two-parent situation
        if (blood.m === 1 && blood.n === 1 && blood.commonAncestors.length === 1) {
            const aParents = data.persons[aId]?.parentIds ?? [];
            const bParents = data.persons[bId]?.parentIds ?? [];
            if (aParents.length > 1 || bParents.length > 1) {
                term = isMale(b)
                    ? { cs: 'nevlastní bratr (společný jeden rodič)', en: 'half-brother' }
                    : { cs: 'nevlastní sestra (společný jeden rodič)', en: 'half-sister' };
            }
        }
        return { path: blood.path, term, affinity: false };
    }

    // 3. Affinity: B is a blood relative of A's partner
    for (const partnerId of partnersOf(data, aId)) {
        const rel = findBloodRelation(data, partnerId, bId);
        if (rel && rel.m + rel.n <= 6) {
            const special = affinityTerm(true, rel.m, rel.n, b.gender);
            const partner = data.persons[partnerId];
            const partnerLabel = isMale(partner) ? { cs: 'manžela', en: "husband's" } : { cs: 'manželky', en: "wife's" };
            const bloodDesc = bloodTerm(rel.m, rel.n, b.gender);
            const term = special ?? {
                cs: `${bloodDesc.cs} ${partnerLabel.cs}`,
                en: `${partnerLabel.en} ${bloodDesc.en}`,
            };
            return { path: [aId, ...rel.path], term, affinity: true };
        }
    }

    // 4. Affinity: B is the partner of A's blood relative
    for (const partnerId of partnersOf(data, bId)) {
        const rel = findBloodRelation(data, aId, partnerId);
        if (rel && rel.m + rel.n <= 6) {
            const special = affinityTerm(false, rel.m, rel.n, b.gender);
            const relative = data.persons[partnerId];
            const relDesc = bloodTerm(rel.m, rel.n, relative?.gender ?? 'male');
            const term = special ?? (isMale(b)
                ? { cs: `manžel — ${relDesc.cs}`, en: `husband of your ${relDesc.en}` }
                : { cs: `manželka — ${relDesc.cs}`, en: `wife of your ${relDesc.en}` });
            return { path: [...rel.path, bId], term, affinity: true };
        }
    }

    return null;
}
