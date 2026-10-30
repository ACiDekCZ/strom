/**
 * Life at a glance — the person page's graphic life chart (spec 025, §2):
 * one horizontal axis over the life with the periods (childhood and youth,
 * each marriage, widowhood), the places lived, the milestones, the partners'
 * and children's lives alongside, and the history of the places above.
 *
 * Pure: `lifeChartInput` reads the tree (living protection applied there) and
 * `lifeChartHtml` returns the HTML. Horizontal positions go out in percent of
 * the chart's width, vertical ones as rows of fixed height (CSS), so the same
 * markup holds at any width; the width only decides which labels fit. The
 * window calls it with the column's width (ResizeObserver); a saved file
 * carries two sets (≥ 641 and ≤ 640 px) switched by @media, readable without JS.
 */

import type { Language } from './strings.js';
import { getStringsForLang } from './strings.js';
import type { StromData, PersonId, Person, Gender, PartnershipId, Partnership } from './types.js';
import { computePersonLifeline, type LifelinePoint } from './timeline.js';
import { parseFlexDate, yearFraction, displayYear } from './dates.js';
import { isLivingPerson } from './privacy.js';
import { residencePoints, type LifelineHistoryItem } from './history.js';
import { placeKey } from './places.js';
import { lifeEventLabel } from './person-sources.js';

// ─── Anchors ────────────────────────────────────────────────────────────────

/** The id of the text timeline row of a point (`#osa-{sortKey}`): "osa-1860-001". */
export function chartAnchorId(sortKey: number): string {
    return `osa-${sortKey.toFixed(3).replace('.', '-').replace(/^-/, 'm')}`;
}

/** The id of the text timeline row of a history event: "osa-h-{id}". */
export function chartHistAnchorId(eventId: string): string {
    return `osa-h-${eventId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

// ─── Input ──────────────────────────────────────────────────────────────────

/** A date on the axis. */
export interface ChartDate {
    /** Position on the axis in years (year + fraction of the year). */
    at: number;
    year: number;
    /** The end of a range ("1901..1905"), in years. */
    to?: number;
    /** `~`, before / after or a range: the bar fades there (§2.5). Only the year is drawn plainly (yearly precision). */
    uncertain: boolean;
    /** "1798", "~1798", "1901–1905". */
    label: string;
}

/** 'life': the bar where no period is known (no marriage date, or before the first dated marriage with an undated union there). */
export type ChartPeriodKind = 'youth' | 'life' | 'marriage' | 'partnership' | 'widowed' | 'divorced';

export interface ChartPeriod {
    kind: ChartPeriodKind;
    from: number;
    to: number;
    /** The partner's first name (marriage, partnership). */
    name?: string;
    /** The text timeline anchor of the period's start. */
    anchor?: string;
}

export interface ChartResidence { from: number; to: number; place: string; key: string; anchor: string }

export type ChartMarkKind = 'birth' | 'death' | 'marriage' | 'divorce' | 'emigration' | 'event';

export interface ChartMark {
    kind: ChartMarkKind;
    at: number;
    year: number;
    /** The event type (kind 'event' / 'emigration'). */
    eventType?: string;
    /** Full text for the title. */
    title: string;
    anchor: string;
    /** Birth / death: "~1798". */
    label?: string;
}

export interface ChartLine {
    kind: 'partner' | 'child';
    name: string;
    from: number;
    /** The end of the line (death); missing: the life goes on past the axis or is unknown. */
    to?: number;
    deathYear?: number;
    /** A child who died in childhood (under 15): age in whole years. */
    childAge?: number;
    /** The start is only the first known point (an undated union: the first common child's birth): it fades in. */
    fadeStart?: boolean;
    anchor: string;
}

export interface ChartHistory {
    from: number;
    to?: number;
    scope: 'region' | 'place' | 'local';
    kind: string;
    text: string;
    anchor: string;
}

export interface LifeChartInput {
    gender: Gender;
    /** Axis in years. */
    start: number;
    end: number;
    birth?: ChartDate;
    death?: ChartDate;
    /** death: a known death; unknown: no death date, not living; living. */
    endKind: 'death' | 'unknown' | 'living';
    /** The bar ends here (the death, the last dated point, today). */
    barEnd: number;
    /** Unknown death: the last dated year ("after 1871 ?"). */
    lastYear?: number;
    periods: ChartPeriod[];
    /** A union shown on the page has no marriage date: the legend explains the neutral "life" bar. */
    periodsUnknown?: boolean;
    residence: ChartResidence[];
    marks: ChartMark[];
    lines: ChartLine[];
    history: ChartHistory[];
}

export interface LifeChartInputOptions {
    /** Ids of living people (PersonPageData.living); computed when missing. */
    living?: ReadonlySet<string>;
    /** A protected file: nothing for a living person, no line for a living relative. */
    protect?: boolean;
    /** The person's history items (only with research data). */
    history?: readonly LifelineHistoryItem[];
    /** Current year with its fraction (default: now). */
    now?: number;
    /** The life timeline, when the caller has it (else computed). */
    lifeline?: readonly LifelinePoint[];
}

function chartDate(raw: string | undefined, closeYear: boolean): ChartDate | undefined {
    const d = parseFlexDate(raw);
    if (!d) return undefined;
    const at = d.month !== undefined ? d.year + yearFraction(raw) : d.year + (closeYear ? 0.9 : 0.05);
    const to = d.end ? d.end.year + (closeYear ? 0.9 : 0.05) : undefined;
    return {
        at, year: d.year,
        ...(to !== undefined && d.end && d.end.year !== d.year ? { to } : {}),
        uncertain: !!d.qualifier || !!d.end,
        label: displayYear(raw),
    };
}

const CHILDHOOD = 15;

/**
 * The chart's input for a person, or null when the chart is not drawn (§2.5):
 * fewer than 2 dated points in different years, or a living person in a
 * protected file.
 */
export function lifeChartInput(tree: StromData, personId: PersonId, opts: LifeChartInputOptions = {}): LifeChartInput | null {
    const person = tree.persons[personId];
    if (!person || person.isPlaceholder) return null;
    const nowDate = new Date();
    const now = opts.now ?? nowDate.getFullYear() + nowDate.getMonth() / 12;
    const isLiving = (p: Person): boolean => opts.living ? opts.living.has(p.id) : isLivingPerson(p, Math.floor(now));
    const living = isLiving(person);
    if (opts.protect && living) return null;
    const hidden = (p: Person | undefined): boolean => !!p && !!opts.protect && isLiving(p);
    // A living partner in a protected file: the union stays as the family tree shows it (initials, the marriage
    // year), so the chart never claims a widowhood the rest of the file contradicts; no line of their life.
    const shieldedName = (p: Person): string => [p.firstName, p.lastName]
        .map(n => (n ?? '').trim()).filter(Boolean).map(n => `${n[0].toUpperCase()}.`).join(' ');
    const nameOf = (p: Person | undefined): string => !p ? '' : hidden(p) ? shieldedName(p) : (p.firstName?.trim() || '');

    const lifeline = opts.lifeline ?? computePersonLifeline(tree, personId);
    const years = new Set(lifeline.map(p => p.year));
    if (years.size < 2) return null;

    const birth = chartDate(person.birthDate, false);
    const death = chartDate(person.deathDate, true);
    const anchorOf = (pred: (p: LifelinePoint) => boolean): string => {
        const p = lifeline.find(pred);
        return p ? chartAnchorId(p.sortKey) : '';
    };
    const first = lifeline[0];
    const lastPt = lifeline[lifeline.length - 1];
    const start = birth ? birth.at : first.year + 0.05;

    let endKind: LifeChartInput['endKind'];
    let barEnd: number;
    let lastYear: number | undefined;
    if (death) { endKind = 'death'; barEnd = death.at; }
    else if (living && person.isDeceased !== true) { endKind = 'living'; barEnd = Math.max(now, lastPt.year + 0.9); }
    else { endKind = 'unknown'; lastYear = lastPt.year; barEnd = lastPt.year + 0.9; }
    // Room for a death range or for the fade of an unknown end.
    let end = death?.to ?? barEnd;
    if (endKind === 'unknown') end = barEnd + Math.max(3, (barEnd - start) * 0.06);
    if (end - start < 1) end = start + 1;

    // Marriages in their order, each ending at its end date, the partner's death, the next marriage or the end.
    const lifeEnd = barEnd;
    const shown = person.partnerships
        .map(id => tree.partnerships[id])
        .filter(u => !!u)
        .map(u => {
            const otherId = u.person1Id === personId ? u.person2Id : u.person1Id;
            const other = tree.persons[otherId];
            const shielded = hidden(other);
            // Of a union with a living partner only the year of the marriage is known (privacy).
            const year = shielded ? parseFlexDate(u.startDate)?.year : undefined;
            const start = shielded ? (year !== undefined ? chartDate(String(year), false) : undefined) : chartDate(u.startDate, false);
            // Such a union that ended in the person's life (a divorce, a separation, an end date before the
            // death) has no length in the chart: neither its end nor its kind may show, so the ⚭ mark alone.
            const endAt = chartDate(u.endDate, true)?.at;
            const ended = shielded && (u.status === 'divorced' || u.status === 'separated'
                || (endAt !== undefined && endAt < lifeEnd - 0.01));
            return { u, other, shielded, ended, start };
        });
    const unions = shown.filter(x => !!x.start).sort((a, b) => a.start!.at - b.start!.at);
    // A union without a marriage date (§2.3, round 2): its first known point is the birth of the first common child.
    const firstChildAt = (u: Partnership): number | undefined => {
        const ats = u.childIds.map(id => tree.persons[id])
            .filter((c): c is Person => !!c && !c.isPlaceholder && !hidden(c))
            .map(c => chartDate(c.birthDate, false)?.at)
            .filter((n): n is number => n !== undefined);
        return ats.length ? Math.min(...ats) : undefined;
    };
    const undated = shown.filter(x => !x.start).map(x => ({ ...x, firstAt: firstChildAt(x.u) }));

    const periods: ChartPeriod[] = [];
    const firstStart = unions.length ? unions[0].start!.at : undefined;
    // Childhood and youth up to the first dated marriage; "life" when no marriage is dated, or when an undated
    // union belongs before it (its first child born earlier).
    const lifeBefore = firstStart === undefined || undated.some(x => x.firstAt !== undefined && x.firstAt < firstStart);
    periods.push({ kind: lifeBefore ? 'life' : 'youth', from: start, to: firstStart ?? lifeEnd, anchor: anchorOf(p => p.kind === 'birth') || (first ? chartAnchorId(first.sortKey) : '') });
    unions.forEach((x, i) => {
        const from = x.start!.at;
        const next = unions[i + 1]?.start!.at;
        if (x.ended) {
            // The time it may have covered is plain life (as with a union of no date and no child).
            const until = Math.min(next ?? lifeEnd, lifeEnd);
            if (until > from) periods.push({ kind: 'life', from, to: until, anchor: anchorOf(p => p.kind === 'marriage' && p.partnershipId === x.u.id) });
            return;
        }
        const endDate = x.shielded ? undefined : chartDate(x.u.endDate, true);
        const partnerDeath = x.other && !x.shielded ? chartDate(x.other.deathDate, true) : undefined;
        const candidates = [lifeEnd, next, endDate?.at, partnerDeath?.at].filter((n): n is number => n !== undefined && n > from);
        const to = Math.min(...candidates);
        const unmarried = x.u.status === 'partners' || x.u.status === 'separated';
        const name = nameOf(x.other);
        periods.push({ kind: unmarried ? 'partnership' : 'marriage', from, to, ...(name ? { name } : {}),
            anchor: anchorOf(p => p.kind === 'marriage' && p.partnershipId === x.u.id) });
        // The gap up to the next marriage or the end of the life.
        const gapEnd = Math.min(next ?? lifeEnd, lifeEnd);
        if (gapEnd - to > 0.2) {
            const byDeath = partnerDeath !== undefined && Math.abs(partnerDeath.at - to) < 0.01;
            const byEnd = endDate !== undefined && Math.abs(endDate.at - to) < 0.01;
            if (byDeath || byEnd) {
                // Widowed / after a divorce only while no other union can be there: an undated union whose
                // first child comes in the gap ends it there, one with no known point at all leaves it unknown.
                const unknown = undated.some(y => y.firstAt === undefined);
                const laterAt = undated.map(y => y.firstAt).filter((n): n is number => n !== undefined && n > to + 0.01 && n < gapEnd);
                const until = laterAt.length ? Math.min(...laterAt) : gapEnd;
                const anchor = byEnd ? anchorOf(p => p.kind === 'divorce' && p.partnershipId === x.u.id) : '';
                if (unknown) periods.push({ kind: 'life', from: to, to: gapEnd, anchor });
                else {
                    if (until - to > 0.2) periods.push({ kind: byDeath && !byEnd ? 'widowed' : 'divorced', from: to, to: until, anchor });
                    if (until < gapEnd) periods.push({ kind: 'life', from: until, to: gapEnd, anchor: '' });
                }
            }
        }
    });

    // Places lived: runs of the same place, each up to the next place (the last one to the end of the bar).
    const res = residencePoints(lifeline);
    const residence: ChartResidence[] = [];
    for (let i = 0; i < res.length; i++) {
        const key = placeKey(res[i].place);
        const prev = residence[residence.length - 1];
        const from = Math.max(start, res[i].sortKey);
        if (prev && prev.key === key) continue;
        if (prev) prev.to = from;
        residence.push({ from, to: lifeEnd, place: res[i].place, key, anchor: chartAnchorId(res[i].sortKey) });
    }
    const residenceKept = residence.filter(r => r.to - r.from > 0);

    // Milestones.
    const marks: ChartMark[] = [];
    const partnerNameOf = (id: PartnershipId | undefined): string => {
        if (!id) return '';
        const u = tree.partnerships[id];
        if (!u) return '';
        return nameOf(tree.persons[u.person1Id === personId ? u.person2Id : u.person1Id]);
    };
    const hiddenUnion = (id: PartnershipId | undefined): boolean => {
        if (!id) return false;
        const u = tree.partnerships[id];
        return !!u && hidden(tree.persons[u.person1Id === personId ? u.person2Id : u.person1Id]);
    };
    for (const p of lifeline) {
        const at = p.kind === 'birth' && birth ? birth.at : p.kind === 'death' && death ? death.at : p.sortKey;
        const base = { at, year: p.year, anchor: chartAnchorId(p.sortKey) };
        if (p.kind === 'birth') marks.push({ ...base, kind: 'birth', title: '', ...(birth ? { label: birth.label } : {}) });
        else if (p.kind === 'death') marks.push({ ...base, kind: 'death', title: '', ...(death ? { label: death.label } : {}) });
        else if (p.kind === 'marriage') {
            // A union with a living partner: the year alone (the family tree's "⚭ 1974 L. Ž.").
            const shieldedAt = hiddenUnion(p.partnershipId) ? p.year + 0.05 : undefined;
            marks.push({ ...base, ...(shieldedAt !== undefined ? { at: shieldedAt } : {}), kind: 'marriage', title: partnerNameOf(p.partnershipId) });
        }
        else if (p.kind === 'divorce' && !p.unmarried && !hiddenUnion(p.partnershipId)) marks.push({ ...base, kind: 'divorce', title: partnerNameOf(p.partnershipId) });
        else if (p.kind === 'event' && p.eventType && p.eventType !== 'birth' && p.eventType !== 'death') {
            marks.push({ ...base, kind: p.eventType === 'emigration' ? 'emigration' : 'event', eventType: p.eventType,
                title: p.eventType === 'custom' ? (p.customLabel ?? '') : '' });
        }
    }

    // Partners' and children's lives alongside: in the order of the marriages, an undated union by its first child.
    const lines: ChartLine[] = [];
    const partnerLines = [
        ...unions.map(x => ({ x, from: x.start!.at, fade: false })),
        ...undated.filter(x => x.firstAt !== undefined).map(x => ({ x, from: x.firstAt!, fade: true })),
    ].sort((a, b) => a.from - b.from);
    for (const { x, from, fade } of partnerLines) {
        if (!x.other || x.other.isPlaceholder || x.shielded) continue;
        const d = chartDate(x.other.deathDate, true);
        lines.push({ kind: 'partner', name: x.other.firstName?.trim() || '', from,
            ...(d ? { to: d.at, deathYear: d.year } : {}),
            ...(fade ? { fadeStart: true } : {}),
            anchor: fade ? anchorOf(p => p.kind === 'child' && !!p.relatedId && x.u.childIds.includes(p.relatedId as PersonId))
                : anchorOf(p => p.kind === 'marriage' && p.partnershipId === x.u.id) });
    }
    const kids = person.childIds
        .map(id => tree.persons[id])
        .filter((c): c is Person => !!c && !c.isPlaceholder && !hidden(c))
        .map(c => ({ c, b: chartDate(c.birthDate, false) }))
        .filter(x => !!x.b)
        .sort((a, b) => a.b!.at - b.b!.at);
    for (const { c, b } of kids) {
        const d = chartDate(c.deathDate, true);
        const age = d ? Math.max(0, Math.floor(d.at - b!.at)) : undefined;
        lines.push({ kind: 'child', name: c.firstName?.trim() || '', from: b!.at,
            ...(d ? { to: d.at, deathYear: d.year } : {}),
            ...(age !== undefined && age < CHILDHOOD ? { childAge: age } : {}),
            anchor: anchorOf(p => p.kind === 'child' && p.relatedId === c.id) });
    }

    // History of the places (only with research data).
    const history: ChartHistory[] = (opts.history ?? []).map(h => ({
        from: h.ev.from,
        ...(h.ev.to !== undefined && h.ev.to > h.ev.from ? { to: h.ev.to } : {}),
        scope: h.ev.scope === 'local' ? 'local' as const : h.ev.scope === 'place' ? 'place' as const : 'region' as const,
        kind: h.ev.kind,
        text: h.text,
        anchor: chartHistAnchorId(h.ev.id),
    }));

    return {
        gender: person.gender, start, end, ...(birth ? { birth } : {}), ...(death ? { death } : {}),
        endKind, barEnd, ...(lastYear !== undefined ? { lastYear } : {}),
        periods, ...(undated.length ? { periodsUnknown: true } : {}), residence: residenceKept, marks, lines, history,
    };
}

// ─── HTML ───────────────────────────────────────────────────────────────────

export interface LifeChartCtx {
    lang: Language;
    /** 'app': one set for `width`; 'file': two sets switched by @media. */
    mode: 'app' | 'file';
    /** The chart's width in px (app; from a ResizeObserver). Default 680. */
    width?: number;
}

/** Widths of the saved file's two sets: desktop column and a phone (100vw − 32 at 375). */
export const CHART_WIDE = 680;
export const CHART_NARROW = 343;
/** Below this width (px) the short labels of a phone are used. */
export const CHART_NARROW_MAX = 560;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type CS = ReturnType<typeof getStringsForLang>;

/** px per character of a label (§2.3: a period label fits when its width > length × 6.4). */
const CH_PX = 6.4;
/** px per character of an age label (10.5 px type, digits and short words). */
const AGE_CH_PX = 6;

/**
 * The chart, or '' without input. In the window `ctx.width` is the column's
 * width; a file gets the wide (680 px) and the narrow (343 px) set.
 *
 * Interaction hooks: every period, mark and line is an `<a href="#osa-…"
 * data-pp-osa="osa-…">` (history: `#osa-h-…`); the rows of children's lines
 * carry `pp-ch-kid` and the history row `pp-ch-hist`, hidden by a
 * `.pp-no-kids` / `.pp-no-history` class on an ancestor (the switches).
 */
export function lifeChartHtml(input: LifeChartInput | null, ctx: LifeChartCtx): string {
    if (!input) return '';
    const S = getStringsForLang(ctx.lang);
    const C = S.personPage.chart;
    const legend = legendHtml(input, S);
    if (ctx.mode === 'app') {
        const w = Math.max(240, ctx.width ?? CHART_WIDE);
        return `<div class="pp-chart" role="group" aria-label="${esc(C.aria)}">`
            + `<div class="pp-chart-set pp-chart-set--one">${chartSet(input, S, ctx, w, w <= CHART_NARROW_MAX)}</div>${legend}</div>`;
    }
    return `<div class="pp-chart" role="group" aria-label="${esc(C.aria)}">`
        + `<div class="pp-chart-set pp-chart-set--wide">${chartSet(input, S, ctx, CHART_WIDE, false)}</div>`
        + `<div class="pp-chart-set pp-chart-set--narrow" aria-hidden="true">${chartSet(input, S, ctx, CHART_NARROW, true)}</div>${legend}</div>`;
}

const P = (n: number): string => `${(Math.round(n * 100) / 100).toString()}%`;

/** One set of rows for a width `W` (px). */
export function chartSet(input: LifeChartInput, S: CS, ctx: LifeChartCtx, W: number, narrow: boolean): string {
    const C = S.personPage.chart;
    const span = input.end - input.start;
    const xpx = (y: number): number => 8 + ((Math.min(Math.max(y, input.start), input.end) - input.start) / span) * (W - 16);
    const x = (y: number): string => P((xpx(y) / W) * 100);
    const wpx = (a: number, b: number): number => Math.max(0, xpx(b) - xpx(a));
    const wpc = (a: number, b: number): string => P((wpx(a, b) / W) * 100);
    const rows: string[] = [];
    const app = ctx.mode === 'app';

    // Ages: 0, 10, … "50 years" (with a birth date).
    if (input.birth) {
        const b = input.birth.at;
        const maxAge = Math.floor(Math.min(input.barEnd, input.end) - b);
        const step = (wpx(b, b + 10) < 28) ? 20 : 10;
        const ages: number[] = [];
        for (let a = 0; a <= maxAge; a += step) ages.push(a);
        const labels = ages.map((a, i) => ({ a, text: i === ages.length - 1 && a > 0 ? C.years(a) : String(a) }));
        // The last label ("50 years", longer in some languages) ends at the chart's edge rather than past it;
        // a label it would then cover ("80" under "90 Jahre" on a phone) is left out.
        const last = labels[labels.length - 1];
        const endAt = last ? W - last.text.length * AGE_CH_PX : W;
        const lastAtEnd = !!last && xpx(b + last.a) + (last.text.length * AGE_CH_PX) / 2 > W;
        rows.push(`<div class="pp-ch-row pp-ch-ages" aria-hidden="true">${labels.map((l, i) => {
            if (i === labels.length - 1) {
                return lastAtEnd ? `<span class="pp-ch-age--e">${esc(l.text)}</span>` : `<span style="left:${x(b + l.a)}">${esc(l.text)}</span>`;
            }
            if (lastAtEnd && xpx(b + l.a) + (l.text.length * AGE_CH_PX) / 2 > endAt - 4) return '';
            return `<span style="left:${x(b + l.a)}">${esc(l.text)}</span>`;
        }).join('')}</div>`);
    }

    // History of the places.
    const hist = input.history.filter(h => (h.to ?? h.from) >= Math.floor(input.start) && h.from <= input.end);
    if (hist.length) rows.push(historyRow(hist, S, xpx, x, wpc, narrow, W));

    // Period labels and the bar.
    const labelParts: string[] = [];
    const barParts: string[] = [];
    const single = input.periods.length === 1;
    for (const p of input.periods) {
        if (p.to <= p.from) continue;
        const text = periodLabel(p, S, input.gender, narrow);
        const title = periodLabel(p, S, input.gender, false);
        const fits = !single && !!text && wpx(p.from, p.to) > text.length * CH_PX;
        const cls = single ? 'pp-ch-p--life' : `pp-ch-p--${p.kind === 'partnership' ? 'marriage' : p.kind}`;
        const href = p.anchor ? ` href="#${p.anchor}" data-pp-osa="${p.anchor}"` : '';
        barParts.push(`<a class="pp-ch-p ${cls}"${href} style="left:${x(p.from)};width:${wpc(p.from, p.to)}"${title ? ` title="${esc(title)}"` : ''}></a>`);
        if (fits) labelParts.push(`<span class="pp-ch-pl" style="left:${x(p.from)};width:${wpc(p.from, p.to)}">${esc(text)}</span>`);
    }
    rows.push(`<div class="pp-ch-row pp-ch-plabels" aria-hidden="true">${labelParts.join('')}</div>`);
    const fadeStart = !!input.birth?.uncertain || !input.birth;
    const fadeEnd = input.endKind === 'unknown' || (input.endKind === 'living' && !app) || (input.endKind === 'death' && !!input.death?.uncertain && !input.death?.to);
    const maskCls = `${fadeStart ? ' pp-ch-fade-s' : ''}${fadeEnd ? ' pp-ch-fade-e' : ''}`;
    let barExtra = '';
    if (input.death?.to && input.death.to > input.barEnd) {
        barExtra += `<span class="pp-ch-dash" style="left:${x(input.barEnd)};width:${wpc(input.barEnd, input.death.to)}"></span>`;
    }
    const barLeft = input.start, barRight = input.barEnd;
    rows.push(`<div class="pp-ch-row pp-ch-bar"><div class="pp-ch-barin${maskCls}" style="left:${x(barLeft)};width:${wpc(barLeft, barRight)}">`
        + `<div class="pp-ch-bari" style="left:${P(-((xpx(barLeft)) / wpx(barLeft, barRight)) * 100)};width:${P((W / Math.max(1, wpx(barLeft, barRight))) * 100)}">${barParts.join('')}</div></div>${barExtra}</div>`);

    // Places lived.
    if (input.residence.length) {
        rows.push(`<div class="pp-ch-row pp-ch-band">${input.residence.map((r, i) => {
            const name = r.place.split(',')[0].trim() || r.place;
            const fits = wpx(r.from, r.to) > name.length * CH_PX + 8;
            const label = residenceLabel(r, i === input.residence.length - 1 && input.endKind !== 'death');
            return `<a class="pp-ch-res pp-ch-res--${i % 2 ? 2 : 1}" href="#${r.anchor}" data-pp-osa="${r.anchor}" style="left:${x(r.from)};width:${wpc(r.from, r.to)}" title="${esc(label)}" aria-label="${esc(label)}">${fits ? esc(name) : ''}</a>`;
        }).join('')}</div>`);
    }

    // Milestones.
    rows.push(marksRow(input, S, xpx, x, W, narrow, app));

    // Partners and children alongside.
    for (const l of input.lines) rows.push(lineRow(l, input, S, xpx, x, wpc, W, narrow));

    // Axis of years.
    const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => wpx(input.start, input.start + s) >= (narrow ? 44 : 40)) ?? 100;
    const ticks: number[] = [];
    for (let y = Math.ceil(input.start / step) * step; y <= input.end; y += step) ticks.push(y);
    rows.push(`<div class="pp-ch-row pp-ch-axis" aria-hidden="true">${ticks.map(y => `<span style="left:${x(y)}">${y}</span>`).join('')}</div>`);

    return rows.join('');
}

/**
 * A place lived as words, for the band's tooltip and accessible name (a narrow
 * band has no room for its name): "Bristol 1916–1921", "Bristol 1916" within a
 * year, "Bristol 1990–" when the run goes on to the end of a life not closed by a death.
 */
export function residenceLabel(r: Pick<ChartResidence, 'from' | 'to' | 'place'>, open: boolean): string {
    const a = Math.floor(r.from), b = Math.floor(r.to);
    return `${r.place} ${open ? `${a}–` : a === b ? a : `${a}–${b}`}`;
}

function periodLabel(p: ChartPeriod, S: CS, gender: Gender, narrow: boolean): string {
    const C = S.personPage.chart;
    const g = gender === 'male' ? 'm' : gender === 'female' ? 'f' : 'u';
    switch (p.kind) {
        case 'youth': return C.youth;
        case 'life': return '';
        case 'widowed': return C.widowed[g];
        case 'divorced': return C.divorced;
        default: {
            // A phone: the word alone ("Marriage"); wider: with the first name and the years.
            const name = narrow ? '' : p.name ?? '';
            const base = p.kind === 'marriage' ? C.marriage(name) : C.partnership(name);
            const n = Math.floor(p.to - p.from);
            return narrow || n < 1 ? base : `${base} · ${C.years(n)}`;
        }
    }
}

const GLYPH: Record<ChartMarkKind, string> = { birth: '*', death: '†', marriage: '⚭', divorce: '⚮', emigration: '→', event: '' };

function markTitle(m: ChartMark, S: CS): string {
    const C = S.personPage.chart;
    switch (m.kind) {
        case 'birth': return `${C.mk.birth} ${m.label ?? m.year}`;
        case 'death': return `${C.mk.death} ${m.label ?? m.year}`;
        case 'marriage': return `${C.mk.marriage(m.title)} ${m.year}`;
        case 'divorce': return `${C.mk.divorce(m.title)} ${m.year}`;
        default: {
            const label = m.title || lifeEventLabel({ type: (m.eventType ?? 'custom') as never }, S);
            return `${label} ${m.year}`;
        }
    }
}

/** A mark's short label: the year of birth / death, the event kind (a phone: only military and emigration). */
function markShort(m: ChartMark, S: CS, narrow: boolean): string {
    const C = S.personPage.chart;
    if (m.kind === 'birth' || m.kind === 'death') return m.label ?? String(m.year);
    // A marriage or divorce: the glyph says it, the year is in the title and on the axis.
    if (m.kind === 'marriage' || m.kind === 'divorce') return '';
    if (narrow && m.eventType !== 'military' && m.eventType !== 'emigration') return '';
    return C.ev[m.eventType ?? ''] ?? '';
}

function marksRow(input: LifeChartInput, S: CS, xpx: (y: number) => number, x: (y: number) => string, W: number, narrow: boolean, app: boolean): string {
    const C = S.personPage.chart;
    const prio = (m: ChartMark): number => (m.kind === 'birth' || m.kind === 'death' ? 0 : m.kind === 'marriage' || m.kind === 'divorce' ? 1 : m.kind === 'emigration' ? 2 : 3);
    // Marks closer than 8 px merge into one (the more important glyph; all texts in the title).
    const groups: { marks: ChartMark[]; px: number }[] = [];
    for (const m of [...input.marks].sort((a, b) => a.at - b.at)) {
        const px = xpx(m.at);
        const g = groups[groups.length - 1];
        if (g && px - g.px < 8) g.marks.push(m);
        else groups.push({ marks: [m], px });
    }
    // Labels: most important first, a label left out when it would overlap one already placed.
    const taken: [number, number][] = [];
    const labelOf = new Map<number, string>();
    const order = groups.map((g, i) => ({ g, i })).sort((a, b) => Math.min(...a.g.marks.map(prio)) - Math.min(...b.g.marks.map(prio)) || a.g.px - b.g.px);
    for (const { g, i } of order) {
        const lead = [...g.marks].sort((a, b) => prio(a) - prio(b))[0];
        const text = markShort(lead, S, narrow);
        if (!text) continue;
        const w = text.length * 5.8 + 4;
        const l = Math.max(0, Math.min(W - w, g.px - w / 2));
        if (taken.some(([a, b]) => l < b + 3 && a < l + w + 3)) continue;
        taken.push([l, l + w]);
        labelOf.set(i, text);
    }
    let html = '';
    groups.forEach((g, i) => {
        const lead = [...g.marks].sort((a, b) => prio(a) - prio(b))[0];
        const title = g.marks.map(m => markTitle(m, S)).join(' · ');
        const glyph = GLYPH[lead.kind];
        const label = labelOf.get(i);
        const edge = g.px < 30 ? ' pp-ch-mk--s' : g.px > W - 30 ? ' pp-ch-mk--e' : '';
        html += `<a class="pp-ch-mk pp-ch-mk--${lead.kind}${edge}" href="#${lead.anchor}" data-pp-osa="${lead.anchor}" style="left:${x(lead.at)}" title="${esc(title)}">`
            + `<span class="pp-ch-tick"></span>${glyph ? `<span class="pp-ch-gl">${glyph}</span>` : ''}${label ? `<span class="pp-ch-ml">${esc(label)}</span>` : ''}</a>`;
    });
    // The open end: "after 1871 ?" for an unknown death, "today" for a living person (window only).
    if (input.endKind === 'unknown' && input.lastYear !== undefined) {
        html += `<span class="pp-ch-end pp-ch-mk--e" style="left:${x(input.barEnd)}"><span class="pp-ch-ml">${esc(C.after(String(input.lastYear)))} ?</span></span>`;
    } else if (input.endKind === 'living' && app) {
        html += `<span class="pp-ch-end pp-ch-end--today pp-ch-mk--e" style="left:${x(input.barEnd)}"><span class="pp-ch-tick"></span><span class="pp-ch-ml">${esc(C.today)}</span></span>`;
    }
    return `<div class="pp-ch-row pp-ch-marks">${html}</div>`;
}

function lineRow(l: ChartLine, input: LifeChartInput, S: CS, xpx: (y: number) => number, x: (y: number) => string,
    wpc: (a: number, b: number) => string, W: number, narrow: boolean): string {
    const C = S.personPage.chart;
    const kidCls = l.kind === 'child' ? ' pp-ch-kid' : '';
    const from = Math.max(l.from, input.start);
    let cls = `pp-ch-ln pp-ch-ln--${l.kind}`;
    let to: number;
    let label: string;
    if (l.childAge !== undefined && l.to !== undefined) {
        // A child who died in childhood: a short line with a rounded end.
        to = Math.min(l.to, input.end);
        cls += ' pp-ch-ln--short';
        label = `${l.name} · ${C.age(l.childAge)}`;
    } else if (l.to === undefined || l.to > input.end) {
        // The life goes on past the axis: to the right edge, fading out.
        to = input.end;
        cls += ' pp-ch-ln--on';
        label = narrow || l.deathYear === undefined ? `${l.name} →` : `${l.name} · † ${l.deathYear} →`;
    } else {
        to = l.to;
        label = narrow || l.deathYear === undefined ? l.name : `${l.name} · † ${l.deathYear}`;
    }
    if (l.fadeStart) cls += ' pp-ch-ln--fs';
    const left = xpx(from);
    const lw = label.length * 6 + 2;
    const atEnd = left + lw > W - 8;
    const style = `left:${x(from)};width:${wpc(from, to)}`;
    return `<div class="pp-ch-row pp-ch-line${kidCls}"><a class="${cls}" href="#${l.anchor}" data-pp-osa="${l.anchor}" style="${style}" title="${esc(label.replace(/ →$/, ''))}">`
        + `<span class="pp-ch-lb${atEnd ? ' pp-ch-lb--end' : ''}">${esc(label)}</span></a></div>`;
}

/** History glyphs closer than this (px) join into one cluster (round 3 §2.4): wide, narrow. */
const HIST_CLUSTER_PX = 16;
const HIST_CLUSTER_PX_NARROW = 14;
/** A history label's width estimate (10.5 px text). */
const HIST_CH_PX = 5.6;
/** The two label lines under the glyphs (px from the row's top). */
const HIST_LANES = [28, 42];

/** One glyph of the history row: the events of one year, or a cluster of near years. */
export interface ChartHistGlyph {
    /** px of the first event. */
    x: number;
    scope: ChartHistory['scope'];
    anchor: string;
    /** Events in it (a badge with the count from 2 years on). */
    count: number;
    cluster: boolean;
    label: string;
    title: string;
}

/**
 * The point events of the history row as glyphs (round 3 §2.4): the events of
 * one year are one glyph (their kinds joined), glyphs closer than `gap` px
 * chain into a cluster led by its first year's glyph, with the count.
 */
export function historyGlyphs(items: readonly ChartHistory[], S: CS, xpx: (y: number) => number, gap: number): ChartHistGlyph[] {
    const kinds = S.history.kinds as Record<string, string>;
    const byYear = new Map<number, ChartHistory[]>();
    for (const h of items.filter(i => !(i.to !== undefined && i.to - i.from > 1))) {
        const list = byYear.get(h.from) ?? [];
        list.push(h);
        byYear.set(h.from, list);
    }
    const scopeRank = { local: 0, place: 1, region: 2 } as const;
    const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, list]) => ({
        year, x: xpx(year + 0.5), list,
        lead: [...list].sort((a, b) => scopeRank[a.scope] - scopeRank[b.scope])[0],
    }));
    const groups: (typeof years)[] = [];
    for (const y of years) {
        const last = groups[groups.length - 1];
        if (last && y.x - last[last.length - 1].x < gap) last.push(y);
        else groups.push([y]);
    }
    return groups.map(g => {
        const count = g.reduce((n, y) => n + y.list.length, 0);
        const cluster = g.length > 1;
        const label = cluster ? S.personPage.chart.hist.cluster(count)
            : [...new Set(g[0].list.map(h => kinds[h.kind] ?? h.kind))].join(', ');
        return {
            x: g[0].x, scope: g[0].lead.scope, anchor: g[0].lead.anchor, count, cluster, label,
            title: g.flatMap(y => y.list.map(h => `${y.year} ${h.text}`)).join('; '),
        };
    });
}

/**
 * Where the glyphs' labels go (round 3 §2.4, wide sets only): left to right,
 * from 5 px left of the glyph (kept inside the width), on the first of two
 * lines with 6 px free after the line's previous label; a label with room on
 * neither is left out (the glyph keeps its title). `null`: no label.
 */
export function historyLabelLanes(glyphs: readonly Pick<ChartHistGlyph, 'x' | 'label'>[], W: number): ({ left: number; lane: number; width: number } | null)[] {
    const ends = HIST_LANES.map(() => -Infinity);
    return glyphs.map(g => {
        const width = g.label.length * HIST_CH_PX + 4;
        const left = Math.max(0, Math.min(W - width, g.x - 5));
        const lane = ends.findIndex(e => left >= e + 6);
        if (lane < 0) return null;
        ends[lane] = left + width;
        return { left, lane, width };
    });
}

function historyRow(items: readonly ChartHistory[], S: CS, xpx: (y: number) => number, x: (y: number) => string,
    wpc: (a: number, b: number) => string, narrow: boolean, W: number): string {
    let html = '';
    // Events of more years: a 6 px bar on a line of its own at the top, its label above it only when it fits (wide).
    const bars = items.filter(i => i.to !== undefined && i.to - i.from > 1);
    let barLabels = false;
    const kinds = S.history.kinds as Record<string, string>;
    for (const h of bars) {
        const label = narrow ? '' : (kinds[h.kind] ?? h.kind);
        const fits = !!label && xpx(h.to! + 1) - xpx(h.from) >= label.length * HIST_CH_PX + 4;
        if (fits) barLabels = true;
        html += `<a class="pp-ch-hbar" href="#${h.anchor}" data-pp-osa="${h.anchor}" style="left:${x(h.from)};width:${wpc(h.from, h.to! + 1)}" title="${esc(`${h.from}–${h.to} ${h.text}`)}">`
            + `${fits ? `<span class="pp-ch-hbl" aria-hidden="true">${esc(label)}</span>` : ''}</a>`;
    }
    // Point events: a glyph a year, near ones clustered with the count; their labels in two lines (wide only).
    const glyphs = historyGlyphs(items, S, xpx, narrow ? HIST_CLUSTER_PX_NARROW : HIST_CLUSTER_PX);
    const pc = (n: number): string => `${(Math.round((n / W) * 10000) / 100).toString()}%`;
    for (const g of glyphs) {
        const glyph = g.scope === 'local' ? '■' : g.scope === 'place' ? '▲' : '◇';
        html += `<a class="pp-ch-hm pp-ch-hm--${g.scope}${g.cluster ? ' pp-ch-hm--c' : ''}" href="#${g.anchor}" data-pp-osa="${g.anchor}" style="left:${pc(g.x)}" title="${esc(g.title)}">`
            + `<span class="pp-ch-hg">${glyph}</span>${g.cluster ? `<span class="pp-ch-hn">${g.count}</span>` : ''}</a>`;
    }
    if (!narrow) {
        historyLabelLanes(glyphs, W).forEach((l, i) => {
            if (!l) return;
            const g = glyphs[i];
            html += `<span class="pp-ch-hl${g.cluster ? ' pp-ch-hl--c' : ''}" aria-hidden="true" style="left:${pc(l.left)};top:${HIST_LANES[l.lane]}px">${esc(g.label)}</span>`;
        });
    }
    return `<div class="pp-ch-row pp-ch-hist${narrow ? ' pp-ch-hist--n' : ''}${barLabels ? ' pp-ch-hist--bl' : ''}">${html}</div>`;
}

function legendHtml(input: LifeChartInput, S: CS): string {
    const L = S.personPage.chart.legend;
    const items: string[] = [];
    const sw = (cls: string, text: string) => `<span class="pp-ch-lg"><span class="pp-ch-sw ${cls}" aria-hidden="true"></span>${esc(text)}</span>`;
    const kinds = new Set(input.periods.map(p => p.kind));
    // The neutral bar is explained when some period is unknown (a union without a marriage date).
    if (kinds.has('life') && (input.periods.length > 1 || input.periodsUnknown)) items.push(sw('pp-ch-p--life', L.life));
    if (input.periods.length > 1) {
        if (kinds.has('youth')) items.push(sw('pp-ch-p--youth', L.youth));
        if (kinds.has('marriage') || kinds.has('partnership')) items.push(sw('pp-ch-p--marriage', L.married));
        if (kinds.has('widowed') || kinds.has('divorced')) items.push(sw('pp-ch-p--widowed', L.widowed));
    }
    if (input.residence.length) items.push(sw('pp-ch-res--1', L.residence));
    if (input.lines.some(l => l.kind === 'partner')) {
        const g = input.gender === 'male' ? 'm' : input.gender === 'female' ? 'f' : 'u';
        items.push(sw('pp-ch-sw--partner', L.spouses[g]));
    }
    if (input.lines.some(l => l.kind === 'child')) items.push(`<span class="pp-ch-kid-lg">${sw('pp-ch-sw--child', L.children)}</span>`);
    return items.length ? `<p class="pp-legend pp-chart-legend">${items.join('')}</p>` : '';
}
