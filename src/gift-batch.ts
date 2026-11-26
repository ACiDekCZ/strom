/**
 * Give a family tree to each person of a list or of the window's selection
 * (spec 093 §7 [53, 54]) without the DOM: the recipients' rows (partners of
 * the list joined into one package on request), each row's own settings over
 * the common ones (a Partial kept by the person, "Back to common" drops it),
 * the salutation of each row and the items buildGiftBatch makes.
 */

import type { Person, PersonId, StromData } from './types.js';
import type { GiftCut, GiftLang, GiftLetter, GiftParts, GiftPrivacy, GiftSettings } from './gift-tree.js';
import { giftPersonKey } from './gift-memory.js';
import { giftDefaultSalutation } from './gift-cover.js';
import { giftHasFamily, giftResolvedSettings } from './gift-guide.js';
import type { GiftBatchItem } from './gift-package.js';

/** One package of the batch: a person, or a couple of the list. */
export interface GiftRecipientRow {
    /** giftPersonKey of the recipients (the order of a couple does not matter). */
    key: string;
    recipients: PersonId[];
    /** A single person with no parents, partner or children in the tree: nothing to make. */
    lone: boolean;
}

/** What one row changes over the common settings (§7 [54]); the recipients and the salutation are the row's own anyway. */
export interface GiftOwnSettings {
    cut?: Partial<Omit<GiftCut, 'recipients'>>;
    privacy?: Partial<GiftPrivacy>;
    parts?: Partial<GiftParts>;
    photos?: boolean;
    letter?: Partial<Omit<GiftLetter, 'salutation'>>;
}

/** The parts of the settings a row can have its own: the guide's steps 2–5. */
export type GiftOwnPart = 'cut' | 'privacy' | 'parts' | 'letter';

function realPartnerIds(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out: PersonId[] = [];
    // The last partnership first (the partner a couple is suggested from, §7).
    for (let i = p.partnerships.length - 1; i >= 0; i--) {
        const u = data.partnerships[p.partnerships[i]];
        const other = u ? (u.person1Id === id ? u.person2Id : u.person1Id) : null;
        if (other && data.persons[other] && !data.persons[other].isPlaceholder) out.push(other);
    }
    return out;
}

/**
 * The rows of a list of people in its order: with `pairs`, a person and a
 * partner of theirs who is in the list too make one row (the first one met
 * leads); placeholders and people not in the tree are left out.
 */
export function giftBatchRows(data: StromData, ids: readonly PersonId[], pairs: boolean): GiftRecipientRow[] {
    const listed = new Set<PersonId>();
    const order: PersonId[] = [];
    for (const id of ids) {
        const p = data.persons[id];
        if (!p || p.isPlaceholder || listed.has(id)) continue;
        listed.add(id);
        order.push(id);
    }
    const used = new Set<PersonId>();
    const rows: GiftRecipientRow[] = [];
    for (const id of order) {
        if (used.has(id)) continue;
        used.add(id);
        const partner = pairs ? realPartnerIds(data, id).find(o => listed.has(o) && !used.has(o)) : undefined;
        if (partner) {
            used.add(partner);
            rows.push({ key: giftPersonKey([id, partner]), recipients: [id, partner], lone: false });
        } else {
            rows.push({ key: giftPersonKey([id]), recipients: [id], lone: !giftHasFamily(data, id) });
        }
    }
    return rows;
}

/** The salutation a row starts with in the letter's language (a couple joined by its "and"). */
export function giftBatchDefaultSalutation(data: StromData, row: Pick<GiftRecipientRow, 'recipients'>, lang: GiftLang): string {
    const persons = row.recipients.map(id => data.persons[id]).filter((p): p is Person => !!p);
    if (!persons.length) return '';
    return giftDefaultSalutation(persons.length === 1 ? persons[0] : persons, lang);
}

/** A row's settings: the common ones with its own over them, its recipients and its salutation. */
export function giftMergeOwn(common: GiftSettings, own: GiftOwnSettings | undefined, recipients: readonly PersonId[], salutation: string): GiftSettings {
    const o = own ?? {};
    return {
        ...common,
        cut: { ...common.cut, ...o.cut, branches: { ...(o.cut?.branches ?? common.cut.branches) }, recipients: [...recipients] },
        privacy: { ...common.privacy, ...o.privacy },
        parts: { ...common.parts, ...o.parts },
        photos: o.photos ?? common.photos,
        letter: { ...common.letter, ...o.letter, salutation },
        // Each package of a batch is named from its recipients.
        fileName: undefined,
    };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What `edited` changes over `common` (the recipients, the salutation and the file name aside); null when nothing. */
export function giftOwnDiff(common: GiftSettings, edited: GiftSettings): GiftOwnSettings | null {
    const out: GiftOwnSettings = {};
    const cut: Partial<Omit<GiftCut, 'recipients'>> = {};
    if (edited.cut.depth !== common.cut.depth) cut.depth = edited.cut.depth;
    if (!same(edited.cut.branches, common.cut.branches)) cut.branches = { ...edited.cut.branches };
    if (Object.keys(cut).length) out.cut = cut;
    const privacy: Partial<GiftPrivacy> = {};
    for (const k of Object.keys(edited.privacy) as (keyof GiftPrivacy)[]) {
        if (!same(edited.privacy[k], common.privacy[k])) (privacy as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(edited.privacy[k]));
    }
    if (Object.keys(privacy).length) out.privacy = privacy;
    const parts: Partial<GiftParts> = {};
    for (const k of Object.keys(edited.parts) as (keyof GiftParts)[]) if (edited.parts[k] !== common.parts[k]) parts[k] = edited.parts[k];
    if (Object.keys(parts).length) out.parts = parts;
    if (edited.photos !== common.photos) out.photos = edited.photos;
    const letter: Partial<Omit<GiftLetter, 'salutation'>> = {};
    for (const k of ['lang', 'motif', 'message', 'signature', 'date'] as const) {
        if (edited.letter[k] !== common.letter[k]) (letter as Record<string, unknown>)[k] = edited.letter[k];
    }
    if (Object.keys(letter).length) out.letter = letter;
    return Object.keys(out).length ? out : null;
}

/** The steps a row's own settings touch, in the guide's order ("own: the cut"). */
export function giftOwnParts(own: GiftOwnSettings | undefined): GiftOwnPart[] {
    if (!own) return [];
    const out: GiftOwnPart[] = [];
    if (own.cut) out.push('cut');
    if (own.privacy) out.push('privacy');
    if (own.parts || own.photos !== undefined) out.push('parts');
    if (own.letter) out.push('letter');
    return out;
}

export interface GiftBatchPlan {
    rows: GiftRecipientRow[];
    /** Rows left out with × (the list itself does not change). */
    removed: ReadonlySet<string>;
    own: ReadonlyMap<string, GiftOwnSettings>;
    /** Salutations typed in the table; the others follow the letter's language. */
    salutations: ReadonlyMap<string, string>;
}

/** The rows a package is made for: not removed, not alone in the tree. */
export function giftBatchActive(plan: Pick<GiftBatchPlan, 'rows' | 'removed'>): GiftRecipientRow[] {
    return plan.rows.filter(r => !r.lone && !plan.removed.has(r.key));
}

/** A row's salutation: typed in its line, else the default in the letter's language of its settings. */
export function giftBatchSalutation(data: StromData, plan: Pick<GiftBatchPlan, 'salutations' | 'own'>, common: GiftSettings, row: GiftRecipientRow): string {
    const typed = plan.salutations.get(row.key);
    if (typed !== undefined) return typed;
    const lang = plan.own.get(row.key)?.letter?.lang ?? common.letter.lang;
    return giftBatchDefaultSalutation(data, row, lang);
}

/** A row's settings as its package is made from them (own over common, the letter resolved). */
export function giftBatchRowSettings(data: StromData, plan: GiftBatchPlan, common: GiftSettings, row: GiftRecipientRow): GiftSettings {
    return giftMergeOwn(common, plan.own.get(row.key), row.recipients, giftBatchSalutation(data, plan, common, row));
}

/** The items buildGiftBatch makes: one per active row, the letter resolved for its cut. */
export function giftBatchItems(data: StromData, plan: GiftBatchPlan, common: GiftSettings): GiftBatchItem[] {
    return giftBatchActive(plan).map(row => ({ settings: giftResolvedSettings(data, giftBatchRowSettings(data, plan, common, row)) }));
}
