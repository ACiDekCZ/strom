/**
 * Kinship calculator: determines the relationship between two persons and
 * the connecting path, with Czech, English and German naming.
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
    term: KinshipTerm;
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
/**
 * German 'Ur' prefix repeated k times on a lowercase base:
 * ur(0, 'großvater') = 'Großvater', ur(2, 'großvater') = 'Ururgroßvater'.
 */
function ur(k: number, base: string): string {
    if (k <= 0) return base.charAt(0).toUpperCase() + base.slice(1);
    return 'Ur' + 'ur'.repeat(k - 1) + base;
}

/** A localized kinship term. */
export interface KinshipTerm { cs: string; en: string; de: string }

/** Blood term for (up m, down n) with B's gender. Returns null when uncovered. */
function bloodTerm(m: number, n: number, bGender: Gender): KinshipTerm {
    const male = bGender !== 'female';

    // Direct ancestor of A (B is m=0? no: B is the one n steps under CA...)
    // Convention here: A is m steps below the common ancestor, B is n steps below.
    // B is A's ANCESTOR when n === 0; B is A's DESCENDANT when m === 0.
    if (n === 0) {
        // B is ancestor, m generations up
        if (m === 1) return male ? { cs: 'otec', en: 'father', de: 'Vater' } : { cs: 'matka', en: 'mother', de: 'Mutter' };
        if (m === 2) return male ? { cs: 'děd', en: 'grandfather', de: 'Großvater' } : { cs: 'babička', en: 'grandmother', de: 'Großmutter' };
        return male
            ? { cs: `${pra(m - 2)}děd`, en: `${great(m - 2)}grandfather`, de: ur(m - 2, 'großvater') }
            : { cs: `${pra(m - 2)}babička`, en: `${great(m - 2)}grandmother`, de: ur(m - 2, 'großmutter') };
    }
    if (m === 0) {
        // B is descendant, n generations down
        if (n === 1) return male ? { cs: 'syn', en: 'son', de: 'Sohn' } : { cs: 'dcera', en: 'daughter', de: 'Tochter' };
        if (n === 2) return male ? { cs: 'vnuk', en: 'grandson', de: 'Enkel' } : { cs: 'vnučka', en: 'granddaughter', de: 'Enkelin' };
        return male
            ? { cs: `${pra(n - 2)}vnuk`, en: `${great(n - 2)}grandson`, de: ur(n - 2, 'enkel') }
            : { cs: `${pra(n - 2)}vnučka`, en: `${great(n - 2)}granddaughter`, de: ur(n - 2, 'enkelin') };
    }
    if (m === 1 && n === 1) {
        return male ? { cs: 'bratr', en: 'brother', de: 'Bruder' } : { cs: 'sestra', en: 'sister', de: 'Schwester' };
    }
    if (n === 1) {
        // B is a sibling of A's ancestor: uncle/aunt line (m >= 2)
        if (m === 2) return male ? { cs: 'strýc', en: 'uncle', de: 'Onkel' } : { cs: 'teta', en: 'aunt', de: 'Tante' };
        // EN: 'granduncle' already encodes one grand-level, so the great-
        // prefix count is m-3 (grandparent's brother = granduncle, no great-).
        // DE likewise: Großonkel, Urgroßonkel, ...
        return male
            ? { cs: `${pra(m - 2)}strýc`, en: `${great(m - 3)}granduncle`, de: ur(m - 3, 'großonkel') }
            : { cs: `${pra(m - 2)}teta`, en: `${great(m - 3)}grandaunt`, de: ur(m - 3, 'großtante') };
    }
    if (m === 1) {
        // B is a descendant of A's sibling: nephew/niece line (n >= 2)
        if (n === 2) return male ? { cs: 'synovec', en: 'nephew', de: 'Neffe' } : { cs: 'neteř', en: 'niece', de: 'Nichte' };
        return male
            ? { cs: `${pra(n - 2)}synovec`, en: `${great(n - 3)}grandnephew`, de: ur(n - 3, 'großneffe') }
            : { cs: `${pra(n - 2)}neteř`, en: `${great(n - 3)}grandniece`, de: ur(n - 3, 'großnichte') };
    }

    // Cousins: both m, n >= 2
    const degree = Math.min(m, n) - 1;
    const removal = Math.abs(m - n);
    const csBase = male ? 'bratranec' : 'sestřenice';
    const enBase = male ? 'cousin' : 'cousin';
    const deBase = male ? 'Cousin' : 'Cousine';
    const csDegree = degree === 1 ? csBase : `${csBase} ${degree}. stupně`;
    const enDegree = `${ordinalEn(degree)} ${enBase}`;
    const deDegree = degree === 1 ? deBase : `${deBase} ${degree}. Grades`;
    if (removal === 0) {
        return { cs: csDegree, en: enDegree, de: deDegree };
    }
    return {
        cs: `${csDegree} (posunutí o ${removal} ${removal === 1 ? 'generaci' : removal <= 4 ? 'generace' : 'generací'})`,
        en: `${enDegree} ${removal === 1 ? 'once' : removal === 2 ? 'twice' : `${removal} times`} removed`,
        de: `${deDegree} (um ${removal} ${removal === 1 ? 'Generation' : 'Generationen'} versetzt)`,
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
): KinshipTerm | null {
    const male = bGender !== 'female';

    if (viaPartnerOfA) {
        // B is A's partner's blood relative
        if (n === 0 && m === 1) return male ? { cs: 'tchán', en: 'father-in-law', de: 'Schwiegervater' } : { cs: 'tchyně', en: 'mother-in-law', de: 'Schwiegermutter' };
        if (m === 1 && n === 1) return male ? { cs: 'švagr', en: 'brother-in-law', de: 'Schwager' } : { cs: 'švagrová', en: 'sister-in-law', de: 'Schwägerin' };
        // B is a child of A's partner but not A's own child.
        if (m === 0 && n === 1) return male ? { cs: 'nevlastní syn', en: 'stepson', de: 'Stiefsohn' } : { cs: 'nevlastní dcera', en: 'stepdaughter', de: 'Stieftochter' };
    } else {
        // B is the partner of A's blood relative
        if (m === 0 && n === 1) return male ? { cs: 'zeť', en: 'son-in-law', de: 'Schwiegersohn' } : { cs: 'snacha', en: 'daughter-in-law', de: 'Schwiegertochter' };
        if (m === 1 && n === 1) return male ? { cs: 'švagr', en: 'brother-in-law', de: 'Schwager' } : { cs: 'švagrová', en: 'sister-in-law', de: 'Schwägerin' };
        if (m === 2 && n === 1) return male ? { cs: 'strýc (přiženěný)', en: 'uncle (by marriage)', de: 'Onkel (angeheiratet)' } : { cs: 'teta (přivdaná)', en: 'aunt (by marriage)', de: 'Tante (angeheiratet)' };
        // B is the partner of A's parent, and not A's parent (no blood tie).
        if (m === 1 && n === 0) return male ? { cs: 'nevlastní otec', en: 'stepfather', de: 'Stiefvater' } : { cs: 'nevlastní matka', en: 'stepmother', de: 'Stiefmutter' };
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
/** True when any parent-child edge on the path is adoptive/step/foster. */
function pathHasNonBiologicalLink(data: StromData, path: PersonId[]): boolean {
    for (let i = 0; i + 1 < path.length; i++) {
        const a = data.persons[path[i]];
        const b = data.persons[path[i + 1]];
        if (!a || !b) continue;
        if (a.parentIds.includes(b.id) && (a.parentRelTypes?.[b.id] ?? 'biological') !== 'biological') return true;
        if (b.parentIds.includes(a.id) && (b.parentRelTypes?.[a.id] ?? 'biological') !== 'biological') return true;
    }
    return false;
}

export function findRelationship(data: StromData, aId: PersonId, bId: PersonId): KinshipResult | null {
    const result = findRelationshipCore(data, aId, bId);
    // A blood term computed across an adoptive/step/foster link is not a
    // blood relation — say so instead of silently reporting "grandfather".
    if (result && pathHasNonBiologicalLink(data, result.path)) {
        result.term = {
            cs: `${result.term.cs} (adoptivní linie)`,
            en: `${result.term.en} (adoptive line)`,
            de: `${result.term.de} (Adoptivlinie)`,
        };
    }
    return result;
}

function findRelationshipCore(data: StromData, aId: PersonId, bId: PersonId): KinshipResult | null {
    if (aId === bId) return null;
    const b = data.persons[bId];
    if (!data.persons[aId] || !b) return null;

    // 1. Direct partners? Every union between them ended (divorce,
    // separation, a recorded end) → an ex-partner, not a husband/wife.
    if (partnersOf(data, aId).includes(bId)) {
        const unions = Object.values(data.partnerships).filter(u =>
            (u.person1Id === aId && u.person2Id === bId) || (u.person1Id === bId && u.person2Id === aId));
        const ended = unions.length > 0 && unions.every(u =>
            u.status === 'divorced' || u.status === 'separated' || !!u.endDate);
        const term: KinshipTerm = ended
            ? (isMale(b)
                ? { cs: 'bývalý manžel / partner', en: 'ex-husband / ex-partner', de: 'Ex-Ehemann / Ex-Partner' }
                : { cs: 'bývalá manželka / partnerka', en: 'ex-wife / ex-partner', de: 'Ex-Ehefrau / Ex-Partnerin' })
            : (isMale(b)
                ? { cs: 'manžel / partner', en: 'husband / partner', de: 'Ehemann / Partner' }
                : { cs: 'manželka / partnerka', en: 'wife / partner', de: 'Ehefrau / Partnerin' });
        return { path: [aId, bId], term, affinity: true };
    }

    // 2. Blood relation
    const blood = findBloodRelation(data, aId, bId);
    if (blood) {
        let term = bloodTerm(blood.m, blood.n, b.gender);
        // Half siblings: one shared parent, and BOTH have two known parents
        // that differ. With a parent missing on either side we cannot tell,
        // so they stay plain siblings.
        if (blood.m === 1 && blood.n === 1 && blood.commonAncestors.length === 1) {
            const aParents = data.persons[aId]?.parentIds ?? [];
            const bParents = data.persons[bId]?.parentIds ?? [];
            const differ = aParents.length === 2 && bParents.length === 2
                && !(aParents.every(p => bParents.includes(p)));
            if (differ) {
                term = isMale(b)
                    ? { cs: 'nevlastní bratr (společný jeden rodič)', en: 'half-brother', de: 'Halbbruder' }
                    : { cs: 'nevlastní sestra (společný jeden rodič)', en: 'half-sister', de: 'Halbschwester' };
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
            const partnerLabel = isMale(partner)
                ? { cs: 'manžela', en: "husband's", de: 'des Ehemanns' }
                : { cs: 'manželky', en: "wife's", de: 'der Ehefrau' };
            const bloodDesc = bloodTerm(rel.m, rel.n, b.gender);
            const term = special ?? {
                cs: `${bloodDesc.cs} ${partnerLabel.cs}`,
                en: `${partnerLabel.en} ${bloodDesc.en}`,
                de: `${bloodDesc.de} ${partnerLabel.de}`,
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
                ? { cs: `manžel — ${relDesc.cs}`, en: `husband of your ${relDesc.en}`, de: `Ehemann — ${relDesc.de}` }
                : { cs: `manželka — ${relDesc.cs}`, en: `wife of your ${relDesc.en}`, de: `Ehefrau — ${relDesc.de}` });
            return { path: [...rel.path, bId], term, affinity: true };
        }
    }

    return null;
}
