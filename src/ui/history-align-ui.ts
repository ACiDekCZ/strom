/**
 * Aligning the found history with the kinds searched (spec 035, part B): the
 * preview dialog (`GET /history/align`) — what would be hidden in this tree,
 * shown again, searched, what waits for a search at work and what of the
 * shared catalogues nobody searches — and "Align" (`POST /history/align`) with
 * Undo in its toast. Searching added kinds is never started here: the
 * research's terminal confirms it (the `backfill` link of the answer, or the
 * whole alignment there when the research insists, 6c).
 */

import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { HISTORY_KINDS, type HistoryAlignPreview, type HistoryKind, alignBackfillCounts, alignHideCount } from '../history.js';
import { getHistoryAlign, postHistoryAlign, postHistoryAlignUndo, type HistoryKindsRefusal } from '../history-bridge.js';
import { researchSchemeUrl, researchLinkMark, researchUrlMark } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { historyKindSvg } from '../history-symbols.js';
import { regionName } from '../history-manage.js';
import { researchActionLabel, researchOpenLabel } from './research-open-mark.js';
import { activeResearchId, bridgeBase } from './history-ui.js';
import { uiModule } from './module.js';

export const HISTORY_ALIGN_DIALOG_ID = 'history-align-modal';

/** Backfill rows shown before "and n more". */
const FILL_SHOWN = 3;
/** How long the toast with Undo stands. */
const UNDO_MS = 10_000;

interface AlignState {
    rid: string;
    preview: HistoryAlignPreview | null;
    loading: boolean;
    /** The preview could not be read (its sentence; Try again reads it again). */
    readError: string | null;
    /** "Align" on its way. */
    busy: boolean;
    /** A refusal's sentence above the buttons (503: with Try again). */
    error: { text: string; retry: boolean } | null;
    /** 409 changed: the preview is the new one. */
    changed: boolean;
    /** 403: the research's terminal completes it (6c), with its link. */
    link: string;
    /** All backfill rows shown. */
    more: boolean;
    opener: HTMLElement | null;
}

let state: AlignState | null = null;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kindName(k: HistoryKind): string {
    return strings.history.kinds[k];
}

/** Kind chips (symbol, name, count) of a count by kind, in the kinds' order. */
function chips(kinds: Partial<Record<HistoryKind, number>>): string {
    return HISTORY_KINDS.filter(k => kinds[k])
        .map(k => `<span class="hal-chip" data-kind="${k}">${historyKindSvg(k, 13)}<span>${esc(kindName(k))}</span> <b>${kinds[k]}</b></span>`)
        .join('');
}

/** Only searching added kinds: the research's terminal completes it (6c). */
function onlyBackfill(p: HistoryAlignPreview): boolean {
    return alignHideCount(p) === 0 && p.show.n === 0 && p.backfill.length > 0;
}

function nothing(p: HistoryAlignPreview): boolean {
    return alignHideCount(p) === 0 && p.show.n === 0 && !p.backfill.length && !p.busy.length && !p.shared.n;
}

export const historyAlignMethods = uiModule({
    /** "Align history with the settings…": the preview, read from the research's bridge. */
    openHistoryAlignDialog(): void {
        const rid = activeResearchId();
        if (!rid) return;
        if (!bridgeBase(rid) || !this.researchBridgeUp(rid)) {
            this.showToast(strings.history.storiesBridgeDown, 5000);
            return;
        }
        this.closeLifelineHistoryPopups();
        const active = document.activeElement;
        state = {
            rid, preview: null, loading: true, readError: null, busy: false, error: null, changed: false, link: '', more: false,
            opener: active instanceof HTMLElement ? active : null,
        };
        document.getElementById(HISTORY_ALIGN_DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = HISTORY_ALIGN_DIALOG_ID;
        overlay.innerHTML = '<div class="modal modal--md hal-modal" role="dialog" data-dialog-kind="info" aria-modal="true"'
            + ' aria-labelledby="hal-title" data-skeleton="done"></div>';
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) this.closeHistoryAlign(); });
        overlay.addEventListener('click', e => this.historyAlignClick(e));
        document.body.appendChild(overlay);
        this.pushDialog(HISTORY_ALIGN_DIALOG_ID);
        this.renderHistoryAlign();
        overlay.querySelector<HTMLElement>('[data-dismiss]')?.focus({ preventScroll: true });
        void this.historyAlignRead();
    },

    closeHistoryAlign(): void {
        const opener = state?.opener;
        state = null;
        document.getElementById(HISTORY_ALIGN_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== HISTORY_ALIGN_DIALOG_ID);
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    },

    /** Read the preview (again). */
    async historyAlignRead(): Promise<void> {
        const st = state;
        if (!st) return;
        const base = bridgeBase(st.rid);
        if (!base) {
            st.loading = false;
            st.readError = strings.history.storiesBridgeDown;
            this.renderHistoryAlign();
            return;
        }
        st.loading = true;
        st.readError = null;
        this.renderHistoryAlign();
        const r = await getHistoryAlign(base);
        if (state !== st) return;
        st.loading = false;
        if (r.ok) {
            st.preview = r.preview;
            this.historyAlignNotePreview(st.rid, r.preview);
        } else if (r.code === 'archive') {
            this.closeHistoryAlign();
            this.showToast(strings.history.findArchive(r.reason), 6000);
            this.renderHistorySettingsIfOpen();
            this.renderHistoryManageIfOpen();
            return;
        } else {
            st.readError = r.code === 'busy' ? strings.history.errBusy : (r.reason || strings.live.waitingWrite.writeFailed);
        }
        this.renderHistoryAlign();
    },

    renderHistoryAlign(): void {
        const modal = document.querySelector<HTMLElement>(`#${HISTORY_ALIGN_DIALOG_ID} .hal-modal`);
        const st = state;
        if (!modal || !st) return;
        const h = strings.history;
        const pv = st.preview;
        const body = modal.querySelector<HTMLElement>('.hal-body');
        const scrollTop = body?.scrollTop ?? 0;
        let content = '';
        if (st.changed) content += `<p class="hal-changed" role="status">${esc(h.alignChanged)}</p>`;
        if (!pv) {
            content += st.readError
                ? `<p class="hal-error" role="alert">${esc(st.readError)} <button type="button" class="link" data-hal="reread">${esc(strings.sync.retry)}</button></p>`
                : `<p class="hal-loading" role="status">${esc(h.pendCostLoading)}</p>`;
        } else if (nothing(pv)) {
            content += '<section class="hal-block is-nothing"><span class="hal-mark is-ok" aria-hidden="true">✓</span><div class="hal-block-main">'
                + `<p class="hal-head"><span>${esc(h.alignNothing)}</span></p><p class="hal-sub">${esc(h.alignNothingSub)}</p></div></section>`;
        } else {
            content += this.historyAlignBlocksHtml(pv, st);
        }
        const six = !!pv && (!!st.link || onlyBackfill(pv));
        let foot = '';
        if (st.error) {
            foot += `<p class="hal-err" role="alert">${esc(st.error.text)}`
                + (st.error.retry ? ` <button type="button" class="link" data-hal="retry">${esc(strings.sync.retry)}</button>` : '') + '</p>';
        } else if (six) {
            foot += `<p class="hal-terminal-note">${esc(h.alignTerminalNote)}</p>`;
        }
        const primary = !pv || nothing(pv) ? ''
            : six ? `<button type="button" class="primary" data-hal="terminal">${researchActionLabel(h.placeGoTerminal, (st.link && researchUrlMark(st.link)) || researchLinkMark('history-align'))}</button>`
                : `<button type="button" class="primary" data-hal="go"${st.busy ? ' disabled aria-busy="true"' : ''}>${esc(st.busy ? h.alignWorking : h.alignGo)}</button>`;
        modal.innerHTML = '<div class="modal-header hal-header">'
            + `<h2 id="hal-title">${esc(h.alignTitle)}</h2>`
            + `<button type="button" class="close-btn" data-hal="close" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + `<div class="modal-content hal-body">${content}</div>`
            + `<div class="hal-foot">${foot}<div class="buttons">`
            + `<button type="button" class="secondary" data-dismiss data-hal="close">${esc(strings.buttons.close)}</button>${primary}</div></div>`;
        const nb = modal.querySelector<HTMLElement>('.hal-body');
        if (nb) nb.scrollTop = scrollTop;
    },

    /** The preview's blocks: hidden, shown again, searched, waiting for a search at work, shared catalogues. */
    historyAlignBlocksHtml(pv: HistoryAlignPreview, st: AlignState): string {
        const h = strings.history;
        const block = (cls: string, mark: string, head: string, right: string, inner: string): string =>
            `<section class="hal-block ${cls}"><span class="hal-mark" aria-hidden="true">${mark}</span><div class="hal-block-main">`
            + `<p class="hal-head"><span>${esc(head)}</span>${right ? `<span class="hal-total">${esc(right)}</span>` : ''}</p>${inner}</div></section>`;
        let html = '';
        const hideN = alignHideCount(pv);
        if (hideN) {
            const origin = (cls: string, mark: string, name: string, c: { n: number; kinds: Partial<Record<HistoryKind, number>> }): string =>
                c.n ? `<div class="hal-origin ${cls}"><span class="hal-origin-mark" aria-hidden="true">${mark}</span><span class="hal-origin-name">${esc(name)}</span>`
                    + `<span class="hal-origin-n">${c.n}</span></div><div class="hal-chips">${chips(c.kinds)}</div>` : '';
            html += block('is-hide', '−', h.alignHideHead, String(hideN),
                origin('is-region', '◇', h.kindRegion, pv.hide.general) + origin('is-local', '■', h.alignOriginLocal, pv.hide.local)
                + `<p class="hal-note">${esc(h.alignHideNote)}</p>`);
        }
        if (pv.show.n) {
            html += block('is-show', '+', h.alignShowHead, String(pv.show.n),
                `<div class="hal-chips">${chips(pv.show.kinds)}</div><p class="hal-note">${esc(h.alignShowNote)}</p>`);
        }
        if (pv.backfill.length) {
            const d = this.historyManageDrawn();
            const placeKeys = new Map(Object.entries(d?.payload?.places ?? {}).filter(([, p]) => p.id).map(([k, p]) => [p.id!, k]));
            const label = (b: HistoryAlignPreview['backfill'][number]): string => {
                if (b.label) return b.label;
                if (b.region) return regionName(d?.payload?.regions?.[b.region] ?? { id: b.region }, getCurrentLanguage());
                const key = b.place ? placeKeys.get(b.place) : undefined;
                return key && d ? d.names.place(key) : b.place ?? '';
            };
            const rows = st.more ? pv.backfill : pv.backfill.slice(0, FILL_SHOWN);
            const rest = pv.backfill.length - FILL_SHOWN;
            const { regions, places } = alignBackfillCounts(pv);
            const pace = pv.pace ?? this.historyKindsStatusOf(st.rid)?.historyPace;
            const paceText = pace === 'sometimes' ? h.firstPaceSometimes : pace === 'rare' ? h.firstPaceRare : pace === 'idle' ? h.firstPaceIdle : '';
            html += block('is-fill', '↻', h.alignFillHead, h.alignFillCount(regions, places),
                '<ul class="hal-fill-list">' + rows.map(b => `<li class="hal-fill-row"><span class="hal-fill-label">${esc(label(b))}</span>`
                    + `<span class="hal-fill-kinds">${b.kinds.map(k => `<span class="hal-fill-kind">${historyKindSvg(k, 12)}${esc(kindName(k))}</span>`).join('')}</span>`
                    + (b.years?.length ? `<span class="hal-fill-years">${esc(b.years.join(', '))}</span>` : '') + '</li>').join('') + '</ul>'
                + (rest > 0 ? `<button type="button" class="link hal-more" data-hal="more" aria-expanded="${st.more}">${esc(st.more ? h.alignLess : h.alignMore(rest))}</button>` : '')
                + `<p class="hal-note">${esc(h.alignCost(pv.sessions, paceText))}</p>`
                // The terminal variant (6c) says it once, above the buttons.
                + (st.link || onlyBackfill(pv) ? '' : `<p class="hal-note">${esc(h.pendTerminal)}</p>`));
        }
        if (pv.busy.length) {
            html += block('is-busy', '', h.alignBusyHead, '',
                `<p class="hal-note">${esc(h.alignBusy(joinAnd(getCurrentLanguage(), pv.busy.map(b => b.label || b.id)), pv.busy.length))}</p>`);
        }
        if (pv.shared.n) {
            const kinds = HISTORY_KINDS.filter(k => pv.shared.kinds[k]).map(kindName);
            html += block('is-shared', '⇄', h.alignSharedHead, '',
                `<p class="hal-note">${esc(h.alignShared(pv.shared.n, joinAnd(getCurrentLanguage(), kinds)))} `
                + `<button type="button" class="link" data-hal="shared">${researchOpenLabel(h.alignSharedLink, { size: 12 })}</button></p>`);
        }
        return html;
    },

    historyAlignClick(e: MouseEvent): void {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-hal]');
        const st = state;
        if (!el || !st) return;
        switch (el.dataset.hal) {
            case 'close': this.closeHistoryAlign(); return;
            case 'go': case 'retry': void this.historyAlignGo(); return;
            case 'reread': void this.historyAlignRead(); return;
            case 'more':
                st.more = !st.more;
                this.renderHistoryAlign();
                document.querySelector<HTMLElement>(`#${HISTORY_ALIGN_DIALOG_ID} [data-hal="more"]`)?.focus({ preventScroll: true });
                return;
            case 'terminal': {
                const link = st.link || researchSchemeUrl('history-align', { tree: st.rid }, announcedResearchScheme());
                this.closeHistoryAlign();
                if (link) this.launchResearchLink(link, 'terminal');
                return;
            }
            case 'shared': {
                const link = researchSchemeUrl('history-align', { tree: st.rid, prune: true }, announcedResearchScheme());
                this.closeHistoryAlign();
                if (link) this.launchResearchLink(link, 'terminal');
                return;
            }
            default: return;
        }
    },

    /**
     * "Align": hides and shows at once (Undo in the toast); searching the added
     * kinds goes on in the research's terminal (the answer's link opens it).
     */
    async historyAlignGo(): Promise<void> {
        const st = state;
        const base = st ? bridgeBase(st.rid) : null;
        if (!st || !st.preview || st.busy) return;
        if (!base) {
            st.error = { text: strings.history.storiesBridgeDown, retry: false };
            this.renderHistoryAlign();
            return;
        }
        const h = strings.history;
        st.busy = true;
        st.error = null;
        this.renderHistoryAlign();
        const features = this.historyKindsStatusOf(st.rid)?.features ?? [];
        const before = this.researchHeadNow(st.rid);
        const scheme = announcedResearchScheme();
        const r = await postHistoryAlign(base, st.preview.plan, { hide: true, backfill: true }, features, { tree: st.rid, ...(scheme ? { scheme } : {}) });
        if (state !== st) return;
        st.busy = false;
        if (r.ok) {
            const rid = st.rid;
            this.closeHistoryAlign();
            this.historyAlignNotePreview(rid, null);
            this.historyManageWritten(rid, before, r);
            const undo = r.undo;
            this.showToast(h.tAlignDone(r.done.hidden, r.done.shown, !!r.backfill), UNDO_MS, {
                kind: 'history-align',
                ...(undo ? { action: { label: h.undo, run: () => { void this.historyAlignUndo(rid, undo); } } } : {}),
            });
            if (r.backfill) this.launchResearchLink(r.backfill.link, 'terminal');
            this.renderHistorySettingsIfOpen();
            return;
        }
        this.historyAlignRefused(st, r);
    },

    /** A refused alignment: busy above the buttons, a new preview, the terminal, an archive, the rest in the bridge's words. */
    historyAlignRefused(st: AlignState, r: HistoryKindsRefusal): void {
        const h = strings.history;
        switch (r.code) {
            case 'busy':
                st.error = { text: h.errBusy, retry: true };
                break;
            case 'changed':
                st.changed = true;
                st.more = false;
                if (r.preview) {
                    st.preview = r.preview;
                    this.historyAlignNotePreview(st.rid, r.preview);
                } else {
                    this.renderHistoryAlign();
                    void this.historyAlignRead();
                    return;
                }
                break;
            case 'link':
                if (r.link) st.link = r.link;
                break;
            case 'archive':
                this.closeHistoryAlign();
                this.showToast(h.findArchive(r.reason), 6000);
                this.renderHistorySettingsIfOpen();
                this.renderHistoryManageIfOpen();
                return;
            case 'held':
                st.error = { text: r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed, retry: false };
                break;
            default:
                st.error = { text: r.reason || strings.live.waitingWrite.writeFailed, retry: r.code === 'network' };
        }
        this.renderHistoryAlign();
        const focus = st.link ? '[data-hal="terminal"]' : st.error?.retry ? '[data-hal="retry"]' : '[data-hal="go"]';
        document.querySelector<HTMLElement>(`#${HISTORY_ALIGN_DIALOG_ID} ${focus}`)?.focus({ preventScroll: true });
    },

    /** The toast's Undo: the alignment taken back; undone or gone already — said shortly; the history read again. */
    async historyAlignUndo(rid: string, undo: string): Promise<void> {
        const base = bridgeBase(rid);
        const h = strings.history;
        if (!base) {
            this.showToast(h.storiesBridgeDown, 5000);
            return;
        }
        const features = this.historyKindsStatusOf(rid)?.features ?? [];
        const before = this.researchHeadNow(rid);
        const r = await postHistoryAlignUndo(base, undo, features);
        if (r.ok) {
            this.historyManageWritten(rid, before, r);
            this.showToast(h.tAlignUndone, 5000, { kind: 'history-align' });
        } else {
            this.showToast(r.code === 'undone' ? h.tAlignUndone : r.code === 'busy' ? h.errBusy
                : r.reason || strings.live.waitingWrite.writeFailed, 5000, { kind: 'history-align' });
            void this.readBridgeHistory(rid);
        }
        this.historyAlignNotePreview(rid, null);
        this.renderHistorySettingsIfOpen();
    },
});
