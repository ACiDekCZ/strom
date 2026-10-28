/**
 * History in the life timeline (spec 020, the person card's layer): the
 * research's events of the time between the person's own rows, the "History"
 * chip with its legend, the "⋯" menu that hides an event (in the whole tree
 * or for the person only), "Hidden: n" with "Show again", and the state row.
 *
 * The data, the hidings and the bridge are history-ui.ts; the pure model is
 * src/history.ts. With the layer off historyForPerson() says null and
 * nothing here touches the card.
 *
 * What is open (a year's cluster, an excerpt, the hidden list) is remembered
 * only while the card stays open.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { lifelineChips, setLifelineChip } from '../lifeline-view.js';
import { DataManager } from '../data.js';
import { shownName } from '../person-name.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import {
    groupHistoryByYear, historyClusterLabel, historySourceLabel, isHistoryLang,
    type LifelineHistoryItem, type HiddenHistoryItem, type PersonHistory, type HistoryEvent, type HistoryFindRegion, type HistoryPlaceRow,
} from '../history.js';
import { regionName, manageCan } from '../history-manage.js';
import { postBridgeFirst, postBridgeSkip, type HistoryWriteRefusal } from '../history-bridge.js';
import { HISTORY_SKIP_FEATURE } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { shownExcerpts } from '../research-images.js';
import { excerptImageUrl } from '../excerpts.js';
import type { Source } from '../types.js';
import type { PersonHistoryView, HistoryHideScope } from './history-ui.js';
import { uiModule } from './module.js';

/** A year group of the layer, ready to go between the person's rows. */
export interface LifelineHistoryGroupHtml {
    year: number;
    html: string;
}

/** What the layer adds to the person's timeline. */
export interface LifelineHistoryLayer {
    groups: LifelineHistoryGroupHtml[];
    /** The state row and "Hidden: n", after everything. */
    tail: string;
    /** A row says a range of years (the wider year column). */
    ranges: boolean;
}

// ─── Card memory (forgotten when another card opens) ────────────────────────

const openYears = new Set<number>();
const openQuotes = new Set<string>();
let hiddenOpen = false;
/** The rows drawn last, by the index their buttons carry. */
let rowItems: LifelineHistoryItem[] = [];
let rowHidden: HiddenHistoryItem[] = [];

/** §5: what the card said after "Find the history of …", by region (kept across cards: it is the research's answer). */
const findNotes = new Map<string, { text: string; link?: { label: string; run: () => void } }>();
/** §5: regions whose "first" is on its way (the link inactive; `slow`: after 300 ms it says "…"). */
const findBusy = new Map<string, { slow: boolean }>();
/** §5: regions done meanwhile (409 history.done): no offer until the copy says otherwise. */
const findGone = new Set<string>();

/** The timeline bodies with the layer's listeners (a mark in the DOM would change the card). */
const boundBodies = new WeakSet<HTMLElement>();
/** The open "⋯" menu or legend popover (not the bottom sheets: those are this.bottomSheet). */
let popup: { el: HTMLElement; anchor: HTMLElement; off: () => void } | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function media(query: string): boolean {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** ` lang="…"` for a text in another language than the UI's (a valid code only). */
function langAttr(code: string | undefined): string {
    return code && code !== getCurrentLanguage() && isHistoryLang(code) ? ` lang="${esc(code)}"` : '';
}

function formatDate(iso: string | undefined): string {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return '';
    return new Intl.DateTimeFormat(getCurrentLanguage(), { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(t));
}

/** The tree's source a local event cites (by its REFN), if the tree has it. */
function citedSource(refn: string): Source | undefined {
    const sources = DataManager.getData().sources ?? {};
    return Object.values(sources).find(s => s.refn === refn);
}

function closePopup(focusAnchor: boolean): void {
    if (!popup) return;
    const { el, anchor, off } = popup;
    popup = null;
    off();
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (focusAnchor && anchor.isConnected) anchor.focus();
}

/** What an event's row shows besides the event itself (the card and the manager's detail). */
export interface HistoryDescOptions {
    /** Meta after the kind's label (age, region; in the manager place and audience), as HTML. */
    meta: string[];
    quoteOpen: boolean;
    /** Attributes of the citation's button (a local event whose source the tree has). */
    cite: string;
    /** Attributes of the "excerpt ▸" button. */
    quote: string;
    /** "text in German" by a text in another language than the UI's. */
    langBadge?: boolean;
    /** HTML after the tip (a hiding's sentence, an error). */
    tail?: string;
}

/**
 * The text and meta of an event's row (DEV 020 §3): text, kind · meta ·
 * source ↗ · citation · "excerpt ▸", the excerpt, the tip. Shared by the
 * person card's layer and the manager's detail.
 */
export function historyEventDescHtml(ev: HistoryEvent, t: { text: string; textLang: string; tip?: string; tipLang?: string }, o: HistoryDescOptions): string {
    const h = strings.history;
    const tag = ev.scope === 'local' ? h.local : h.kinds[ev.kind];
    const meta: string[] = [`<span class="pm-lifeline-htag">${esc(tag)}</span>`, ...o.meta];
    const source = ev.source;
    const checked = formatDate(source?.checked);
    if (source) {
        const title = [source.title, checked ? h.sourceChecked(checked) : ''].filter(Boolean).join(' · ');
        meta.push(`<span class="pm-lifeline-hsrc">${esc(h.source)}&nbsp;<a href="${esc(source.url)}" target="_blank" rel="noopener"`
            + ` title="${esc(title)}" data-hfocus="src:${esc(ev.id)}"><span class="pm-lifeline-hsrc-name">${esc(historySourceLabel(source))}</span>&nbsp;↗</a></span>`);
    }
    if (ev.local) {
        // The tree has the cited source: its clip (or scan) opens; else only the citation's text.
        meta.push(citedSource(ev.local.source)
            ? `<span class="pm-lifeline-hsrc"><button type="button" class="pm-lifeline-link is-cite" ${o.cite}>${esc(ev.local.cite)}</button></span>`
            : `<span class="pm-lifeline-hsrc">${esc(ev.local.cite)}</span>`);
    }
    const quoteOpen = !!source?.quote && o.quoteOpen;
    if (source?.quote) {
        meta.push(`<button type="button" class="pm-lifeline-hquote" aria-expanded="${quoteOpen}" ${o.quote}>`
            + `${esc(h.quote)} <span aria-hidden="true">${quoteOpen ? '▾' : '▸'}</span></button>`);
    }
    const other = o.langBadge && t.textLang && t.textLang !== getCurrentLanguage();
    let desc = `<span class="pm-lifeline-htext"${langAttr(t.textLang)}>${esc(t.text)}`
        + (other ? ` <span class="pm-lifeline-hlang">${esc(h.textLang(t.textLang))}</span>` : '') + '</span>'
        + `<span class="pm-lifeline-hmeta">${meta.join('')}</span>`;
    if (quoteOpen && source?.quote) {
        desc += `<span class="pm-lifeline-hquotebox"><span class="pm-lifeline-hquotetext"${langAttr(source.lang)}>${esc(h.quoted(source.quote))}</span>`
            + `<span class="pm-lifeline-hquotefrom">${esc(h.quoteFrom(historySourceLabel(source), checked || undefined))}</span></span>`;
    }
    if (t.tip) {
        desc += `<span class="pm-lifeline-htip"><b>${esc(h.tip)}:</b> <span${langAttr(t.tipLang)}>${esc(t.tip)}</span></span>`;
    }
    return desc + (o.tail ?? '');
}

export const historyCardMethods = uiModule({
    /** A new card: nothing of the layer stays open. */
    resetLifelineHistoryMemory(): void {
        openYears.clear();
        openQuotes.clear();
        hiddenOpen = false;
        this.closeLifelineHistoryPopups();
    },

    /** The "⋯" menu and the legend close (the card closes, the chip goes). */
    closeLifelineHistoryPopups(): void {
        closePopup(false);
    },

    /** The card closes: a hiding's toast lifted over its footer goes back to its place. */
    dropLifelineHistoryToastLift(): void {
        const toast = document.querySelector<HTMLElement>('.toast[data-kind="history-hide"]');
        if (toast) toast.style.bottom = '';
    },

    /**
     * The head's "History" chip and its "i": there whenever the layer has
     * something to say for the tree (`view` not null), else the head exactly
     * as it was. Both chips then share a wrapper, so they wrap together.
     */
    syncLifelineHistoryChip(view: PersonHistoryView | null): void {
        const head = document.getElementById('pm-lifeline-head');
        const child = document.getElementById('pm-lifeline-child-toggle');
        if (!head || !child) return;
        let wrap = head.querySelector<HTMLElement>('.pm-lifeline-chips');
        if (!view) {
            if (wrap) {
                wrap.replaceWith(child);
                head.classList.remove('has-history');
            }
            closePopup(false);
            return;
        }
        const h = strings.history;
        if (!wrap) {
            wrap = document.createElement('span');
            wrap.className = 'pm-lifeline-chips';
            child.replaceWith(wrap);
            wrap.appendChild(child);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.id = 'pm-lifeline-history-toggle';
            chip.className = 'pm-lifeline-childtoggle';
            chip.setAttribute('role', 'switch');
            chip.innerHTML = '<span class="pm-lifeline-childtoggle-box" aria-hidden="true"></span><span class="pm-lifeline-history-label"></span>';
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleLifelineHistory(!lifelineChips(DataManager.getCurrentTreeId()).history);
            });
            chip.addEventListener('keydown', (e) => e.stopPropagation());
            const info = document.createElement('button');
            info.type = 'button';
            info.className = 'pm-lifeline-hinfo';
            info.setAttribute('aria-expanded', 'false');
            info.textContent = 'i';
            info.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleLifelineHistoryLegend(info);
            });
            info.addEventListener('keydown', (e) => e.stopPropagation());
            wrap.append(chip, info);
            head.classList.add('has-history');
        }
        const chip = wrap.querySelector<HTMLElement>('#pm-lifeline-history-toggle');
        const info = wrap.querySelector<HTMLElement>('.pm-lifeline-hinfo');
        if (chip) {
            chip.setAttribute('aria-checked', String(view.chipOn));
            const label = chip.querySelector('.pm-lifeline-history-label');
            if (label) label.textContent = h.chip;
        }
        if (info) {
            info.setAttribute('aria-label', h.legendButton);
            info.hidden = !view.chipOn;
            if (!view.chipOn && popup?.anchor === info) closePopup(false);
        }
    },

    /** The layer's rows for a person's history (the chip on). */
    lifelineHistoryLayer(history: PersonHistory): LifelineHistoryLayer {
        const h = strings.history;
        rowItems = [];
        rowHidden = [];
        // A phone held sideways: every year folded, even a single event.
        const compact = media(MQ_PHONE_LANDSCAPE);
        const groups = groupHistoryByYear(history.items, compact).map(g => {
            if (!g.cluster) return { year: g.year, html: this.lifelineHistoryRowHtml(g.items[0], true) };
            const open = openYears.has(g.year);
            const single = g.items.length === 1 ? g.items[0] : null;
            const label = historyClusterLabel(g.items, getCurrentLanguage(), open);
            const year = single?.yearLabel ?? String(g.year);
            let html = `<div class="pm-lifeline-row k-historyGroup is-${g.mark}" role="button" tabindex="0" aria-expanded="${open}"`
                + ` data-history-year="${g.year}" data-hfocus="group:${g.year}">`
                + '<span class="pm-lifeline-hmark" aria-hidden="true"></span>'
                + `<span class="pm-lifeline-year">${esc(year)}</span>`
                + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
                + `<span class="pm-lifeline-desc"${single && !open ? langAttr(single.textLang) : ''}>${esc(label)}</span>`
                + `<span class="pm-lifeline-hchev" aria-hidden="true">${open ? '▾' : '▸'}</span></div>`;
            if (open) html += g.items.map(i => this.lifelineHistoryRowHtml(i, false)).join('');
            return { year: g.year, html };
        });

        let tail = '';
        const stateRow = (text: string, extra = ''): string =>
            '<div class="pm-lifeline-row k-historyState is-region">'
            + '<span class="pm-lifeline-hmark" aria-hidden="true"></span><span class="pm-lifeline-year"></span>'
            + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
            + `<span class="pm-lifeline-desc">${esc(text)}${extra}</span></div>`;
        const st = history.state;
        const find = this.lifelineHistoryFindRow(history.find ?? [], stateRow);
        switch (st.kind) {
            case 'events': if (st.somePending) tail += find || stateRow(h.stateSomePending); break;
            case 'noPlace': tail += stateRow(h.stateNoPlace); break;
            case 'waiting': tail += stateRow(h.statusWaiting(st.why)); break;
            case 'noSearch':
                tail += stateRow(h.stateNoSearch, st.link
                    ? ` <button type="button" class="link pm-lifeline-henable" data-hfocus="enable">${esc(h.enableSearch)}</button>` : '');
                break;
            case 'searching': tail += find || stateRow(h.stateSearching); break;
            case 'none': tail += stateRow(h.stateNone); break;
            // 9 (all hidden): only "Hidden: n"; 11 (incomplete, a place missing): nothing.
            default: break;
        }
        // §6a: the main place's own history, only when §5 offers nothing.
        if (!find && history.placeRow) tail += this.lifelineHistoryPlaceRow(history.placeRow);
        if (history.hidden.length) {
            rowHidden = history.hidden;
            const items = history.hidden.map((item, j) => {
                const by = item.hiddenBy;
                const scope = by.region && !by.event ? h.scopeRegion(regionName(item.ev.region?.id === by.region ? item.ev.region : { id: by.region }, getCurrentLanguage()))
                    : by.tree ? h.hiddenScopeTree
                        : by.place ? h.scopePlace(item.place) : h.scopePerson;
                return '<div class="pm-lifeline-hiddenitem">'
                    + `<span class="pm-lifeline-year">${esc(item.yearLabel ?? String(item.year))}</span>`
                    + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
                    + `<span class="pm-lifeline-hiddentext"><span${langAttr(item.textLang)}>${esc(item.text)}</span>`
                    + `<small>${esc(scope)} · <button type="button" class="link pm-lifeline-hrestore" data-restore="${j}"`
                    + ` data-hfocus="restore:${esc(item.ev.id)}">${esc(h.restore)}</button></small></span></div>`;
            }).join('');
            tail += `<button type="button" class="pm-lifeline-hidden" aria-expanded="${hiddenOpen}" data-hfocus="hidden">`
                + `${esc(h.hiddenCount(history.hidden.length))} <span aria-hidden="true">${hiddenOpen ? '▾' : '▸'}</span></button>`
                + `<div class="pm-lifeline-hiddenlist"${hiddenOpen ? '' : ' hidden'}>`
                + `<p class="pm-lifeline-hiddennote">${esc(h.hiddenNote)}</p>${items}`
                + (this.historyManageAvailable()
                    ? `<button type="button" class="pm-lifeline-hall" data-hfocus="allHidden">${esc(h.allHidden)} ›</button>` : '')
                + '</div>';
        }
        return { groups, tail, ranges: history.items.some(i => !!i.yearLabel) };
    },

    /**
     * §5: the last row offering "Find the history of {region}" for the region
     * with most of the person's facts ('' none): one region, several (the
     * first one's link + "More in the manager ›"), on a phone one short line;
     * a region asked first already or answered says the answer instead.
     */
    lifelineHistoryFindRow(regions: readonly HistoryFindRegion[], stateRow: (text: string, extra?: string) => string): string {
        const list = regions.filter(r => !findGone.has(r.id));
        const top = list[0];
        if (!top) return '';
        const h = strings.history;
        const name = (id: string) => this.historyCardRegionName(id);
        const note = findNotes.get(top.id);
        if (note) {
            return stateRow(note.text, note.link
                ? ` <button type="button" class="link pm-lifeline-hfind-note" data-hfocus="findNote:${esc(top.id)}" data-find-note="${esc(top.id)}">${esc(note.link.label)}</button>` : '');
        }
        if (top.first) return stateRow(h.firstDone(name(top.id), this.historyCardPace()));
        const busy = findBusy.get(top.id);
        const link = (label: string) => `<button type="button" class="link pm-lifeline-hfind" data-hfocus="find" data-find="${esc(top.id)}"`
            + `${busy ? ' aria-disabled="true"' : ''}>${esc(label)}${busy?.slow ? '…' : ''}</button>`;
        if (media(MQ_MOBILE)) {
            // One line: the sentence ellipsized, the link whole.
            return '<div class="pm-lifeline-row k-historyState is-region is-find-one">'
                + '<span class="pm-lifeline-hmark" aria-hidden="true"></span><span class="pm-lifeline-year"></span>'
                + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
                + `<span class="pm-lifeline-desc"><span class="pm-lifeline-hfind-text">${esc(h.findShort(name(top.id)))}</span>${link(h.findShortLink)}</span></div>`;
        }
        if (list.length === 1) return stateRow(h.findOne(name(top.id)), ` ${link(h.findRegion(name(top.id)))}`);
        return stateRow(h.findMany(name(list[0].id), name(list[1].id), list.length - 2),
            ` ${link(h.findRegion(name(top.id)))} <button type="button" class="link pm-lifeline-hfind-more" data-hfocus="findMore">· ${esc(h.findMore)} ›</button>`);
    },

    /**
     * Spec 020 K1.6: the last row of a timeline without the layer when the
     * research does not search yet — the sentence, "Turn on the search in the
     * research" and a close button ('' none). A phone: one line, the sentence
     * ellipsized, the link whole.
     */
    lifelineHistoryStripHtml(): string {
        if (!this.historyStripWanted()) return '';
        const h = strings.history;
        // A phone: the short sentence and link, as the find row (§5).
        const phone = media(MQ_MOBILE);
        return `<div class="pm-lifeline-row k-historyState is-region is-strip${phone ? ' is-find-one' : ''}" data-history-strip="">`
            + '<span class="pm-lifeline-hmark" aria-hidden="true"></span><span class="pm-lifeline-year"></span>'
            + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
            + `<span class="pm-lifeline-desc"><span class="pm-lifeline-hfind-text">${esc(phone ? h.stripShort : h.stripNoSearch)}</span>`
            + ` <button type="button" class="link pm-lifeline-henable pm-lifeline-hstrip-on" data-hfocus="stripOn">${esc(phone ? h.stripShortLink : h.enableSearch)}</button></span>`
            + `<button type="button" class="pm-lifeline-hstrip-close" data-hfocus="stripClose" aria-label="${esc(h.stripClose)}" title="${esc(h.stripClose)}">`
            + '<span aria-hidden="true">×</span></button></div>';
    },

    /** The strip's link and close button (the body is redrawn whole, so no listener stays behind). */
    bindLifelineHistoryStrip(body: HTMLElement): void {
        const strip = body.querySelector<HTMLElement>('[data-history-strip]');
        if (!strip) return;
        strip.querySelector('.pm-lifeline-hstrip-on')?.addEventListener('click', () => this.historyEnableSearch());
        strip.querySelector('.pm-lifeline-hstrip-close')?.addEventListener('click', () => {
            this.closeHistoryStrip();
            document.getElementById('pm-lifeline-head')?.focus({ preventScroll: true });
        });
    },

    /**
     * §6a.2 / §6a.4 (M1, M5): the last row for the person's main place — the
     * offer "… not looked for yet" + "Find local history…" (a phone: one
     * line), or the state of its own history.
     */
    lifelineHistoryPlaceRow(row: HistoryPlaceRow): string {
        const h = strings.history;
        const line = (inner: string, cls = ''): string =>
            `<div class="pm-lifeline-row k-historyState is-place is-place-row${cls}" data-place-row="${esc(row.kind)}">`
            + '<span class="pm-lifeline-hmark" aria-hidden="true"></span><span class="pm-lifeline-year"></span>'
            + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
            + `<span class="pm-lifeline-desc">${inner}</span></div>`;
        switch (row.kind) {
            case 'offer': {
                const link = (label: string) => `<button type="button" class="link pm-lifeline-hfind pm-lifeline-hplace" data-hfocus="placeFind"`
                    + ` data-place-find="${esc(row.key)}" aria-haspopup="dialog">${esc(label)}</button>`;
                if (media(MQ_MOBILE)) {
                    return line(`<span class="pm-lifeline-hfind-text">${esc(h.placeOfferShort(row.name))}</span> ${link(h.placeFindShort)}`, ' is-find-one');
                }
                return line(`${esc(h.placeOffer(row.name))} ${link(h.placeFind)}`);
            }
            case 'first': return line(esc(h.placeFirst(row.name)));
            case 'running': return line(esc(h.placeRunning(row.name)));
            case 'empty': return line(esc(h.placeEmpty(row.name)));
            case 'waiting': return line(esc(h.statusWaiting(row.why)));
        }
    },

    /** §6a.1: the place of an event of a place's own history (its name in the UI language, else the tree's spelling). */
    historyCardPlaceName(item: LifelineHistoryItem): string {
        const n = item.ev.place?.name;
        return (n && (n[getCurrentLanguage()] || n.en || Object.values(n).find(Boolean))) || item.place;
    },

    /** A region's name in the UI language from the open tree's copy (its id when unnamed). */
    historyCardRegionName(id: string): string {
        const p = this.historyManageContext()?.payload;
        const r = p?.regions?.[id] ?? p?.events.find(e => e.region?.id === id)?.region ?? { id };
        return regionName(r, getCurrentLanguage());
    },

    /** "about every 5th research session" by the research's pace ('' not said). */
    historyCardPace(): string {
        const h = strings.history;
        const pace = this.historyManageContext()?.status?.historyPace;
        return pace === 'rare' ? h.firstPaceRare : pace === 'idle' ? h.firstPaceIdle : pace ? h.firstPaceSometimes : '';
    },

    /** §5.2: `POST /history/first {region}` from the card; the answer in the last row. */
    async lifelineHistoryFind(region: string): Promise<void> {
        const ctx = this.historyManageContext();
        if (!ctx?.base || findBusy.has(region)) return;
        const h = strings.history;
        const rid = ctx.researchId;
        const busy = { slow: false };
        findBusy.set(region, busy);
        findNotes.delete(region);
        this.historyChanged();
        const slow = setTimeout(() => { busy.slow = true; this.historyChanged(); }, 300);
        const before = this.researchHeadNow(rid);
        const scheme = announcedResearchScheme();
        const r = await postBridgeFirst(ctx.base, region, ctx.features, { tree: rid, ...(scheme ? { scheme } : {}) });
        clearTimeout(slow);
        findBusy.delete(region);
        if (r.ok) {
            findNotes.set(region, { text: h.firstDone(this.historyCardRegionName(region), this.historyCardPace()) });
            this.historyManageWritten(rid, before, r);
        } else {
            this.lifelineHistoryFindRefused(rid, region, r);
        }
        this.historyChanged();
    },

    /** §5.2's refusals: off with the link to switch it on, archive, done (the offer goes), places still matched, skipped, busy. */
    lifelineHistoryFindRefused(rid: string, region: string, r: HistoryWriteRefusal): void {
        const h = strings.history;
        const ctx = this.historyManageContext();
        const reread = () => { void this.readBridgeHistory(rid); };
        if (r.code === 'off') {
            const can = !!r.link || !!ctx?.canLinkOn;
            findNotes.set(region, {
                text: h.manageOff,
                ...(can ? { link: { label: h.enableSearch, run: () => (r.link ? this.launchResearchLink(r.link, 'terminal') : this.historyEnableSearch()) } } : {}),
            });
        } else if (r.code === 'archive') {
            findNotes.set(region, { text: h.findArchive(r.reason) });
        } else if (r.code === 'done') {
            findGone.add(region);
            reread();
        } else if (r.code === 'gone' && r.bridgeCode === 'history.region') {
            findNotes.set(region, { text: h.findMapping });
        } else if (r.code === 'skipped') {
            // Skipped meanwhile: "Search again" first (the bridge never undoes the choice itself).
            const canSkip = !!ctx?.base && ctx.features.includes(HISTORY_SKIP_FEATURE);
            findNotes.set(region, {
                text: h.toastSkipped(this.historyCardRegionName(region)),
                ...(canSkip ? { link: { label: h.searchAgain, run: () => { void this.lifelineHistorySearchAgain(region); } } } : {}),
            });
            reread();
        } else if (r.code === 'busy') {
            findNotes.set(region, { text: h.errBusy });
        } else {
            findNotes.set(region, { text: r.reason || (r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed) });
        }
    },

    /** "Search again" of a region skipped meanwhile (`/history/skip do:"undo"`); then the offer is back. */
    async lifelineHistorySearchAgain(region: string): Promise<void> {
        const ctx = this.historyManageContext();
        if (!ctx?.base || findBusy.has(region)) return;
        findBusy.set(region, { slow: false });
        const before = this.researchHeadNow(ctx.researchId);
        const r = await postBridgeSkip(ctx.base, { region, do: 'undo' }, ctx.features);
        findBusy.delete(region);
        if (r.ok) {
            findNotes.delete(region);
            this.historyManageWritten(ctx.researchId, before, r);
        } else {
            this.lifelineHistoryFindRefused(ctx.researchId, region, r);
        }
        this.historyChanged();
    },

    /** One event of the layer (§2.3): text, label · age · region · source, excerpt, tip, "⋯". */
    lifelineHistoryRowHtml(item: LifelineHistoryItem, showYear: boolean): string {
        const h = strings.history;
        const ev = item.ev;
        const i = rowItems.push(item) - 1;
        const meta: string[] = [];
        if (item.age) meta.push(`<span>${esc(item.age)}</span>`);
        if (ev.scope === 'place') meta.push(`<span class="pm-lifeline-hregion pm-lifeline-hplace-name">${esc(strings.history.placeAround(this.historyCardPlaceName(item)))}</span>`);
        else if (item.regionLabel) meta.push(`<span class="pm-lifeline-hregion">${esc(item.regionLabel)}</span>`);
        const desc = historyEventDescHtml(ev, item, {
            meta, quoteOpen: openQuotes.has(ev.id),
            cite: `data-cite="${i}" data-hfocus="cite:${esc(ev.id)}"`,
            quote: `data-quote="${i}" data-hfocus="quote:${esc(ev.id)}"`,
        });
        // A range keeps its years inside an open cluster too; a single year is the cluster's.
        const year = showYear ? item.yearLabel ?? String(item.year) : item.yearLabel ?? '';
        return `<div class="pm-lifeline-row k-history is-${ev.scope}" data-history-id="${esc(ev.id)}">`
            + '<span class="pm-lifeline-hmark" aria-hidden="true"></span>'
            + `<span class="pm-lifeline-year">${esc(year)}</span>`
            + '<span class="pm-lifeline-glyph" aria-hidden="true"></span>'
            + `<span class="pm-lifeline-desc">${desc}</span>`
            + `<button type="button" class="pm-lifeline-hmore" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(h.more)}"`
            + ` data-more="${i}" data-hfocus="more:${esc(ev.id)}">⋯</button>`
            + '</div>';
    },

    /** The layer's buttons in the timeline's body (bound once; the rows come and go). */
    bindLifelineHistory(body: HTMLElement): void {
        if (boundBodies.has(body)) return;
        boundBodies.add(body);
        const redraw = (): void => {
            if (this.currentId) this.renderPersonLifeline(this.currentId, true);
        };
        body.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const more = target.closest<HTMLElement>('[data-more]');
            if (more) {
                e.stopPropagation();
                this.showLifelineHistoryMenu(Number(more.dataset.more), more);
                return;
            }
            const cite = target.closest<HTMLElement>('[data-cite]');
            if (cite) {
                e.stopPropagation();
                const item = rowItems[Number(cite.dataset.cite)];
                if (item) this.openLifelineHistoryCite(item);
                return;
            }
            const quote = target.closest<HTMLElement>('[data-quote]');
            if (quote) {
                const id = rowItems[Number(quote.dataset.quote)]?.ev.id;
                if (id && !openQuotes.delete(id)) openQuotes.add(id);
                redraw();
                return;
            }
            if (target.closest('.pm-lifeline-hidden')) {
                hiddenOpen = !hiddenOpen;
                redraw();
                return;
            }
            const restore = target.closest<HTMLElement>('[data-restore]');
            if (restore) {
                const item = rowHidden[Number(restore.dataset.restore)];
                if (item) this.restoreHistoryItem(item);
                return;
            }
            if (target.closest('.pm-lifeline-hall')) {
                this.openHistoryManageFrom('hidden');
                return;
            }
            if (target.closest('.pm-lifeline-henable')) {
                this.historyEnableSearch();
                return;
            }
            const find = target.closest<HTMLElement>('[data-find]');
            if (find) {
                if (find.getAttribute('aria-disabled') !== 'true') void this.lifelineHistoryFind(find.dataset.find ?? '');
                return;
            }
            const placeFind = target.closest<HTMLElement>('[data-place-find]');
            if (placeFind) {
                this.openHistoryPlaceFind(placeFind.dataset.placeFind ?? '');
                return;
            }
            const findNote = target.closest<HTMLElement>('[data-find-note]');
            if (findNote) {
                findNotes.get(findNote.dataset.findNote ?? '')?.link?.run();
                return;
            }
            if (target.closest('.pm-lifeline-hfind-more')) {
                this.openHistoryManage({ tab: 'regions' });
                return;
            }
            const group = target.closest<HTMLElement>('.k-historyGroup');
            if (group && !target.closest('a, button')) this.toggleLifelineHistoryYear(Number(group.dataset.historyYear));
        });
        body.addEventListener('keydown', (e: KeyboardEvent) => {
            const group = (e.target as HTMLElement).closest<HTMLElement>('.k-historyGroup');
            if (!group || e.target !== group) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleLifelineHistoryYear(Number(group.dataset.historyYear));
            }
        });
    },

    /** A year's cluster folds or unfolds (remembered while the card is open). */
    toggleLifelineHistoryYear(year: number): void {
        if (!Number.isFinite(year)) return;
        if (!openYears.delete(year)) openYears.add(year);
        if (this.currentId) this.renderPersonLifeline(this.currentId, true);
    },

    /**
     * The open card brought to an event's row (the manager's "who sees it"):
     * the layer on, its year's cluster unfolded, the row in view and lit for
     * 1.5 s.
     */
    highlightHistoryEvent(id: string): void {
        const personId = this.currentId;
        if (!personId) return;
        const view = this.historyForPerson(personId);
        const item = view?.history?.items.find(i => i.ev.id === id);
        if (!view || !item) return;
        if (!view.chipOn) setLifelineChip(DataManager.getCurrentTreeId(), 'history', true);
        openYears.add(item.year);
        this.renderPersonLifeline(personId, true);
        const row = document.querySelector<HTMLElement>(`#pm-lifeline-body .pm-lifeline-row[data-history-id="${CSS.escape(id)}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center' });
        row.classList.add('is-flash');
        setTimeout(() => row.classList.remove('is-flash'), 1500);
    },

    /** A local event's citation: its clip in the image viewer (or the source's scan, or the source). */
    openLifelineHistoryCite(item: LifelineHistoryItem): void {
        const local = item.ev.local;
        const src = local ? citedSource(local.source) : undefined;
        if (!local || !src) return;
        const excerpts = shownExcerpts(DataManager.getCurrentTreeId(), src);
        const exc = (local.clip ? excerpts.find(x => x.clip === local.clip) : undefined) ?? excerpts[0];
        if (exc) this.showImageOverlay(excerptImageUrl(exc));
        else this.showSourceViewer(src.id, null, { readOnly: true });
    },

    /**
     * "⋯" of an event: hide it in this whole tree (spec 020 K4.1a; a research
     * with `history.hide.all`) or for this person only. Not for a place: that
     * is History of places' (an earlier hiding at a place stays in "Hidden"
     * and can be shown again). A menu by the row; on a phone a bottom sheet
     * with "Cancel". No confirmation; a locked tree may hide too.
     */
    showLifelineHistoryMenu(index: number, anchor: HTMLElement): void {
        const item = rowItems[index];
        const personId = this.currentId;
        if (!item || !personId) return;
        if (popup?.anchor === anchor) { closePopup(true); return; }
        closePopup(false);
        const h = strings.history;
        const person = DataManager.getPerson(personId);
        const name = person ? shownName(person) : '';
        const head = `${item.yearLabel ?? item.year} · ${item.text}`;
        const ctx = this.historyManageContext();
        const treeOn = !!ctx && manageCan({ features: ctx.features, bridgeUp: !!ctx.status }, 'hideAll');
        const rows: { scope: HistoryHideScope; label: string; hint: string }[] = [
            ...(treeOn ? [{ scope: 'tree' as const, label: h.hideTreeCard, hint: h.hideTreeCardHint }] : []),
            { scope: 'person', label: h.hidePerson(name), hint: h.hidePersonHint },
        ];
        const run = (scope: HistoryHideScope): void => this.hideHistoryItem(personId, item, scope);

        if (media(MQ_MOBILE)) {
            const items = rows.map(r => `<button type="button" role="menuitem" class="bottom-sheet-item pm-lifeline-hsheet-item" data-scope="${r.scope}">`
                + `<span class="pm-lifeline-hmenu-label">${esc(r.label)}</span><span class="pm-lifeline-hmenu-hint">${esc(r.hint)}</span></button>`).join('');
            const sheet = this.showLifelineHistorySheet('pm-lifeline-hmenu-sheet', 'menu', head,
                `<div class="pm-lifeline-hsheet-head">${esc(head)}</div><div class="bottom-sheet-items">${items}</div>`
                + `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel">${esc(strings.buttons.cancel)}</button>`);
            sheet.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const row = target.closest<HTMLElement>('[data-scope]');
                if (row) {
                    this.hideBottomSheet();
                    run(row.dataset.scope as HistoryHideScope);
                } else if (target.closest('.pm-lifeline-hsheet-cancel')) {
                    this.hideBottomSheet();
                }
            });
            sheet.addEventListener('keydown', (e) => this.lifelineHistoryMenuKeys(e, sheet));
            sheet.querySelector<HTMLElement>('[data-scope]')?.focus({ preventScroll: true });
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'pm-lifeline-hmenu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', head);
        menu.innerHTML = `<div class="pm-lifeline-hmenu-head" role="presentation">${esc(head)}</div>`
            + rows.map(r => `<button type="button" role="menuitem" class="pm-lifeline-hmenu-item" data-scope="${r.scope}">`
                + `<span class="pm-lifeline-hmenu-label">${esc(r.label)}</span><span class="pm-lifeline-hmenu-hint">${esc(r.hint)}</span></button>`).join('');
        menu.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-scope]');
            if (!row) return;
            e.stopPropagation();
            closePopup(true);
            run(row.dataset.scope as HistoryHideScope);
        });
        this.openLifelineHistoryPopup(menu, anchor, (e) => this.lifelineHistoryMenuKeys(e, menu));
        menu.querySelector<HTMLElement>('[data-scope]')?.focus();
    },

    /** ↑ / ↓ (and Home / End) over a menu's rows. */
    lifelineHistoryMenuKeys(e: KeyboardEvent, menu: HTMLElement): void {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const rows = Array.from(menu.querySelectorAll<HTMLElement>('[data-scope]'));
        if (!rows.length) return;
        const at = rows.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
            : e.key === 'ArrowDown' ? (at + 1) % rows.length : (at + rows.length - 1) % rows.length;
        e.preventDefault();
        rows[next]?.focus();
    },

    /** "i" by the chip: what the marks mean (a popover; on a phone a bottom sheet). Again "i" closes it. */
    toggleLifelineHistoryLegend(anchor: HTMLElement): void {
        if (popup?.anchor === anchor) { closePopup(true); return; }
        closePopup(false);
        const h = strings.history;
        // §6e: four kinds (▲ only with history.place); a kind switched off in Settings muted with its note.
        const { kinds, placeShown } = this.historyKindsNow();
        // Off for this tree (its own choice, K8.6) or in Settings.
        const offText = SettingsManager.hasTreeHistoryKinds(DataManager.getCurrentTreeId()) ? h.legendKindOffTree : h.legendKindOff;
        const row = (mark: string, title: string, hint: string, off = false): string =>
            `<div class="pm-lifeline-legend-row${off ? ' is-off' : ''}"><span class="pm-lifeline-legend-mark ${mark}" aria-hidden="true">`
            + `${mark === 'is-tip' ? 'T' : mark === 'is-place' ? '\u25B2' : ''}</span>`
            + `<span><span class="pm-lifeline-legend-name">${esc(title)}</span><span class="pm-lifeline-legend-hint">${esc(hint)}</span>`
            + `${off ? `<span class="pm-lifeline-legend-hint pm-lifeline-legend-off">${esc(offText)}</span>` : ''}</span></div>`;
        const content = `<div class="pm-lifeline-legend-title">${esc(h.legendTitle)}</div>`
            + row('is-region', h.legendRegion, h.legendRegionHint, !kinds.region)
            + (placeShown ? row('is-place', h.legendPlace, h.legendPlaceHint, !kinds.place) : '')
            + row('is-local', h.legendLocal, h.legendLocalHint, !kinds.local)
            + row('is-tip', h.legendTip, h.legendTipHint)
            + `<p class="pm-lifeline-legend-foot">${esc(h.legendFoot)}</p>`
            + (this.historyManageAvailable()
                ? `<button type="button" class="pm-lifeline-legend-manage" data-legend="manage">${esc(h.manageOpen)} ›</button>` : '');
        if (media(MQ_MOBILE)) {
            const sheet = this.showLifelineHistorySheet('pm-lifeline-legend-sheet', 'dialog', h.legendTitle,
                `<div class="pm-lifeline-legend">${content}</div>`
                + `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel">${esc(strings.buttons.close)}</button>`);
            sheet.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.pm-lifeline-hsheet-cancel')) this.hideBottomSheet();
                else if (target.closest('[data-legend="manage"]')) {
                    this.hideBottomSheet();
                    this.openHistoryManageFrom('legend');
                }
            });
            sheet.querySelector<HTMLElement>('.pm-lifeline-hsheet-cancel')?.focus({ preventScroll: true });
            return;
        }
        const pop = document.createElement('div');
        pop.className = 'pm-lifeline-legend pm-lifeline-legend-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', h.legendTitle);
        pop.tabIndex = -1;
        pop.innerHTML = content;
        pop.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('[data-legend="manage"]')) this.openHistoryManageFrom('legend');
        });
        this.openLifelineHistoryPopup(pop, anchor);
        pop.focus({ preventScroll: true });
    },

    /**
     * A popover by `anchor` (under it, its right edge at the anchor's, above
     * it when there is no room below): Esc closes it and returns to the
     * anchor, a press outside closes it, the anchor again closes it.
     */
    openLifelineHistoryPopup(el: HTMLElement, anchor: HTMLElement, keys?: (e: KeyboardEvent) => void, onEscape?: () => boolean): void {
        document.body.appendChild(el);
        anchor.setAttribute('aria-expanded', 'true');
        const place = (): void => {
            const at = popup?.anchor ?? anchor;
            const r = at.getBoundingClientRect();
            const w = el.offsetWidth;
            const hgt = el.offsetHeight;
            el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
            el.style.top = `${r.bottom + 4 + hgt > window.innerHeight - 8 ? Math.max(8, r.top - hgt - 4) : r.bottom + 4}px`;
        };
        place();
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                // A menu's second level goes back to the first.
                if (onEscape?.()) return;
                closePopup(true);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                closePopup(true);
                return;
            }
            if (el.contains(e.target as Node)) keys?.(e);
        };
        const onDown = (e: Event): void => {
            const t = e.target as Node;
            if (el.contains(t) || popup?.anchor.contains(t)) return;
            closePopup(false);
        };
        // The card scrolls under it: it follows its anchor.
        const onScroll = (e: Event): void => {
            if (!el.contains(e.target as Node) && popup?.anchor.isConnected) place();
        };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('touchstart', onDown, true);
        window.addEventListener('resize', onScroll);
        document.addEventListener('scroll', onScroll, true);
        popup = {
            el, anchor, off: () => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('mousedown', onDown, true);
                document.removeEventListener('touchstart', onDown, true);
                window.removeEventListener('resize', onScroll);
                document.removeEventListener('scroll', onScroll, true);
            },
        };
    },

    /**
     * After a redraw of the timeline: an open popover moves to its anchor's
     * new button (the same row's "⋯"); without one it closes.
     */
    relinkLifelineHistoryPopup(body: HTMLElement): void {
        if (!popup || popup.anchor.isConnected) return;
        const key = popup.anchor.dataset.hfocus;
        const next = key ? body.querySelector<HTMLElement>(`[data-hfocus="${CSS.escape(key)}"]`) : null;
        if (!next) { closePopup(false); return; }
        popup.anchor = next;
        next.setAttribute('aria-expanded', 'true');
    },

    /** A bottom sheet of the layer (phone): the app's sheet, its opener focused again when it closes. */
    showLifelineHistorySheet(className: string, role: 'menu' | 'dialog', label: string, inner: string): HTMLElement {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        overlay.innerHTML = `<div class="bottom-sheet pm-lifeline-hsheet ${className}" role="${role}" aria-label="${esc(label)}">`
            + `<div class="bottom-sheet-handle"></div>${inner}</div>`;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hideBottomSheet();
        });
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        requestAnimationFrame(() => overlay.classList.add('active'));
        return overlay.querySelector('.bottom-sheet') as HTMLElement;
    },
});
