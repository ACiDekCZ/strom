/**
 * Kinship calculator: determines the relationship between two persons and
 * the connecting path, with Czech, English and German naming.
 *
 * Blood relations are derived from the closest common ancestor: person A is
 * `m` generations below it, person B is `n` generations below it. Affinity
 * (in-law) relations are blood relations reached through one partnership
 * hop on either end, or through one on each end (the husband of the
 * husband's sister is a brother-in-law). Any other tie through marriages is
 * reported as "related by marriage", never as no relation.
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

/**
 * The term for B's sex: male, female, or — a sex the records do not give —
 * the neutral one (child, parent, sibling…; a pair where a language has no
 * neutral word).
 */
function bySex(gender: Gender | undefined, male: KinshipTerm, female: KinshipTerm, unknown: KinshipTerm): KinshipTerm {
    return gender === 'male' ? male : gender === 'female' ? female : unknown;
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
export interface KinshipTerm { cs: string; en: string; de: string; pl: string }

/** Blood term for (up m, down n) with B's gender. Returns null when uncovered. */
function bloodTerm(m: number, n: number, bGender: Gender | undefined): KinshipTerm {
    const t = (male: KinshipTerm, female: KinshipTerm, unknown: KinshipTerm) => bySex(bGender, male, female, unknown);

    // Direct ancestor of A (B is m=0? no: B is the one n steps under CA...)
    // Convention here: A is m steps below the common ancestor, B is n steps below.
    // B is A's ANCESTOR when n === 0; B is A's DESCENDANT when m === 0.
    if (n === 0) {
        // B is ancestor, m generations up
        if (m === 1) return t({ cs: 'otec', en: 'father', de: 'Vater', pl: 'ojciec' }, { cs: 'matka', en: 'mother', de: 'Mutter', pl: 'matka' },
            { cs: 'rodič', en: 'parent', de: 'Elternteil', pl: 'rodzic' });
        if (m === 2) return t({ cs: 'děd', en: 'grandfather', de: 'Großvater', pl: 'dziadek' }, { cs: 'babička', en: 'grandmother', de: 'Großmutter', pl: 'babcia' },
            { cs: 'prarodič', en: 'grandparent', de: 'Großelternteil', pl: 'dziadek / babcia' });
        return t(
            { cs: `${pra(m - 2)}děd`, en: `${great(m - 2)}grandfather`, de: ur(m - 2, 'großvater'), pl: `${pra(m - 2)}dziadek` },
            { cs: `${pra(m - 2)}babička`, en: `${great(m - 2)}grandmother`, de: ur(m - 2, 'großmutter'), pl: `${pra(m - 2)}babcia` },
            { cs: `${pra(m - 2)}prarodič`, en: `${great(m - 2)}grandparent`, de: ur(m - 2, 'großelternteil'), pl: `${pra(m - 2)}dziadek / ${pra(m - 2)}babcia` });
    }
    if (m === 0) {
        // B is descendant, n generations down
        if (n === 1) return t({ cs: 'syn', en: 'son', de: 'Sohn', pl: 'syn' }, { cs: 'dcera', en: 'daughter', de: 'Tochter', pl: 'córka' },
            { cs: 'dítě', en: 'child', de: 'Kind', pl: 'dziecko' });
        if (n === 2) return t({ cs: 'vnuk', en: 'grandson', de: 'Enkel', pl: 'wnuk' }, { cs: 'vnučka', en: 'granddaughter', de: 'Enkelin', pl: 'wnuczka' },
            { cs: 'vnouče', en: 'grandchild', de: 'Enkelkind', pl: 'wnuk / wnuczka' });
        return t(
            { cs: `${pra(n - 2)}vnuk`, en: `${great(n - 2)}grandson`, de: ur(n - 2, 'enkel'), pl: `${pra(n - 2)}wnuk` },
            { cs: `${pra(n - 2)}vnučka`, en: `${great(n - 2)}granddaughter`, de: ur(n - 2, 'enkelin'), pl: `${pra(n - 2)}wnuczka` },
            { cs: `${pra(n - 2)}vnouče`, en: `${great(n - 2)}grandchild`, de: ur(n - 2, 'enkelkind'), pl: `${pra(n - 2)}wnuk / ${pra(n - 2)}wnuczka` });
    }
    if (m === 1 && n === 1) {
        return t({ cs: 'bratr', en: 'brother', de: 'Bruder', pl: 'brat' }, { cs: 'sestra', en: 'sister', de: 'Schwester', pl: 'siostra' },
            { cs: 'sourozenec', en: 'sibling', de: 'Geschwister', pl: 'brat / siostra' });
    }
    if (n === 1) {
        // B is a sibling of A's ancestor: uncle/aunt line (m >= 2)
        if (m === 2) return t({ cs: 'strýc', en: 'uncle', de: 'Onkel', pl: 'wujek' }, { cs: 'teta', en: 'aunt', de: 'Tante', pl: 'ciotka' },
            { cs: 'strýc / teta', en: 'uncle / aunt', de: 'Onkel / Tante', pl: 'wujek / ciotka' });
        // EN: 'granduncle' already encodes one grand-level, so the great-
        // prefix count is m-3 (grandparent's brother = granduncle, no great-).
        // DE likewise: Großonkel, Urgroßonkel, ...
        const male = { cs: `${pra(m - 2)}strýc`, en: `${great(m - 3)}granduncle`, de: ur(m - 3, 'großonkel'), pl: `brat ${pra(m - 3)}dziadka / ${pra(m - 3)}babci` };
        const female = { cs: `${pra(m - 2)}teta`, en: `${great(m - 3)}grandaunt`, de: ur(m - 3, 'großtante'), pl: `siostra ${pra(m - 3)}dziadka / ${pra(m - 3)}babci` };
        return t(male, female, either(male, female));
    }
    if (m === 1) {
        // B is a descendant of A's sibling: nephew/niece line (n >= 2)
        if (n === 2) return t({ cs: 'synovec', en: 'nephew', de: 'Neffe', pl: 'bratanek / siostrzeniec' }, { cs: 'neteř', en: 'niece', de: 'Nichte', pl: 'bratanica / siostrzenica' },
            { cs: 'synovec / neteř', en: 'nephew / niece', de: 'Neffe / Nichte', pl: 'dziecko rodzeństwa' });
        const male = { cs: `${pra(n - 2)}synovec`, en: `${great(n - 3)}grandnephew`, de: ur(n - 3, 'großneffe'), pl: `${pra(n - 3)}wnuk rodzeństwa` };
        const female = { cs: `${pra(n - 2)}neteř`, en: `${great(n - 3)}grandniece`, de: ur(n - 3, 'großnichte'), pl: `${pra(n - 3)}wnuczka rodzeństwa` };
        return t(male, female, either(male, female));
    }

    // Cousins: both m, n >= 2
    const degree = Math.min(m, n) - 1;
    const removal = Math.abs(m - n);
    const csBase = bGender === 'male' ? 'bratranec' : bGender === 'female' ? 'sestřenice' : 'bratranec / sestřenice';
    const enBase = 'cousin';
    const deBase = bGender === 'male' ? 'Cousin' : bGender === 'female' ? 'Cousine' : 'Cousin / Cousine';
    const plBase = bGender === 'male' ? 'kuzyn' : bGender === 'female' ? 'kuzynka' : 'kuzyn / kuzynka';
    const csDegree = degree === 1 ? csBase : `${csBase} ${degree}. stupně`;
    const plDegree = degree === 1 ? plBase : `${plBase} ${degree}. stopnia`;
    const enDegree = `${ordinalEn(degree)} ${enBase}`;
    const deDegree = degree === 1 ? deBase : `${deBase} ${degree}. Grades`;
    if (removal === 0) {
        return { cs: csDegree, en: enDegree, de: deDegree, pl: plDegree };
    }
    return {
        cs: `${csDegree} (posunutí o ${removal} ${removal === 1 ? 'generaci' : removal <= 4 ? 'generace' : 'generací'})`,
        en: `${enDegree} ${removal === 1 ? 'once' : removal === 2 ? 'twice' : `${removal} times`} removed`,
        de: `${deDegree} (um ${removal} ${removal === 1 ? 'Generation' : 'Generationen'} versetzt)`,
        pl: `${plDegree} (przesunięcie o ${removal} ${removal === 1 ? 'pokolenie' : (removal % 10 >= 2 && removal % 10 <= 4 && !(removal % 100 >= 12 && removal % 100 <= 14)) ? 'pokolenia' : 'pokoleń'})`,
    };
}

/** "uncle / aunt" — both words, for a person of unknown sex where a language has no neutral one. */
function either(male: KinshipTerm, female: KinshipTerm): KinshipTerm {
    return { cs: `${male.cs} / ${female.cs}`, en: `${male.en} / ${female.en}`, de: `${male.de} / ${female.de}`, pl: `${male.pl} / ${female.pl}` };
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
    bGender: Gender | undefined
): KinshipTerm | null {
    const t = (male: KinshipTerm, female: KinshipTerm, unknown: KinshipTerm) => bySex(bGender, male, female, unknown);

    if (viaPartnerOfA) {
        // B is A's partner's blood relative
        if (n === 0 && m === 1) return t({ cs: 'tchán', en: 'father-in-law', de: 'Schwiegervater', pl: 'teść' }, { cs: 'tchyně', en: 'mother-in-law', de: 'Schwiegermutter', pl: 'teściowa' },
            { cs: 'tchán / tchyně', en: 'parent-in-law', de: 'Schwiegerelternteil', pl: 'teść / teściowa' });
        if (m === 1 && n === 1) return siblingInLaw(bGender);
        // B is a child of A's partner but not A's own child.
        if (m === 0 && n === 1) return t({ cs: 'nevlastní syn', en: 'stepson', de: 'Stiefsohn', pl: 'pasierb' }, { cs: 'nevlastní dcera', en: 'stepdaughter', de: 'Stieftochter', pl: 'pasierbica' },
            { cs: 'nevlastní dítě', en: 'stepchild', de: 'Stiefkind', pl: 'pasierb / pasierbica' });
    } else {
        // B is the partner of A's blood relative
        if (m === 0 && n === 1) return t({ cs: 'zeť', en: 'son-in-law', de: 'Schwiegersohn', pl: 'zięć' }, { cs: 'snacha', en: 'daughter-in-law', de: 'Schwiegertochter', pl: 'synowa' },
            { cs: 'zeť / snacha', en: 'child-in-law', de: 'Schwiegerkind', pl: 'zięć / synowa' });
        if (m === 1 && n === 1) return siblingInLaw(bGender);
        if (m === 2 && n === 1) return t({ cs: 'strýc (přiženěný)', en: 'uncle (by marriage)', de: 'Onkel (angeheiratet)', pl: 'wujek (przez małżeństwo)' }, { cs: 'teta (přivdaná)', en: 'aunt (by marriage)', de: 'Tante (angeheiratet)', pl: 'ciotka (przez małżeństwo)' },
            { cs: 'strýc / teta (sňatkem)', en: 'uncle / aunt (by marriage)', de: 'Onkel / Tante (angeheiratet)', pl: 'wujek / ciotka (przez małżeństwo)' });
        // B is the partner of A's parent, and not A's parent (no blood tie).
        if (m === 1 && n === 0) return t({ cs: 'nevlastní otec', en: 'stepfather', de: 'Stiefvater', pl: 'ojczym' }, { cs: 'nevlastní matka', en: 'stepmother', de: 'Stiefmutter', pl: 'macocha' },
            { cs: 'nevlastní rodič', en: 'stepparent', de: 'Stiefelternteil', pl: 'ojczym / macocha' });
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
            pl: `${result.term.pl} (linia adopcyjna)`,
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
            ? bySex(b.gender,
                { cs: 'bývalý manžel / partner', en: 'ex-husband / ex-partner', de: 'Ex-Ehemann / Ex-Partner', pl: 'były mąż / partner' },
                { cs: 'bývalá manželka / partnerka', en: 'ex-wife / ex-partner', de: 'Ex-Ehefrau / Ex-Partnerin', pl: 'była żona / partnerka' },
                { cs: 'bývalý choť / partner', en: 'ex-spouse / ex-partner', de: 'Ex-Ehepartner / Ex-Partner', pl: 'były małżonek / partner' })
            : bySex(b.gender,
                { cs: 'manžel / partner', en: 'husband / partner', de: 'Ehemann / Partner', pl: 'mąż / partner' },
                { cs: 'manželka / partnerka', en: 'wife / partner', de: 'Ehefrau / Partnerin', pl: 'żona / partnerka' },
                { cs: 'choť / partner', en: 'spouse / partner', de: 'Ehepartner / Partner', pl: 'małżonek / partner' });
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
                term = bySex(b.gender,
                    { cs: 'polorodý bratr', en: 'half-brother', de: 'Halbbruder', pl: 'brat przyrodni' },
                    { cs: 'polorodá sestra', en: 'half-sister', de: 'Halbschwester', pl: 'siostra przyrodnia' },
                    { cs: 'polorodý sourozenec', en: 'half-sibling', de: 'Halbgeschwister', pl: 'rodzeństwo przyrodnie' });
            }
        }
        return { path: blood.path, term, affinity: false };
    }

    // Ties through marriage too distant for a word of their own: the
    // closest one is named "related by marriage" when nothing closer is.
    let fallback: { score: number; path: PersonId[] } | null = null;
    const offerFallback = (rel: BloodRelation, hops: number, path: PersonId[]) => {
        const score = rel.m + rel.n + hops;
        if (!fallback || score < fallback.score) fallback = { score, path };
    };

    // 3. Affinity: B is a blood relative of A's partner
    for (const partnerId of partnersOf(data, aId)) {
        const rel = findBloodRelation(data, partnerId, bId);
        if (rel && rel.m + rel.n > 6) offerFallback(rel, 1, [aId, ...rel.path]);
        if (rel && rel.m + rel.n <= 6) {
            const special = affinityTerm(true, rel.m, rel.n, b.gender);
            const partner = data.persons[partnerId];
            const partnerLabel = bySex(partner?.gender,
                { cs: 'manžela', en: "husband's", de: 'des Ehemanns', pl: 'męża' },
                { cs: 'manželky', en: "wife's", de: 'der Ehefrau', pl: 'żony' },
                { cs: 'chotě', en: "spouse's", de: 'des Ehepartners', pl: 'małżonka' });
            const bloodDesc = bloodTerm(rel.m, rel.n, b.gender);
            const term = special ?? {
                cs: `${bloodDesc.cs} ${partnerLabel.cs}`,
                en: `${partnerLabel.en} ${bloodDesc.en}`,
                de: `${bloodDesc.de} ${partnerLabel.de}`,
                pl: `${bloodDesc.pl} ${partnerLabel.pl}`,
            };
            return { path: [aId, ...rel.path], term, affinity: true };
        }
    }

    // 4. Affinity: B is the partner of A's blood relative
    for (const partnerId of partnersOf(data, bId)) {
        const rel = findBloodRelation(data, aId, partnerId);
        if (rel && rel.m + rel.n > 6) offerFallback(rel, 1, [...rel.path, bId]);
        if (rel && rel.m + rel.n <= 6) {
            const special = affinityTerm(false, rel.m, rel.n, b.gender);
            const relative = data.persons[partnerId];
            const relDesc = bloodTerm(rel.m, rel.n, relative?.gender);
            // The term follows "B is, relative to A:", so the relative goes
            // without a possessive ("husband of a first cousin").
            const ofRel = `of ${indefiniteEn(relDesc.en)}`;
            const term = special ?? bySex(b.gender,
                { cs: `manžel — ${relDesc.cs}`, en: `husband ${ofRel}`, de: `Ehemann — ${relDesc.de}`, pl: `mąż – ${relDesc.pl}` },
                { cs: `manželka — ${relDesc.cs}`, en: `wife ${ofRel}`, de: `Ehefrau — ${relDesc.de}`, pl: `żona – ${relDesc.pl}` },
                { cs: `choť — ${relDesc.cs}`, en: `spouse ${ofRel}`, de: `Ehepartner — ${relDesc.de}`, pl: `małżonek – ${relDesc.pl}` });
            return { path: [...rel.path, bId], term, affinity: true };
        }
    }

    // 5. Affinity through two marriages: B is the partner of a blood relative
    // of A's partner. Two persons married to the same one are not covered.
    for (const aPartnerId of partnersOf(data, aId)) {
        for (const bPartnerId of partnersOf(data, bId)) {
            if (aPartnerId === bPartnerId) continue;
            const rel = findBloodRelation(data, aPartnerId, bPartnerId);
            if (!rel) continue;
            const path = [aId, ...rel.path, bId];
            // The partner of the partner's sibling is a sibling-in-law too.
            if (rel.m === 1 && rel.n === 1) return { path, term: siblingInLaw(b.gender), affinity: true };
            offerFallback(rel, 2, path);
        }
    }

    // (assigned in a closure, so TypeScript narrows it to null here)
    const best = fallback as { score: number; path: PersonId[] } | null;
    if (best) return { path: best.path, term: relatedByMarriage(b.gender), affinity: true };
    return null;
}

/** An English noun phrase with its indefinite article ("a niece", "an uncle"). */
function indefiniteEn(phrase: string): string {
    return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

function siblingInLaw(gender: Gender | undefined): KinshipTerm {
    return bySex(gender,
        { cs: 'švagr', en: 'brother-in-law', de: 'Schwager', pl: 'szwagier' },
        { cs: 'švagrová', en: 'sister-in-law', de: 'Schwägerin', pl: 'szwagierka' },
        { cs: 'švagr / švagrová', en: 'sibling-in-law', de: 'Schwager / Schwägerin', pl: 'szwagier / szwagierka' });
}

/** A tie through marriages with no closer word. */
function relatedByMarriage(gender: Gender | undefined): KinshipTerm {
    return bySex(gender,
        { cs: 'příbuzný sňatkem', en: 'related by marriage', de: 'verschwägert', pl: 'spowinowacony' },
        { cs: 'příbuzná sňatkem', en: 'related by marriage', de: 'verschwägert', pl: 'spowinowacona' },
        { cs: 'příbuzný / příbuzná sňatkem', en: 'related by marriage', de: 'verschwägert', pl: 'spowinowacony / spowinowacona' });
}
