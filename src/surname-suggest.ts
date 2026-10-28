/**
 * Surname spellings suggested by the research (spec 021 K2.1–K2.6, ZADANI_DEV
 * §4): the reply of the research bridge's `GET <token>/surnames` read and
 * checked, and what the app shows of it — only suggestions that would change
 * something in this tree (not rejected, not inside one of its groups, never
 * joining two of its groups), how many people each one newly links, and its
 * reason as text. Pure: no DOM, no storage, no network (the bridge is in
 * surname-suggest-bridge.ts, the dialog in ui/surname-suggest-ui.ts).
 *
 * A suggestion's `id` is the research's own (opaque); the app never builds
 * one and matches its own decisions by the forms as well.
 */

import { cleanText } from './research-link.js';
import { surnameRejectionKey } from './quality-dismiss.js';
import { addSurnameGroup, czechRulesApply, masculineForm, sameSurname, surnameKey, surnamesInTree } from './surnames.js';
import type { StromData, SurnameRejection } from './types.js';

/** The bridge answers `GET /surnames`: the button "Suggest from the research". */
export const SURNAMES_SUGGEST_FEATURE = 'surnames.suggest';
/** The research reads the groups and the rejections in the file's header NOTEs. */
export const SURNAMES_READ_FEATURE = 'surnames.read';

/** The most suggestions read from one reply (the research sends at most 200). */
const MAX_SUGGESTIONS = 500;
const MAX_FORMS = 30;
const MAX_EVIDENCE = 20;
const MAX_LIST = 2000;

export type SuggestionLevel = 'documented' | 'rules';

export interface SuggestionEvidence {
    /** The research's person number (P…). */
    person: string;
    name: string;
    form: string;
    citation: string;
    /** The research's source number (S…). */
    source?: string;
    quote?: string;
}

export interface SurnameSuggestion {
    id: string;
    forms: string[];
    level: SuggestionLevel;
    /** The research's group this one extends (its forms). */
    extends?: string[];
    rule?: string;
    keys: string[];
    /** The research's own sentence for the reason (in its language). */
    text?: string;
    persons?: number;
    places: string[];
    from?: number;
    to?: number;
    evidence: SuggestionEvidence[];
    evidenceMore: number;
}

/** A group or a rejection as the research holds it. */
export interface SurnameDecision {
    id?: string;
    forms: string[];
    at?: string;
    by?: 'app' | 'research';
}

export interface SurnamesReply {
    rev: string;
    groups: SurnameDecision[];
    rejected: SurnameDecision[];
    suggestions: SurnameSuggestion[];
    truncated: boolean;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

function formsOf(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) return null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const f of raw.slice(0, MAX_FORMS)) {
        const s = cleanText(f, 80).normalize('NFC');
        if (!s || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        out.push(s);
    }
    return out.length >= 2 ? out : null;
}

const year = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 3000 ? v : undefined;

function decisionsOf(raw: unknown): SurnameDecision[] {
    if (!Array.isArray(raw)) return [];
    const out: SurnameDecision[] = [];
    for (const item of raw.slice(0, MAX_LIST)) {
        const r = asRecord(item);
        const forms = r ? formsOf(r.forms) : null;
        if (!r || !forms) continue;
        const d: SurnameDecision = { forms };
        const id = cleanText(r.id, 200);
        if (id) d.id = id;
        const at = cleanText(r.at, 40);
        if (at) d.at = at;
        if (r.by === 'app' || r.by === 'research') d.by = r.by;
        out.push(d);
    }
    return out;
}

function evidenceOf(raw: unknown): SuggestionEvidence[] {
    if (!Array.isArray(raw)) return [];
    const out: SuggestionEvidence[] = [];
    for (const item of raw.slice(0, MAX_EVIDENCE)) {
        const r = asRecord(item);
        if (!r) continue;
        const name = cleanText(r.name, 120);
        const form = cleanText(r.form, 80);
        if (!name || !form) continue;
        const e: SuggestionEvidence = {
            person: /^P\d{1,7}$/.test(String(r.person ?? '')) ? String(r.person) : '',
            name, form, citation: cleanText(r.citation, 300),
        };
        if (typeof r.source === 'string' && /^S\d{1,7}$/.test(r.source)) e.source = r.source;
        const quote = cleanText(r.quote, 220);
        if (quote) e.quote = quote;
        out.push(e);
    }
    return out;
}

function suggestionOf(raw: unknown): SurnameSuggestion | null {
    const r = asRecord(raw);
    if (!r) return null;
    const id = cleanText(r.id, 200);
    const forms = formsOf(r.forms);
    const level = r.level === 'documented' || r.level === 'rules' ? r.level : null;
    if (!id || !forms || !level) return null;
    const s: SurnameSuggestion = {
        id, forms, level,
        keys: Array.isArray(r.keys) ? r.keys.map(k => cleanText(k, 24)).filter(k => /^[a-z][a-z-]{0,23}$/.test(k)).slice(0, 12) : [],
        places: Array.isArray(r.places) ? r.places.map(p => cleanText(p, 80)).filter(Boolean).slice(0, 12) : [],
        evidence: level === 'documented' ? evidenceOf(r.evidence) : [],
        evidenceMore: typeof r.evidenceMore === 'number' && r.evidenceMore > 0 ? Math.min(Math.floor(r.evidenceMore), 99_999) : 0,
    };
    const ext = formsOf(r.extends);
    if (ext) s.extends = ext;
    const rule = cleanText(r.rule, 24);
    if (rule) s.rule = rule;
    const text = cleanText(r.text, 300);
    if (text) s.text = text;
    if (typeof r.persons === 'number' && r.persons >= 0) s.persons = Math.floor(r.persons);
    const from = year(r.from);
    const to = year(r.to);
    if (from !== undefined) s.from = from;
    if (to !== undefined && (from === undefined || to >= from)) s.to = to;
    return s;
}

/** The reply of `GET /surnames`, checked (untrusted), or null when it is not one. */
export function parseSurnamesReply(raw: unknown): SurnamesReply | null {
    const r = asRecord(raw);
    if (!r || !Array.isArray(r.suggestions)) return null;
    const suggestions: SurnameSuggestion[] = [];
    const ids = new Set<string>();
    for (const item of r.suggestions.slice(0, MAX_SUGGESTIONS)) {
        const s = suggestionOf(item);
        if (!s || ids.has(s.id)) continue;
        ids.add(s.id);
        suggestions.push(s);
    }
    const state = asRecord(r.state);
    return {
        rev: cleanText(r.rev, 128),
        groups: decisionsOf(r.groups),
        rejected: decisionsOf(r.rejected),
        suggestions,
        truncated: state?.truncated === true,
    };
}

// ==================== What the app shows ====================

/** A suggestion the app offers, with the tree's group it would extend. */
export interface ShownSuggestion {
    suggestion: SurnameSuggestion;
    /** The tree's group (its forms) this suggestion extends; null: a new group. */
    extendsGroup: string[] | null;
}

/** Is this suggestion's forms (or its id) one the tree or the research rejected? */
export function isRejected(s: Pick<SurnameSuggestion, 'id' | 'forms'>, treeRejections: readonly SurnameRejection[] | undefined,
    researchRejected: readonly SurnameDecision[] = []): boolean {
    const key = surnameRejectionKey(s.forms);
    return [...(treeRejections ?? []), ...researchRejected].some(r => (!!r.id && r.id === s.id) || surnameRejectionKey(r.forms) === key);
}

/**
 * The tree's group a suggestion touches: 'none' (a new group), the one group
 * it extends, 'inside' (all its forms are in one group already: nothing new)
 * or 'two' (it would join two groups of the tree — never offered, §4.5).
 */
export function suggestionGroup(forms: readonly string[], groups: readonly string[][] | undefined): 'none' | 'inside' | 'two' | string[] {
    const keys = forms.map(surnameKey);
    const touched = (groups ?? []).filter(g => g.some(n => keys.includes(surnameKey(n))));
    if (touched.length === 0) return 'none';
    if (touched.length > 1) return 'two';
    const inGroup = new Set(touched[0].map(surnameKey));
    return keys.every(k => inGroup.has(k)) ? 'inside' : touched[0];
}

/**
 * The suggestions to offer for this tree, documented first (the research's
 * order kept within a level): without the rejected ones (by id or forms, the
 * tree's and the research's), without those whose forms are all in one
 * group of the tree, and without those that would join two of its groups.
 */
export function visibleSuggestions(reply: Pick<SurnamesReply, 'suggestions' | 'rejected'>,
    data: Pick<StromData, 'surnameVariants' | 'surnameRejections'>): { documented: ShownSuggestion[]; rules: ShownSuggestion[] } {
    const documented: ShownSuggestion[] = [];
    const rules: ShownSuggestion[] = [];
    const seen = new Set<string>();
    for (const s of reply.suggestions) {
        const key = surnameRejectionKey(s.forms);
        if (seen.has(key)) continue;
        seen.add(key);
        if (isRejected(s, data.surnameRejections, reply.rejected)) continue;
        const g = suggestionGroup(s.forms, data.surnameVariants);
        if (g === 'inside' || g === 'two') continue;
        (s.level === 'documented' ? documented : rules).push({ suggestion: s, extendsGroup: g === 'none' ? null : g });
    }
    return { documented, rules };
}

/** Do the forms differ only in their diacritics (Lhoták / Lhotak)? */
export function isDiacriticsOnly(forms: readonly string[]): boolean {
    return forms.length >= 2 && new Set(forms.map(surnameKey)).size === 1;
}

const exact = (s: string): string => s.normalize('NFC').trim().toLowerCase();

const formCounts = new WeakMap<object, Map<string, number>>();

/**
 * How many people of the tree carry this very form as their surname (a
 * woman's form counted with the man's, where the Czech rules apply);
 * diacritics count here, unlike in search, so Lhoták and Lhotak each show
 * their own people.
 */
export function peopleWithForm(form: string, data: StromData): number {
    let counts = formCounts.get(data.persons);
    if (!counts) {
        counts = new Map();
        const rules = czechRulesApply(data);
        for (const p of Object.values(data.persons)) {
            const name = p.lastName?.trim();
            if (!name || p.isPlaceholder) continue;
            const keys = new Set([exact(name)]);
            const male = rules ? masculineForm(name) : null;
            if (male) keys.add(exact(male));
            for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        formCounts.set(data.persons, counts);
    }
    return counts.get(exact(form)) ?? 0;
}

/**
 * What accepting a suggestion links (§4.3): `main` is the form (or the
 * extended group's form) most people carry; `m` the people linked with it
 * today (the whole group when it extends one); `n` the people with the
 * suggestion's other forms who are not linked with it today and will be.
 */
export function newlyLinked(forms: readonly string[], extendsGroup: readonly string[] | null, data: StromData): { n: number; m: number; main: string } {
    const pool = extendsGroup ?? forms;
    let main = pool[0];
    let best = -1;
    for (const f of pool) {
        const c = peopleWithForm(f, data);
        if (c > best) { best = c; main = f; }
    }
    const after: StromData = { ...data, surnameVariants: addSurnameGroup(data, [...forms]) };
    let n = 0;
    let m = 0;
    for (const { surname, count } of surnamesInTree(data)) {
        if (sameSurname(surname, main, data)) m += count;
        else if (forms.some(f => sameSurname(surname, f, after))) n += count;
    }
    return { n, m, main };
}

// ==================== The reason as text ====================

/** The spelling keys the research uses, as shown (§4.6; the same in every language). */
const KEY_LABELS: Readonly<Record<string, string>> = {
    'w-v': 'w ↔ v', 'y-i': 'y ↔ i', 'ch-h': 'ch ↔ h', 'sch-s': 'sch ↔ š', 'cz-c': 'cz ↔ č',
    'sz-s': 'sz ↔ š', 'ck-k': 'ck ↔ k', 'th-t': 'th ↔ t', 'ph-f': 'ph ↔ f', 'ie-i': 'ie ↔ í',
};

export interface ReasonTexts {
    samePerson: string;
    spelling: (keys: string) => string;
    double: string;
    diacritics: string;
}

/**
 * The reason of a suggestion (§4.6): same-person, phonetic ("{keys} · {place}
 * {from}–{to}") or spelling ("different spelling: {keys}"); several keys
 * joined with a comma. A rule or a key the app does not know: the research's
 * own `text` (empty when it has none).
 */
export function reasonText(s: Pick<SurnameSuggestion, 'rule' | 'keys' | 'text' | 'places' | 'from' | 'to'>, t: ReasonTexts): string {
    const label = (k: string): string | null =>
        KEY_LABELS[k] ?? (k === 'double' ? t.double : k === 'diacritics' ? t.diacritics : null);
    const labels = s.keys.map(label);
    const known = labels.every((l): l is string => l !== null);
    const keys = known ? (labels as string[]).join(', ') : '';
    const span = s.from !== undefined ? (s.to !== undefined && s.to !== s.from ? `${s.from}–${s.to}` : String(s.from)) : '';
    switch (s.rule) {
        case 'same-person':
            return t.samePerson;
        case 'phonetic': {
            if (!known || !keys) return s.text ?? '';
            const where = [s.places[0] ?? '', span].filter(Boolean).join(' ');
            return where ? `${keys} · ${where}` : keys;
        }
        case 'spelling':
            if (!known || !keys) return s.text ?? '';
            // "Only the diacritics differ" says it all; no "different spelling:" before it.
            return s.keys.length === 1 && s.keys[0] === 'diacritics' ? t.diacritics : t.spelling(keys);
        default:
            return s.text ?? '';
    }
}

/** One string for a set of forms, order, case and diacritics aside (the app's own groups and the research's). */
export function formsKey(forms: readonly string[]): string {
    return JSON.stringify([...new Set(forms.map(surnameKey))].sort());
}

/**
 * Was this group of the tree (or this rejection) decided in the research
 * (`by: "research"` in its reply), matched by the forms?
 */
export function decidedInResearch(forms: readonly string[], research: readonly SurnameDecision[]): boolean {
    const key = surnameRejectionKey(forms);
    return research.some(d => d.by === 'research' && surnameRejectionKey(d.forms) === key);
}
