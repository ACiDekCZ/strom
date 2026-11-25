/**
 * The gift package's cover page "Start here.html" (spec 093 §6) and the cover
 * letter's templates. The page is one HTML file without any script: the
 * sender's message, the parts of the package as cards with relative links,
 * the family tree in numbers and a footer. Every figure is taken from the data
 * the package's parts got (the cut with the living protected once), and every
 * text is in the letter's language, not the app's.
 */

import type { Gender, Person, PersonId, StromData } from './types.js';
import type { LineageIndex } from './lineage.js';
import { ancestorGenerations, buildLineages, descentParentIds, isMarriedInOnly, rodLabels, rods } from './lineage.js';
import { founderPlace, rodLivingCount, romanNumeral } from './rods-overview.js';
import { computeCompleteness, computeFamilyStats } from './stats.js';
import { assignGenerations } from './generations.js';
import { formatFlexDate, parseFlexDate, yearOf } from './dates.js';
import { formatTreeSize } from './format.js';
import { inferBirthUpperBounds, isLivingPerson } from './privacy.js';
import { shownName } from './person-name.js';
import { getStringsForLang, joinAnd, type GiftTemplateFacts } from './strings.js';
import { giftCutData, type GiftCut, type GiftLang, type GiftLetter } from './gift-tree.js';
import type { GiftCoverFile, GiftCoverInfo } from './gift-package.js';
import { FAMILY_PAGES_CSS } from './family-pages-css.js';
import { FONT_STACKS, PERSON_PAGE_LIGHT_TOKENS } from './person-page-css.js';
import { PERSON_PAGE_VIZ_LIGHT_TOKENS } from './person-page-viz-css.js';

/** The cover page's own rules (the design's `.gl-*`), on the family pages' tokens. */
export const GIFT_COVER_CSS = `html, body { margin: 0; background: var(--surface); color: var(--text); }
body { font-family: var(--font-sans); font-size: 15px; line-height: 1.5; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
.gl-page { position: relative; overflow: hidden; min-height: 100vh; }
.gl-file { position: relative; box-sizing: border-box; max-width: 960px; margin: 0 auto; padding: 28px 40px 40px; display: flex; flex-direction: column; gap: 32px; }
.gl-who { display: flex; align-items: center; gap: 18px; }
.gl-who-t { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.gl-av { flex: none; width: 76px; height: 76px; border-radius: 50%; object-fit: cover; background: var(--surface-2); border: 2px solid var(--sp-frame); }
.gl-msg { display: flex; flex-direction: column; gap: 12px; max-width: 660px; }
.gl-msg-t { margin: 0; font-family: var(--font-serif); font-size: 19px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); }
.gl-sig { margin: 0; font-size: 14px; color: var(--text-light); }
.gl-sig b { font-family: var(--font-serif); font-size: 17px; color: var(--text); font-weight: 600; margin-right: 8px; }
.gl-unzip { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-light); max-width: 720px; }
.gl-sec { display: flex; flex-direction: column; gap: 12px; }
.gl-lead { font-size: 14.5px; }
.gl-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; }
.gl-card.gl-main { border-color: var(--sp-frame); }
.gl-card .sp-card-go { margin-top: auto; }
.gl-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.gl-fan { display: block; margin: 2px 0; max-width: 100%; height: auto; }
.gl-h3 { margin: 0 0 4px; font-family: var(--font-serif); font-size: 16px; font-weight: 600; }
.gl-chart .sp-bar-row { grid-template-columns: 34px minmax(0, 1fr) 34px; }
.gl-chart .sp-bar-n { font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; }
.gl-fnote { margin-top: 4px; font-size: 12.5px; color: var(--text-faint); }
.gl-fn { color: var(--text-faint); overflow-wrap: anywhere; }
.gl-print { display: none; }
.gl-band { position: absolute; left: 0; right: 0; top: 0; height: 210px; background: var(--tint); }
.gl-twig { position: absolute; top: 6px; right: 18px; }
.gl-xmas .gl-file { padding-top: 40px; }
.gl-xmas .gl-head { min-height: 150px; }
.gl-orn { display: flex; align-items: center; gap: 10px; color: var(--rod-bar); }
.gl-orn i { flex: 1; height: 1px; background: var(--sp-frame); }
@media (hover: hover) {
  a.gl-card:hover { border-color: var(--sp-frame); background: var(--hover-bg); }
}
@media (max-width: 1024px) {
  .gl-file { padding: 24px 28px 36px; }
}
@media (max-width: 640px) {
  .gl-file { padding: 20px 16px 28px; gap: 26px; }
  .gl-file .sp-h1 { font-size: 30px; }
  .gl-av { width: 56px; height: 56px; }
  .gl-who { gap: 14px; }
  .gl-msg-t { font-size: 17px; }
  .gl-file .sp-cards { grid-template-columns: minmax(0, 1fr); }
  .gl-file .sp-card { padding: 14px 16px; }
  .gl-file .sp-card-t { font-size: 19px; }
  .gl-two { grid-template-columns: minmax(0, 1fr); gap: 22px; }
  .gl-file .sp-facts { grid-template-columns: 110px minmax(0, 1fr); gap: 6px 12px; font-size: 14px; }
  .gl-file .sp-facts dd { margin-bottom: 0; }
  .gl-band { height: 170px; }
  .gl-twig { right: -4px; top: 0; transform: scale(.45); transform-origin: 100% 0; }
  .gl-xmas .gl-file { padding-top: 28px; }
  .gl-xmas .gl-head { min-height: 120px; }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .gl-file { padding: 16px 24px 28px; gap: 24px; }
  .gl-file .sp-h1 { font-size: 28px; }
  .gl-msg-t { font-size: 17px; }
  .gl-band { height: 150px; }
  .gl-twig { top: 0; right: 0; transform: scale(.5); transform-origin: 100% 0; }
  .gl-xmas .gl-head { min-height: 110px; }
}
@media print {
  @page { size: A4; margin: 15mm; }
  .gl-page { min-height: 0; overflow: visible; }
  .gl-file { display: block; max-width: none; padding: 0; }
  .gl-xmas .gl-file { padding-top: 0; }
  .gl-file > * + * { margin-top: 24px; }
  .gl-screen, .gl-band, .gl-orn { display: none !important; }
  .gl-print { display: flex; }
  .gl-page2 { break-before: page; }
  .gl-file .sp-h1 { font-size: 34px; }
  .gl-msg-t { font-size: 16.5px; }
  .gl-two { display: block; }
  .gl-twig { top: -8mm; right: -6mm; transform: scale(.6); transform-origin: 100% 0; }
  .gl-xmas .gl-head { min-height: 0; padding-right: 150px; }
  .gl-sec, .sp-toc-row, .gl-chart { break-inside: avoid; }
  .gl-file .sp-foot { margin-top: 28px; }
  .gl-file a { color: inherit; text-decoration: none; }
}
`;

/** The Christmas twig of the design (300 × 190): a branch, needles, three baubles and a star. */
const TWIG_NEEDLES = 'M270 28 l-6 -20 M262 31 l8 20 M246 38 l-8 -20 M238 42 l10 18 M222 50 l-8 -21 M212 56 l10 19 '
    + 'M196 66 l-9 -20 M186 73 l11 18 M170 84 l-10 -19 M160 92 l11 18 M144 103 l-10 -18 M133 112 l11 17 '
    + 'M118 122 l-10 -16 M108 130 l10 15';
const TWIG_SVG = '<svg class="gl-twig" width="300" height="190" viewBox="0 0 300 190" fill="none" stroke-linecap="round" aria-hidden="true">'
    + '<path d="M290 20 C230 40 170 70 96 140" stroke="var(--rod-bar)" stroke-width="3"/>'
    + `<path d="${TWIG_NEEDLES}" stroke="var(--rod-bar)" stroke-width="2"/>`
    + '<circle cx="150" cy="122" r="6" fill="var(--accent)"/>'
    + '<circle cx="163" cy="128" r="5" fill="var(--accent)" opacity=".8"/>'
    + '<circle cx="156" cy="137" r="4.5" fill="var(--accent)" opacity=".65"/>'
    + '<path d="M62 52 l5 11 12 1.5 -9 8 2.5 12 -10.5 -6 -10.5 6 2.5 -12 -9 -8 12 -1.5z" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/>'
    + '</svg>';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A path below the folder as a relative link: each folder and file name escaped for a URL. */
function hrefOf(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}

/** The first part of a place ("Voss, Norway" → "Voss"). */
function placeHead(place: string | null | undefined): string {
    return (place ?? '').split(',')[0].trim();
}

/** Today as an ISO date in local time. */
function isoDay(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ==================== The facts of the cut ====================

/** The oldest ancestor of the recipients. */
export interface GiftOldest {
    id: PersonId;
    name: string;
    year: number | null;
    /** The year is a guess ("about 1798"): a qualified date, a range or a period. */
    approx: boolean;
    place: string | null;
}

/** What the cover page and the letter's template say about the cut. */
export interface GiftFacts {
    persons: number;
    generations: number;
    /** Earliest birth year in the data. */
    firstYear: number | null;
    /** Years from the earliest birth to `now`. */
    years: number | null;
    /** Whether any recipient has an ancestor in the data. */
    ancestors: boolean;
    oldest: GiftOldest | null;
    /** The lineages' names, largest first. */
    rods: string[];
    /** Places of birth (their first part), the earliest first. */
    places: string[];
    /** The places of the line from the oldest ancestor down to the first recipient. */
    journey: string[];
    /** The earliest record with an exact date. */
    oldestRecord: { label: string; name: string; place: string | null; year: number } | null;
    /** People by generation, the oldest first. */
    byGeneration: number[];
}

function oldestAncestor(data: StromData, recipients: readonly PersonId[]): { ancestors: boolean; oldest: GiftOldest | null } {
    let ancestors = false;
    let best: { p: Person; year: number | null; depth: number } | null = null;
    for (const r of recipients) {
        if (!data.persons[r]) continue;
        ancestorGenerations(data, r).forEach((ids, depth) => {
            for (const id of ids) {
                const p = data.persons[id];
                if (!p || p.isPlaceholder) continue;
                ancestors = true;
                const year = yearOf(p.birthDate);
                const better = !best
                    || (year !== null && (best.year === null || year < best.year || (year === best.year && depth > best.depth)))
                    || (year === null && best.year === null && depth > best.depth);
                if (better) best = { p, year, depth };
            }
        });
    }
    if (!best) return { ancestors, oldest: null };
    const { p, year } = best as { p: Person; year: number | null; depth: number };
    const d = parseFlexDate(p.birthDate);
    const approx = !!d && (d.qualifier !== '' || !!d.end || !!d.period);
    return { ancestors, oldest: { id: p.id, name: shownName(p) || '?', year, approx, place: founderPlace(p) } };
}

/** The line of parents from `top` down to `start` (both included), or [] when `top` is not an ancestor. */
function lineDown(data: StromData, start: PersonId, top: PersonId): PersonId[] {
    const prev = new Map<PersonId, PersonId>();
    const queue: PersonId[] = [start];
    const seen = new Set<PersonId>([start]);
    while (queue.length) {
        const id = queue.shift()!;
        if (id === top) {
            const out: PersonId[] = [id];
            let at = id;
            while (prev.has(at)) { at = prev.get(at)!; out.push(at); }
            return out;
        }
        for (const parent of descentParentIds(data, id)) {
            if (seen.has(parent)) continue;
            seen.add(parent);
            prev.set(parent, id);
            queue.push(parent);
        }
    }
    return [];
}

function oldestRecordOf(data: StromData, lang: GiftLang): GiftFacts['oldestRecord'] {
    const types = getStringsForLang(lang).events.types as Record<string, string>;
    let best: { key: number; label: string; name: string; place: string | null; year: number } | null = null;
    const consider = (date: string | undefined, label: string, p: Person, place: string | undefined): void => {
        const d = parseFlexDate(date);
        if (!d || d.qualifier !== '' || d.end || d.period) return;
        const key = d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0);
        if (best && best.key <= key) return;
        best = { key, label, name: shownName(p) || '?', place: placeHead(place) || null, year: d.year };
    };
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        consider(p.birthDate, types.birth, p, p.birthPlace);
        consider(p.deathDate, types.death, p, p.deathPlace);
        for (const e of p.events ?? []) {
            const label = e.type === 'custom' ? (e.customLabel?.trim() || types.custom) : types[e.type];
            if (label) consider(e.date, label, p, e.place);
        }
    }
    if (!best) return null;
    const { label, name, place, year } = best as { label: string; name: string; place: string | null; year: number };
    return { label, name, place, year };
}

/**
 * The cut in figures (§6 "the family tree in numbers"). Pass the protected
 * data: what the protection hid never shows here.
 */
export function giftFacts(source: StromData | LineageIndex, recipients: readonly PersonId[], lang: GiftLang, now: Date): GiftFacts {
    const index = 'rodByPerson' in source ? source : buildLineages(source);
    const data = index.data;
    const real = Object.values(data.persons).filter(p => !p.isPlaceholder);
    const persons = computeCompleteness(data).total;
    const generations = persons ? computeFamilyStats(data).generations : 0;

    const born = real
        .map(p => ({ p, year: yearOf(p.birthDate) }))
        .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    const firstYear = born.length && born[0].year !== null ? born[0].year : null;
    const years = firstYear !== null ? Math.max(0, now.getFullYear() - firstYear) : null;

    const { ancestors, oldest } = oldestAncestor(data, recipients);

    // Lineages of the living alone are left out: their names may be shortened by the protection.
    const labels = rodLabels(index);
    const bounds = inferBirthUpperBounds(data);
    const rodNames = rods(index)
        .filter(r => r.realMemberCount > 0 && !isMarriedInOnly(index, r)
            && rodLivingCount(r, data, now.getFullYear(), bounds) < r.realMemberCount)
        .map(r => labels.get(r.id) ?? r.surname)
        .filter(Boolean);

    const places: string[] = [];
    for (const { p } of born) {
        const head = placeHead(p.birthPlace);
        if (head && !places.includes(head)) places.push(head);
    }

    const journey: string[] = [];
    const first = recipients.find(r => !!data.persons[r]);
    if (first && oldest) {
        for (const id of lineDown(data, first, oldest.id)) {
            const p = data.persons[id];
            const head = placeHead(p ? founderPlace(p) : null);
            if (head && journey[journey.length - 1] !== head) journey.push(head);
        }
    }

    const gen = assignGenerations(data);
    const counts = new Map<number, number>();
    for (const p of real) {
        const g = gen.get(p.id);
        if (g === undefined) continue;
        counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const byGeneration = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);

    return {
        persons, generations, firstYear, years, ancestors, oldest, rods: rodNames, places,
        journey: journey.length >= 2 ? journey : [],
        oldestRecord: oldestRecordOf(data, lang),
        byGeneration,
    };
}

// ==================== The letter's template ====================

/** The salutation's placeholders, one per language ("[oslovení]", "[name]", "[Name]", "[imię]"). */
export const GIFT_SALUTATION_TOKENS: readonly string[] = (['cs', 'en', 'de', 'pl'] as const)
    .map(l => getStringsForLang(l).giftTree.salutationToken);

/** The message with the salutation in place of every language's placeholder (§6). */
export function giftMessage(letter: Pick<GiftLetter, 'message' | 'salutation'>): string {
    let text = letter.message ?? '';
    for (const token of GIFT_SALUTATION_TOKENS) text = text.split(token).join('\u0000');
    return text.split('\u0000').join(letter.salutation ?? '');
}

/**
 * The default salutation (§6): the recipient's first name (the code knows no
 * vocative), for a couple both joined ("Daniel and Julia").
 */
export function giftDefaultSalutation(person: Person | readonly Person[], lang: GiftLang): string {
    const people = Array.isArray(person) ? person as readonly Person[] : [person as Person];
    const names = people.map(p => {
        const first = (p.firstName ?? '').trim().split(/\s+/)[0];
        return first || shownName(p);
    }).filter(Boolean);
    return joinAnd(lang, names);
}

/**
 * The letter's template for the motif, in the letter's language (§6): the
 * greeting by the recipient's gender (the plural for a couple), the oldest
 * ancestor and the figures of the cut, the sentence about the browser and a
 * closing. The salutation stays a placeholder (giftMessage puts it in). The
 * oldest ancestor is named only when not living.
 */
export function giftLetterTemplate(source: StromData | LineageIndex, cut: GiftCut, letter: Pick<GiftLetter, 'lang' | 'motif' | 'date'>): string {
    const data = giftCutData(source, cut);
    const year = yearOf(letter.date) ?? new Date().getFullYear();
    const recipients = cut.recipients.filter(id => !!data.persons[id]);
    const facts = giftFacts(data, recipients, letter.lang, new Date(year, 6, 1));
    const bounds = inferBirthUpperBounds(data);
    const S = getStringsForLang(letter.lang).giftTree;
    let oldest: GiftTemplateFacts['oldest'] = null;
    if (facts.oldest) {
        const p = data.persons[facts.oldest.id];
        if (p && !isLivingPerson(p, year, bounds)) {
            const o = facts.oldest;
            oldest = {
                name: o.name,
                when: o.year === null ? null : o.approx ? `${S.cover.about} ${o.year}` : String(o.year),
                place: o.place,
            };
        }
    }
    const gender: Gender = recipients.length === 1 ? (data.persons[recipients[0]]?.gender ?? 'unknown') : 'unknown';
    const f: GiftTemplateFacts = {
        gender, couple: recipients.length > 1, ancestors: facts.ancestors, oldest,
        persons: facts.persons, years: facts.years || null,
    };
    return S.template[letter.motif](f);
}

// ==================== The page ====================

/** A small fan of the person's ancestors (three rings), filled where an ancestor is known. */
function fanPreview(data: StromData, personId: PersonId | undefined): string {
    const gens = personId ? ancestorGenerations(data, personId, 'both', 3) : [];
    const known = (ring: number) => new Set((gens[ring] ?? []).filter(id => data.persons[id] && !data.persons[id].isPlaceholder)).size;
    const cx = 100, cy = 100, step = 22;
    const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`;
    let out = `<path d="M${cx - step},${cy} A${step},${step} 0 0 1 ${cx + step},${cy} Z" fill="var(--surface-2)" stroke="var(--surface)" stroke-width="1.5"/>`;
    for (let ring = 0; ring < 3; ring++) {
        const n = 2 ** (ring + 1);
        const filled = known(ring);
        const r0 = step * (ring + 1), r1 = step * (ring + 2);
        for (let i = 0; i < n; i++) {
            const a0 = Math.PI - (Math.PI * i) / n, a1 = Math.PI - (Math.PI * (i + 1)) / n;
            const fill = i < filled ? 'var(--rod-bar)' : 'var(--surface-2)';
            out += `<path d="M${pt(r1, a0)} A${r1},${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0},${r0} 0 0 0 ${pt(r0, a0)} Z"`
                + ` fill="${fill}" stroke="var(--surface)" stroke-width="1.5" opacity="${(0.88 - ring * 0.12).toFixed(2)}"/>`;
        }
    }
    return `<svg class="gl-fan" width="200" height="104" viewBox="0 0 200 104" aria-hidden="true">${out}</svg>`;
}

function baseName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

function stemOf(path: string): string {
    const name = baseName(path);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The cover page "Start here.html" (§6), from the data every part got (the
 * protected cut) and what the package knows about its files. No script, links
 * relative to the folder, texts in the letter's language.
 */
export function buildGiftCover(data: StromData, info: GiftCoverInfo): string {
    const lang = info.lang;
    const S = getStringsForLang(lang).giftTree;
    const C = S.cover;
    const index = buildLineages(data);
    const facts = giftFacts(index, info.recipients, lang, info.now);
    const year = info.now.getFullYear();
    const xmas = info.letter.motif === 'xmas';
    const recipients = info.recipients.map(id => data.persons[id]).filter((p): p is Person => !!p);

    // 1–3. The kicker, the portraits, the names and the line under them.
    const portraits = info.photos
        ? recipients.map(p => p.photo).filter((src): src is string => !!src && src.startsWith('data:image/'))
            .map(src => `<img class="gl-av" src="${esc(src)}" alt="">`).join('')
        : '';
    const subParts: string[] = [];
    if (recipients.length === 1) {
        const p = recipients[0];
        const born = [yearOf(p.birthDate), placeHead(p.birthPlace)].filter(x => x !== null && x !== '').join(', ');
        if (born) subParts.push(`* ${born}`);
    }
    if (facts.oldest?.year != null) subParts.push(C.ancestorsTo(facts.oldest.year));
    const title = joinAnd(lang, info.names);
    const head = `<header class="sp-head gl-head">`
        + `<span class="sp-kicker">${esc(xmas ? C.kickerXmas(year) : C.kicker)}</span>`
        + `<div class="gl-who">${portraits}<div class="gl-who-t"><h1 class="sp-h1">${esc(title)}</h1>`
        + (subParts.length ? `<p class="sp-sub">${esc(subParts.join(' · '))}</p>` : '')
        + `</div></div>`;
    const stat = (n: number, word: (n: number) => string) => `<span class="sp-stat"><strong>${n}</strong> ${esc(word(n))}</span>`;
    const stats = [stat(facts.persons, C.persons)];
    if (facts.generations > 1) stats.push(stat(facts.generations, C.generations));
    if (facts.years) stats.push(stat(facts.years, C.years));
    if (facts.rods.length) stats.push(stat(facts.rods.length, C.rods));
    const header = `${head}<p class="sp-stats">${stats.join(' · ')}</p></header>`;

    // 4. The message and the signature.
    const message = giftMessage(info.letter).trim();
    const signature = (info.letter.signature ?? '').trim();
    const dateLabel = formatFlexDate(info.letter.date || isoDay(info.now), lang);
    const msg = message || signature
        ? `<section class="gl-msg">${message ? `<div class="gl-msg-t">${esc(message)}</div>` : ''}`
            + `<p class="gl-sig">${signature ? `<b>${esc(signature)}</b>` : ''}${esc(dateLabel)}</p></section>`
        : '';
    const orn = xmas ? '<div class="gl-orn" aria-hidden="true"><i></i>✦<i></i></div>' : '';

    // 5. What the package holds: a card per part that is in it.
    const files = info.files.filter(f => info.parts[f.part]);
    const order: GiftCoverFile['part'][] = ['app', 'pages', 'book', 'fan', 'gedcom'];
    files.sort((a, b) => order.indexOf(a.part) - order.indexOf(b.part));
    let fanIndex = 0;
    const cards = files.map(f => {
        const part = C.parts[f.part];
        const t = f.part === 'fan' ? stemOf(f.path) : part.t;
        const meta = f.part === 'pages' ? f.path.split('/').join(' / ') : `${baseName(f.path)} · ${formatTreeSize(f.bytes, lang)}`;
        const preview = f.part === 'fan' ? fanPreview(data, info.recipients[fanIndex++]) : '';
        return `<a class="sp-card gl-card${f.part === 'app' ? ' gl-main' : ''}" href="${esc(hrefOf(f.path))}">`
            + `<span class="sp-card-t">${esc(t)}</span>${preview}`
            + `<span class="sp-card-f">${esc(part.f)}</span>`
            + `<span class="sp-card-m">${esc(meta)}</span>`
            + `<span class="sp-card-go">${esc(f.part === 'gedcom' ? C.showFile : C.open)}</span></a>`;
    }).join('');
    const what = `<section class="gl-sec gl-screen"><h2 class="sp-h2">${esc(C.whatH)}</h2>`
        + `<p class="sp-sub gl-lead">${esc(C.whatLead)}</p>`
        + (cards ? `<div class="sp-cards">${cards}</div>` : '')
        + `<p class="gl-unzip">${esc(C.unzip)}</p></section>`;

    // 6. The family tree in numbers: the facts and the people by generation.
    const dl: string[] = [];
    const fact = (k: string, v: string) => dl.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`);
    if (facts.oldest) {
        const o = facts.oldest;
        const when = o.year === null ? '' : o.approx ? `${C.about} ${o.year}` : String(o.year);
        fact(C.oldest, [esc(o.name), esc(when), esc(o.place ?? '')].filter(Boolean).join(', '));
    }
    if (facts.rods.length) fact(C.rodsK, esc(facts.rods.slice(0, 10).join(' · ') + (facts.rods.length > 10 ? ` +${facts.rods.length - 10}` : '')));
    if (facts.places.length) fact(C.places, esc(facts.places.slice(0, 8).join(', ') + (facts.places.length > 8 ? ` +${facts.places.length - 8}` : '')));
    if (facts.journey.length) fact(C.journey, esc(facts.journey.join(' → ')));
    if (facts.oldestRecord) {
        const r = facts.oldestRecord;
        fact(C.oldestRecord, esc(`${r.label}: ${r.name}, ${[r.place, r.year].filter(Boolean).join(' ')}`));
    }
    let chart = '';
    if (facts.byGeneration.length >= 2) {
        const max = Math.max(...facts.byGeneration);
        const rows = facts.byGeneration.map((n, i) => `<div class="sp-bar-row"><span class="sp-bar-gen">${romanNumeral(i + 1)}</span>`
            + `<span class="sp-axis"><span class="sp-bar" style="width:${Math.max(2, Math.round((n / max) * 100))}%"></span></span>`
            + `<span class="sp-bar-n">${n}</span></div>`).join('');
        chart = `<h3 class="gl-h3">${esc(C.chartH)}</h3>${rows}`
            + `<span class="gl-fnote">${esc(C.chartNote(romanNumeral(facts.byGeneration.length)))}</span>`;
    }
    const numbers = dl.length || chart
        ? `<section class="gl-sec"><h2 class="sp-h2">${esc(C.numbersH)}</h2><div class="gl-two">`
            + (dl.length ? `<dl class="sp-facts">${dl.join('')}</dl>` : '')
            + (chart ? `<div class="sp-chart gl-chart gl-screen">${chart}</div>` : '')
            + `</div></section>`
        : '';

    // Print: page 2 lists the files as rows, then the chart.
    const tocRows = [`<div class="sp-toc-row"><span>${esc(C.parts.start.t)}</span><span>${esc(C.parts.start.p)} <span class="gl-fn">${esc(S.files.start)}</span></span></div>`]
        .concat(files.map(f => {
            const t = f.part === 'fan' ? stemOf(f.path) : C.parts[f.part].t;
            return `<div class="sp-toc-row"><span>${esc(t)}</span><span>${esc(C.parts[f.part].p)} <span class="gl-fn">${esc(f.path)}</span></span></div>`;
        })).join('');
    const printed = `<section class="gl-sec gl-print gl-page2"><h2 class="sp-h2">${esc(C.whatH)}</h2>`
        + `<p class="sp-sub gl-lead">${esc(C.printLead(info.folder))}</p>${tocRows}`
        + `<p class="gl-unzip">${esc(C.unzip)}</p></section>`
        + (chart ? `<section class="gl-sec gl-print"><div class="sp-chart gl-chart">${chart}</div></section>` : '');

    // 7. The footer: when, offline, and whether the protection shortened anything.
    const foot = [C.created(formatFlexDate(isoDay(info.now), lang)), C.offline];
    if (info.shortened) foot.push(C.shortened);
    const footer = `<footer class="sp-foot"><p>${esc(foot.join(' · '))}.</p></footer>`;

    const fonts = (info.fontCss ?? '').replace(/<\//g, '<\\/');
    const css = `${fonts}\n:root { ${PERSON_PAGE_LIGHT_TOKENS} ${PERSON_PAGE_VIZ_LIGHT_TOKENS} ${FONT_STACKS} color-scheme: light; }\n${FAMILY_PAGES_CSS}${GIFT_COVER_CSS}`;
    return `<!doctype html>\n<html lang="${esc(lang)}"><head><meta charset="utf-8">`
        + `<meta name="viewport" content="width=device-width, initial-scale=1">`
        + `<meta name="color-scheme" content="light dark">`
        + `<title>${esc(info.folder || title)}</title><style>${css}</style></head>`
        + `<body><div class="gl-page${xmas ? ' gl-xmas' : ''}">`
        + (xmas ? `<div class="gl-band" aria-hidden="true"></div>${TWIG_SVG}` : '')
        + `<main class="gl-file">${header}${msg}${orn}${what}${numbers}${printed}${footer}</main>`
        + `</div></body></html>\n`;
}
