/**
 * The "Give a family tree" guide's state without the DOM (spec 093 §2, §4,
 * §9): who the package is for (one person, a couple, a list), its settings,
 * the step shown and the steps done, what was remembered from last time,
 * the summary of the cut and step 3's rows of the living. The window
 * (src/ui/gift-tree-ui.ts) draws from it and calls these to change it.
 */

import type { Person, PersonId, StromData } from './types.js';
import type { LineageIndex } from './lineage.js';
import { applyLivingPrivacy, inferBirthUpperBounds, isLivingPerson, type PrivacyMode } from './privacy.js';
import {
    GIFT_DEPTHS, giftCutData, giftCutIds, giftHouseholdIds,
    type GiftLang, type GiftLetter, type GiftMemory, type GiftSettings,
} from './gift-tree.js';
import { defaultGiftSettings, giftPersonKey, loadGiftMemory, saveGiftMemory } from './gift-memory.js';
import { giftDefaultSalutation } from './gift-cover.js';
import { estimateGiftSize } from './gift-package.js';
import { computeFamilyStats } from './stats.js';
import { findRelationship } from './kinship.js';
import { yearOf } from './dates.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The guide's six steps (1 For whom … 6 Preview and create). */
export const GIFT_GUIDE_STEPS = 6;

export type GiftMode = 'single' | 'pair' | 'list';

export interface GiftState {
    treeId: string | null;
    mode: GiftMode;
    /** One person, or two for a couple (the second may still be missing: null). */
    recipients: Array<PersonId | null>;
    settings: GiftSettings;
    /** The step shown, 1–6. */
    step: number;
    /** The steps passed (✓ in the side tabs). */
    done: Set<number>;
    /** What this person or couple had last time, when the guide started from it (§9 [65]). */
    memory: GiftMemory | null;
}

/** Whether a person has anyone in the tree to make a family tree of: parents, a partner or children (§1 canGiftTree). */
export function giftHasFamily(data: StromData, id: PersonId | null | undefined): boolean {
    const p = id ? data.persons[id] : undefined;
    if (!p || p.isPlaceholder) return false;
    const real = (x: PersonId): boolean => !!data.persons[x] && !data.persons[x].isPlaceholder;
    return p.parentIds.some(real) || p.childIds.some(real)
        || p.partnerships.some(uid => {
            const u = data.partnerships[uid];
            if (!u) return false;
            const other = u.person1Id === id ? u.person2Id : u.person1Id;
            return !!other && real(other);
        });
}

/** The partner a couple's second person is suggested from: the person's last partner in the tree (§7), or null. */
export function giftSuggestedPartner(data: StromData, id: PersonId): PersonId | null {
    const p = data.persons[id];
    if (!p) return null;
    for (let i = p.partnerships.length - 1; i >= 0; i--) {
        const u = data.partnerships[p.partnerships[i]];
        const other = u ? (u.person1Id === id ? u.person2Id : u.person1Id) : null;
        if (other && data.persons[other] && !data.persons[other].isPlaceholder) return other;
    }
    return null;
}

/** The chosen recipients (a couple's missing second person left out). */
export function giftRecipients(state: Pick<GiftState, 'recipients'>): PersonId[] {
    return state.recipients.filter((x): x is PersonId => !!x);
}

/** Today as an ISO date (local). */
export function giftIsoDate(now: Date): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface GiftStartOptions {
    data: StromData;
    treeId: string | null;
    mode: GiftMode;
    recipients: Array<PersonId | null>;
    /** The letter's language (the app's) and the signature (the last sender of "Send to family"). */
    lang: GiftLang;
    signature: string;
    now: Date;
    storage?: StorageLike | null;
}

/**
 * The letter a new package starts with: no motif, today's date, the default
 * salutation; the message empty = the template (made for the cut when the
 * letter is shown or the package made, so its numbers follow the cut).
 */
export function giftDefaultLetter(data: StromData, recipients: readonly PersonId[], lang: GiftLang, signature: string, now: Date): GiftLetter {
    const persons = recipients.map(id => data.persons[id]).filter((p): p is Person => !!p);
    return {
        lang, motif: 'none',
        salutation: persons.length ? giftDefaultSalutation(persons.length === 1 ? persons[0] : persons, lang) : '',
        message: '', signature, date: giftIsoDate(now),
    };
}

/**
 * The guide's state for a person or couple: from what was remembered for
 * them (§9: every step ✓, the letter's date today again), else the defaults.
 */
export function giftGuideStart(o: GiftStartOptions): GiftState {
    const chosen = o.recipients.filter((x): x is PersonId => !!x);
    const complete = o.mode !== 'pair' || chosen.length === 2;
    const memory = complete && chosen.length && o.mode !== 'list'
        ? loadGiftMemory(o.treeId, giftPersonKey(chosen), o.storage)
        : null;
    if (memory) {
        const settings: GiftSettings = {
            ...memory.settings,
            cut: { ...memory.settings.cut, recipients: [...chosen] },
            letter: { ...memory.settings.letter, date: giftIsoDate(o.now) },
        };
        const done = new Set<number>();
        for (let i = 1; i <= GIFT_GUIDE_STEPS; i++) done.add(i);
        return { treeId: o.treeId, mode: o.mode, recipients: [...o.recipients], settings, step: 1, done, memory };
    }
    const settings = defaultGiftSettings(chosen, giftDefaultLetter(o.data, chosen, o.lang, o.signature, o.now));
    return { treeId: o.treeId, mode: o.mode, recipients: [...o.recipients], settings, step: 1, done: new Set(), memory: null };
}

/**
 * Show step `to`. Going forward counts every step before it as done (a
 * skipped step keeps its defaults: "Straight to preview" accepts them all).
 */
export function giftGoTo(state: GiftState, to: number): void {
    const step = Math.min(GIFT_GUIDE_STEPS, Math.max(1, Math.round(to)));
    if (step > state.step) for (let i = 1; i < step; i++) state.done.add(i);
    state.step = step;
}

/** Whether the guide can go on from step 1: the recipients chosen (a couple both, two people) and with a family. */
export function giftCanProceed(state: GiftState, data: StromData): boolean {
    const chosen = giftRecipients(state);
    if (state.mode === 'pair') {
        if (chosen.length !== 2 || chosen[0] === chosen[1]) return false;
        return chosen.some(id => giftHasFamily(data, id)) || giftHasFamilyTogether(data, chosen[0], chosen[1]);
    }
    return chosen.length === 1 && giftHasFamily(data, chosen[0]);
}

function giftHasFamilyTogether(data: StromData, a: PersonId, b: PersonId): boolean {
    return (data.persons[a]?.partnerships ?? []).some(uid => {
        const u = data.partnerships[uid];
        return !!u && (u.person1Id === b || u.person2Id === b);
    });
}

/**
 * Remember the settings for this person or couple (§9: on close and on
 * create). `made`: a package was made now (the person menu's date).
 */
export function giftRemember(state: GiftState, cutSize: number, now: Date, opts: { made?: boolean; storage?: StorageLike | null } = {}): GiftMemory | null {
    const chosen = giftRecipients(state);
    if (state.mode === 'list' || !chosen.length || (state.mode === 'pair' && chosen.length !== 2)) return null;
    const at = now.toISOString();
    const madeAt = opts.made ? at : state.memory?.madeAt;
    const memory: GiftMemory = {
        lastAt: at,
        ...(madeAt ? { madeAt } : {}),
        settings: { ...state.settings, cut: { ...state.settings.cut, recipients: [...chosen] } },
        cutSize,
    };
    saveGiftMemory(state.treeId, giftPersonKey(chosen), memory, opts.storage);
    return memory;
}

/** The index of a depth in GIFT_DEPTHS (the texts by depth). */
export function giftDepthIndex(depth: GiftSettings['cut']['depth']): number {
    return Math.max(0, GIFT_DEPTHS.indexOf(depth));
}

// ==================== Summary ====================

export interface GiftSummary {
    persons: number;
    generations: number;
    living: number;
    /** The package's estimated size in bytes (after compression). */
    bytes: number;
}

/** The living of a tree (placeholders out), decided as the protection decides it. */
export function giftLivingIds(data: StromData, currentYear: number): Set<PersonId> {
    const bounds = inferBirthUpperBounds(data);
    const out = new Set<PersonId>();
    for (const p of Object.values(data.persons)) if (!p.isPlaceholder && isLivingPerson(p, currentYear, bounds)) out.add(p.id);
    return out;
}

/** The side's summary (§2): people and generations of the cut, its living, the package's size. */
export function giftSummary(source: StromData | LineageIndex, settings: GiftSettings, now: Date, appProgramBytes?: number): GiftSummary {
    const cut = giftCutData(source, settings.cut);
    const ids = giftCutIds(source, settings.cut);
    const size = estimateGiftSize(source, settings, { now, ...(appProgramBytes ? { appProgramBytes } : {}) });
    return {
        persons: ids.size,
        generations: computeFamilyStats(cut).generations,
        living: [...giftLivingIds(cut, now.getFullYear())].filter(id => ids.has(id)).length,
        bytes: size.total,
    };
}

// ==================== Step 3: the living ====================

export interface GiftLivingRow {
    id: PersonId;
    /** The person as in the tree. */
    name: string;
    female: boolean;
    /** The recipient's household: always in full, the box locked. */
    household: boolean;
    /** A recipient (the relation reads "recipient"). */
    recipient: boolean;
    /** How the person is related to the recipient (the app's language), '' when not found. */
    relation: string;
    /** What the package shows of them when not in full ("S. W., 1948"). */
    shortened: string;
}

export interface GiftLivingModel {
    /** The household first (recipients, partners, children), then by nearness of kin, birth, name. */
    rows: GiftLivingRow[];
    /** People in the cut. */
    persons: number;
}

/**
 * Step 3's list (§4): the living of the cut with their relation to the
 * recipient and what the other living's protection makes of them, read from
 * applyLivingPrivacy itself (the same form the package will carry).
 */
export function giftLivingModel(
    source: StromData | LineageIndex, settings: GiftSettings, lang: GiftLang, currentYear: number,
    nameOf: (p: Person) => string,
): GiftLivingModel {
    const cut = giftCutData(source, settings.cut);
    const ids = giftCutIds(source, settings.cut);
    const recipients = settings.cut.recipients.filter(r => !!cut.persons[r]);
    const living = [...giftLivingIds(cut, currentYear)].filter(id => ids.has(id));
    const household = giftHouseholdIds(cut, recipients);
    const mode: PrivacyMode = settings.privacy.others === 'full' ? 'initials' : settings.privacy.others;
    const shortenedData = applyLivingPrivacy(cut, mode, currentYear, { keepDeceasedSources: true });
    const near = new Map<PersonId, { rel: string; dist: number }>();
    for (const id of living) {
        let best: { rel: string; dist: number } = { rel: '', dist: Number.MAX_SAFE_INTEGER };
        for (const r of recipients) {
            if (r === id) { best = { rel: '', dist: 0 }; break; }
            const k = findRelationship(cut, r, id);
            if (k && k.path.length < best.dist) best = { rel: k.term[lang] ?? '', dist: k.path.length };
        }
        near.set(id, best);
    }
    const rows: GiftLivingRow[] = living.map(id => {
        const p = cut.persons[id];
        const s = shortenedData.persons[id];
        const shortName = s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : '';
        const year = s ? yearOf(s.birthDate) : null;
        return {
            id, name: nameOf(p), female: p.gender === 'female',
            household: household.has(id), recipient: recipients.includes(id),
            relation: near.get(id)?.rel ?? '',
            shortened: year !== null ? `${shortName}, ${year}` : shortName,
        };
    });
    const birth = (id: PersonId): number => yearOf(cut.persons[id]?.birthDate) ?? 9999;
    const isPartner = (id: PersonId): boolean => recipients.some(x => (cut.persons[x]?.partnerships ?? []).some(uid => {
        const u = cut.partnerships[uid];
        return !!u && (u.person1Id === id || u.person2Id === id);
    }));
    // Recipients, their partners, their children, then everyone else.
    const rank = (r: GiftLivingRow): number => {
        if (r.recipient) return recipients.indexOf(r.id);
        if (!r.household) return 10;
        return isPartner(r.id) ? 2 : 3;
    };
    rows.sort((a, b) => rank(a) - rank(b)
        || (a.household ? 0 : (near.get(a.id)!.dist - near.get(b.id)!.dist))
        || birth(a.id) - birth(b.id)
        || a.name.localeCompare(b.name, lang));
    return { rows, persons: ids.size };
}

/** Who of the living is shown in full: the household and the exceptions, or everyone under 'full'. */
export function giftFullSet(model: GiftLivingModel, settings: GiftSettings): Set<PersonId> {
    if (settings.privacy.others === 'full') return new Set(model.rows.map(r => r.id));
    const extra = new Set(settings.privacy.fullIds);
    return new Set(model.rows.filter(r => r.household || extra.has(r.id)).map(r => r.id));
}

/** Toggle a living person's exception "in full" (the household stays locked). */
export function giftToggleFull(settings: GiftSettings, id: PersonId, on: boolean): void {
    const ids = settings.privacy.fullIds.filter(x => x !== id);
    if (on) ids.push(id);
    settings.privacy = { ...settings.privacy, fullIds: ids };
}
