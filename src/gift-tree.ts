/**
 * "Give a family tree" (spec 093): the cut of the tree a person (or a couple)
 * gets as a gift, the protection of the living applied once over it, and the
 * model of the gift's settings. No DOM: the guide, the package and the cover
 * page build on these.
 *
 * The cut is one rule on familySet (src/lineage.ts): the recipient with all
 * ancestors and their partners, all descendants with partners, the siblings
 * of the recipient and of every ancestor, the families (descendants) of the
 * ancestors' siblings up to the chosen depth, per-sibling exceptions
 * (`branches`), and the recipient's stepchildren with their families. Not in
 * it: the ancestors of partners (of the recipient's and of the ancestors'),
 * people linked only through partners, islands.
 */

import type { PersonId, StromData } from './types.js';
import {
    ancestorGenerations, descentParentIds, descentSiblingsOf, familySet, partnersOf, sortByBirth,
    type FamilySpec, type LineageIndex,
} from './lineage.js';
import { extractSubtree } from './subtree.js';
import {
    applyLivingPrivacy, inferBirthUpperBounds, isLivingPerson, stripResearchWork,
    type DeceasedDetails, type LivingSensitive, type PrivacyMode,
} from './privacy.js';
import { stripMedia } from './attachments.js';
import type { FanStyle } from './fan-colors.js';
import { dropDanglingPortraitSources } from './photo.js';

// ==================== Model ====================

/** How far the families of the ancestors' siblings reach: none / first cousins / second cousins / all. */
export type GiftDepth = 0 | 1 | 2 | 'all';

export const GIFT_DEPTHS: readonly GiftDepth[] = [0, 1, 2, 'all'];

/** Who the tree is for and how wide it is. */
export interface GiftCut {
    /** One person, or two for a couple (the cut is the union of both). */
    recipients: PersonId[];
    depth: GiftDepth;
    /** Exceptions by sibling of an ancestor: true = with their family, false = alone (with partners). */
    branches: Record<PersonId, boolean>;
}

/** One sibling of an ancestor whose family can be added or left out. */
export interface GiftBranch {
    siblingId: PersonId;
    /** The ancestor they are a sibling of (the nearest one). */
    ancestorId: PersonId;
    /** 1 = sibling of a parent, 2 = of a grandparent… */
    generation: number;
    /** People in the cut when the family is left out: the sibling and their partners. */
    aloneCount: number;
    /** People in the cut with the family: the sibling, all descendants, everyone's partners. */
    familyCount: number;
    /** Whether the family is in the cut now (depth or exception). */
    included: boolean;
    /** A half-sibling of the ancestor (one parent in common). */
    half: boolean;
    /** For a half-sibling, their parent the ancestor does not share. */
    otherParentId: PersonId | null;
}

/** The details of the living shown in full, by kind (true = kept). */
export type GiftSensitive = LivingSensitive;

/** The protection of the living (spec 093 §4), applied once to the cut before every output. */
export interface GiftPrivacy {
    /** The living outside the household and the exceptions; default 'initials'. */
    others: PrivacyMode;
    /** Exceptions shown in full besides the recipient's household. */
    fullIds: PersonId[];
    /** What the living shown in full (the household and the exceptions) keep. */
    sensitive: GiftSensitive;
    /** Under others 'full': what the other living keep (spec 093 K6.5); unused under the other modes. */
    othersSensitive: GiftSensitive;
    dead: DeceasedDetails;
}

/** The parts of the package; the cover page ("Start here") is always there. */
export interface GiftParts {
    app: boolean;
    pages: boolean;
    book: boolean;
    fan: boolean;
    gedcom: boolean;
}

export type GiftLang = 'cs' | 'en' | 'de' | 'pl';

/** The cover letter (spec 093 §6). */
export interface GiftLetter {
    lang: GiftLang;
    motif: 'none' | 'xmas';
    /** How the letter greets the recipient; each language's placeholder in the message ('[oslovení]', '[name]', '[Name]', '[imię]') is replaced by it. */
    salutation: string;
    message: string;
    signature: string;
    /** ISO date; today by default. */
    date: string;
}

/**
 * The ancestor fan of the package (spec 093 K5.6): one poster per chosen
 * style (two-way when the recipient has descendants in the cut, else a half
 * circle; with portraits when `photos`), or `asTree` one poster in the fan's
 * current look and shape in the app.
 */
export interface GiftFan {
    asTree: boolean;
    /** At least one; in the order of FAN_STYLES. */
    styles: FanStyle[];
    photos: boolean;
}

/** The detail of the cards in the package's app (spec 093 K5.7); 'tree' = the card type of the app now (a custom set too). */
export type GiftCards = 'compact' | 'normal' | 'detailed' | 'register' | 'tree';

export const GIFT_CARDS: readonly GiftCards[] = ['compact', 'normal', 'detailed', 'register', 'tree'];

/** The cards by default: Detailed. */
export const GIFT_DEFAULT_CARDS: GiftCards = 'detailed';

/** The fan by default: Antique with portraits, the shape by the recipient's descendants. */
export function defaultGiftFan(): GiftFan {
    return { asTree: false, styles: ['antique'], photos: true };
}

/** Everything the guide sets for one package. */
export interface GiftSettings {
    cut: GiftCut;
    privacy: GiftPrivacy;
    parts: GiftParts;
    photos: boolean;
    /** The fan's variants (K5.6). */
    fan: GiftFan;
    /** The app's cards (K5.7). */
    cards: GiftCards;
    letter: GiftLetter;
    fileName?: string;
}

/** What the tree remembers for one person or couple (spec 093 §9). */
export interface GiftMemory {
    /** ISO time the settings were last used: a package made, or the guide closed. */
    lastAt: string;
    /** ISO time of the last package made (the person menu's date, §9 [66]); absent while none was made. */
    madeAt?: string;
    settings: GiftSettings;
    /** People in the cut then (to say what changed since). */
    cutSize: number;
}

/** What the other living keep under 'full' by default (spec 093 K6.5): birth dates and photos only. */
export function defaultGiftOthersSensitive(): GiftSensitive {
    return { birthDates: true, photos: true, addresses: false, contacts: false, notes: false, religion: false, sources: false };
}

/** The default protection (spec 093 §4, K6.5). */
export function defaultGiftPrivacy(): GiftPrivacy {
    return {
        others: 'initials',
        fullIds: [],
        sensitive: { birthDates: true, addresses: true, contacts: false, photos: true, notes: false, religion: true, sources: true },
        othersSensitive: defaultGiftOthersSensitive(),
        dead: { causes: true, notes: true, sources: true },
    };
}

/** All parts on (the default). */
export function defaultGiftParts(): GiftParts {
    return { app: true, pages: true, book: true, fan: true, gedcom: true };
}

/** The default depth: second cousins. */
export const GIFT_DEFAULT_DEPTH: GiftDepth = 2;

// ==================== Cut ====================

function dataOf(source: StromData | LineageIndex): StromData {
    return 'rodByPerson' in source ? source.data : source;
}

function exceptionsOf(cut: GiftCut): Map<PersonId, boolean> {
    const out = new Map<PersonId, boolean>();
    for (const [id, on] of Object.entries(cut.branches ?? {})) if (typeof on === 'boolean') out.set(id as PersonId, on);
    return out;
}

/** The recipient's stepchildren: their partners' children not descending from them, and children recorded as step or foster. */
function stepchildrenOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const own = new Set(p.childIds.filter(ch => descentParentIds(data, ch).includes(id)));
    const out = new Set<PersonId>();
    for (const ch of p.childIds) if (!own.has(ch)) out.add(ch);
    for (const partner of partnersOf(data, id)) {
        for (const ch of data.persons[partner]?.childIds ?? []) if (!own.has(ch)) out.add(ch);
    }
    return [...out].filter(ch => !!data.persons[ch]);
}

/** The people of one recipient's cut at a depth (the one rule). */
function recipientCut(source: StromData | LineageIndex, id: PersonId, depth: GiftDepth, exceptions: Map<PersonId, boolean>): Set<PersonId> {
    const data = dataOf(source);
    const spec: FamilySpec = {
        personId: id, up: 'all', via: 'both', down: 'all', width: 'cousins', cousins: depth,
        spouses: 'spouses', siblingFamilies: exceptions,
    };
    const out = familySet(source, spec);
    // D5: the recipient's stepchildren and their families (not those of the ancestors' families).
    for (const step of stepchildrenOf(data, id)) {
        for (const x of familySet(source, { personId: step, up: 0, via: 'both', down: 'all', width: 'line', spouses: 'spouses' })) out.add(x);
    }
    return out;
}

/** The people of the gift (no placeholders); a couple's is the union of both. */
export function giftCutIds(source: StromData | LineageIndex, cut: GiftCut): Set<PersonId> {
    const data = dataOf(source);
    const exceptions = exceptionsOf(cut);
    const out = new Set<PersonId>();
    for (const r of cut.recipients) {
        if (!data.persons[r]) continue;
        for (const id of recipientCut(source, r, cut.depth, exceptions)) out.add(id);
    }
    return out;
}

/**
 * How many people each depth gives, with the same exceptions. The four cuts
 * share the one rule; the shallower ones are skipped when the tree has no
 * ancestors deep enough for them to differ.
 */
export function giftDepthCounts(source: StromData | LineageIndex, cut: GiftCut): Record<GiftDepth, number> {
    const data = dataOf(source);
    let deepest = 0;
    for (const r of cut.recipients) if (data.persons[r]) deepest = Math.max(deepest, ancestorGenerations(data, r).length);
    const out = {} as Record<GiftDepth, number>;
    const all = giftCutIds(source, { ...cut, depth: 'all' }).size;
    out.all = all;
    for (const d of [2, 1, 0] as const) {
        // Families of the siblings of ancestors at generation d+1 and above: none when there are none.
        out[d] = deepest <= d ? all : giftCutIds(source, { ...cut, depth: d }).size;
    }
    return out;
}

/** Whether a sibling of an ancestor at `generation` has their family in the cut. */
function branchIncluded(cut: GiftCut, siblingId: PersonId, generation: number): boolean {
    const on = cut.branches?.[siblingId];
    if (typeof on === 'boolean') return on;
    return cut.depth === 'all' || generation <= cut.depth;
}

/**
 * The siblings of the recipients' ancestors (generation 1 = siblings of the
 * parents), nearest generation first, by birth: each with the size of their
 * family and whether it is in the cut now.
 */
export function giftBranchCandidates(source: StromData | LineageIndex, cut: GiftCut): GiftBranch[] {
    const data = dataOf(source);
    const found = new Map<PersonId, { ancestorId: PersonId; generation: number }>();
    const line = new Set<PersonId>(cut.recipients);
    const gensByRecipient: PersonId[][][] = [];
    for (const r of cut.recipients) {
        if (!data.persons[r]) continue;
        const gens = ancestorGenerations(data, r);
        gensByRecipient.push(gens);
        for (const g of gens) for (const id of g) line.add(id);
    }
    for (const gens of gensByRecipient) {
        gens.forEach((ancestors, i) => {
            const generation = i + 1;
            for (const a of ancestors) {
                for (const sib of descentSiblingsOf(data, a)) {
                    const p = data.persons[sib];
                    if (!p || p.isPlaceholder || line.has(sib)) continue;
                    const prev = found.get(sib);
                    if (!prev || prev.generation > generation) found.set(sib, { ancestorId: a, generation });
                }
            }
        });
    }
    const out: GiftBranch[] = [];
    for (const [siblingId, { ancestorId, generation }] of found) {
        const partners = new Set(partnersOf(data, siblingId).filter(x => data.persons[x] && !data.persons[x].isPlaceholder));
        const family = familySet(source, { personId: siblingId, up: 0, via: 'both', down: 'all', width: 'line', spouses: 'spouses' });
        const mine = descentParentIds(data, siblingId);
        const theirs = descentParentIds(data, ancestorId);
        const other = mine.filter(x => !theirs.includes(x));
        const half = mine.some(x => theirs.includes(x)) && (other.length > 0 || theirs.some(x => !mine.includes(x)));
        out.push({
            siblingId, ancestorId, generation,
            aloneCount: 1 + partners.size,
            familyCount: family.size,
            included: branchIncluded(cut, siblingId, generation),
            half,
            otherParentId: half ? (other.find(x => !data.persons[x]?.isPlaceholder) ?? null) : null,
        });
    }
    const order = new Map(sortByBirth(data, out.map(b => b.siblingId)).map((id, i) => [id, i]));
    return out.sort((a, b) => a.generation - b.generation || order.get(a.siblingId)! - order.get(b.siblingId)!);
}

/**
 * The recipients' household, always shown in full: the recipients, their
 * partners (not those they divorced or separated from; for a couple only the
 * two) and the children of each recipient.
 */
export function giftHouseholdIds(data: StromData, recipients: readonly PersonId[]): Set<PersonId> {
    const out = new Set<PersonId>();
    const present = recipients.filter(r => !!data.persons[r]);
    for (const r of present) {
        out.add(r);
        const p = data.persons[r];
        if (present.length === 1) {
            for (const uid of p.partnerships) {
                const u = data.partnerships[uid];
                if (!u || u.status === 'divorced' || u.status === 'separated') continue;
                const other = u.person1Id === r ? u.person2Id : u.person1Id;
                if (other && data.persons[other]) out.add(other);
            }
        }
        for (const ch of p.childIds) if (data.persons[ch]) out.add(ch);
    }
    for (const id of out) if (data.persons[id]?.isPlaceholder) out.delete(id);
    return out;
}

// ==================== Data ====================

/** The cut as a tree of its own (without orphans, only the cited sources), opening on the first recipient. */
export function giftCutData(source: StromData | LineageIndex, cut: GiftCut): StromData {
    const data = dataOf(source);
    const out = extractSubtree(data, giftCutIds(source, cut));
    const first = cut.recipients.find(r => !!out.persons[r]);
    if (first) out.defaultPersonId = first;
    return out;
}

/**
 * The data every part of the package gets (D4): the cut with the living
 * protected once — the household and the exceptions in full with their
 * sensitive details masked, the other living by `others` (under 'full'
 * masked by their own set, a couple by the stricter one, K6.5), the deceased's
 * details by `dead` — without the research's workshop, and without any
 * images when `photos` is off. The outputs apply no protection of their own.
 */
export function giftProtectedData(
    source: StromData | LineageIndex, cut: GiftCut, privacy: GiftPrivacy,
    opts: { photos: boolean; currentYear?: number },
): StromData {
    const sub = giftCutData(source, cut);
    const fullIds = new Set<PersonId>([...giftHouseholdIds(sub, cut.recipients), ...privacy.fullIds]);
    let out = applyLivingPrivacy(sub, privacy.others, opts.currentYear ?? new Date().getFullYear(), {
        keepDeceasedSources: true, fullIds, sensitive: privacy.sensitive, dead: privacy.dead,
        ...(privacy.others === 'full' ? { othersSensitive: privacy.othersSensitive ?? defaultGiftOthersSensitive() } : {}),
    });
    out = stripResearchWork(out);
    if (!opts.photos) out = stripMedia(out);
    dropDanglingPortraitSources(out);
    return out;
}

/**
 * Whether the protection shortens anything of a living person in the cut (the
 * cover page's "some details of the living are shortened", §6): a living
 * person outside the household and the exceptions under a mode other than
 * 'full', or a living person shown in full while some kind of detail is masked
 * (under 'full', the other living by their own set, K6.5).
 */
export function giftShortensLiving(
    source: StromData | LineageIndex, cut: GiftCut, privacy: GiftPrivacy, currentYear: number = new Date().getFullYear(),
): boolean {
    const sub = giftCutData(source, cut);
    const bounds = inferBirthUpperBounds(sub);
    const full = new Set<PersonId>([...giftHouseholdIds(sub, cut.recipients), ...privacy.fullIds]);
    const hides = (s: GiftSensitive): boolean => Object.values(s).some(kept => !kept);
    const fullMasks = hides(privacy.sensitive);
    const othersMask = privacy.others === 'full' && hides(privacy.othersSensitive ?? defaultGiftOthersSensitive());
    for (const p of Object.values(sub.persons)) {
        if (p.isPlaceholder || !isLivingPerson(p, currentYear, bounds)) continue;
        if (full.has(p.id)) {
            if (fullMasks) return true;
        } else if (privacy.others !== 'full' || othersMask) return true;
    }
    return false;
}
