/**
 * History of places — a place's own history on request (spec 1028 §6a,
 * research R6): the confirmation with the estimate before anything is spent,
 * and "Search again in the research" of a place done.
 *
 * The research starts a place's own history only in its terminal: `POST
 * /history/place {place: "L…"}` answers `403 history.link` with the link the
 * app opens (the terminal says the estimate and asks). Only a research that
 * says `history.place.direct` takes it over the bridge (200: first in line).
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { manageCan, manageSearchOn } from '../history-manage.js';
import { historyPlaceOfferable, historyWaiting, pickHistoryText } from '../history.js';
import { postBridgePlace, type HistoryWriteRefusal } from '../history-bridge.js';
import { HISTORY_PLACE_DIRECT_FEATURE } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { uiModule } from './module.js';

export const HISTORY_PLACE_DIALOG_ID = 'history-place-modal';

interface PlaceFindState {
    /** The payload's place key. */
    key: string;
    /** The research's place record ("L0001"). */
    id: string;
    rid: string;
    name: string;
    /** The bridge takes it itself (`history.place.direct`) and has not said otherwise yet. */
    direct: boolean;
    /** The link the bridge answered with (the direct form switched to the terminal). */
    link: string;
    busy: boolean;
    /** A refusal's sentence, with its link. */
    note: { text: string; link?: { label: string; run: () => void } } | null;
    /** Focus goes back here on close. */
    opener: HTMLElement | null;
}

let state: PlaceFindState | null = null;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const historyPlaceMethods = uiModule({
    /**
     * §6a.3: the confirmation of a place's own history (M3; M2 only with
     * `history.place.direct`) — `history.place`, the bridge running, the
     * research searching, the place with its record (`id`) and no history yet.
     */
    openHistoryPlaceFind(key: string): void {
        const d = this.historyManageDrawn();
        const place = d?.payload?.places[key];
        if (!d?.payload || !place?.id || !this.historyPlaceCanFind(key)) return;
        this.closeLifelineHistoryPopups();
        const active = document.activeElement;
        state = {
            key, id: place.id, rid: d.rid, name: d.names.place(key),
            direct: d.features.includes(HISTORY_PLACE_DIRECT_FEATURE), link: '', busy: false, note: null,
            opener: active instanceof HTMLElement ? active : null,
        };
        document.getElementById(HISTORY_PLACE_DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = HISTORY_PLACE_DIALOG_ID;
        overlay.innerHTML = '<div class="modal hpf-modal" role="dialog" data-dialog-kind="info" aria-modal="true"'
            + ' aria-labelledby="hpf-title" aria-describedby="hpf-cost" data-skeleton="done"></div>';
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) this.closeHistoryPlaceFind(); });
        overlay.addEventListener('click', e => this.historyPlaceClick(e));
        document.body.appendChild(overlay);
        this.pushDialog(HISTORY_PLACE_DIALOG_ID);
        this.renderHistoryPlaceFind();
        // Nothing starts without a click: Cancel is the default (Enter cancels).
        overlay.querySelector<HTMLElement>('[data-hpf="cancel"].secondary')?.focus({ preventScroll: true });
    },

    /** The place may be offered (§6a.2 / §6a.4): the gates of R6 and a place with no history of its own yet. */
    historyPlaceCanFind(key: string): boolean {
        const d = this.historyManageDrawn();
        const place = d?.payload?.places[key];
        if (!d?.payload || !historyPlaceOfferable(place)) return false;
        return manageCan(d.env, 'place') && manageSearchOn(d.payload, d.env) && !historyWaiting(d.payload, d.env.treeState);
    },

    closeHistoryPlaceFind(): void {
        const opener = state?.opener;
        state = null;
        document.getElementById(HISTORY_PLACE_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== HISTORY_PLACE_DIALOG_ID);
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    },

    renderHistoryPlaceFind(): void {
        const modal = document.querySelector<HTMLElement>(`#${HISTORY_PLACE_DIALOG_ID} .hpf-modal`);
        if (!modal || !state) return;
        const h = strings.history;
        const st = state;
        const d = this.historyManageDrawn();
        const place = d?.payload?.places[st.key];
        const area = pickHistoryText(place?.area, getCurrentLanguage(), d?.payload?.lang)?.text ?? '';
        const est = this.historyManageContext()?.status?.historyPlaceEstimate;
        const cost = !est ? h.placeCostNone
            : est.usd ? h.placeCostUsd(est.minutes[0], est.minutes[1], est.usd[0], est.usd[1])
                : h.placeCost(est.minutes[0], est.minutes[1]);
        const terminal = !st.direct || !!st.link;
        const note = st.note
            ? `<p class="hpf-note" role="status">${esc(st.note.text)}`
                + (st.note.link ? ` <button type="button" class="link hpf-note-link" data-hpf="noteLink">${esc(st.note.link.label)}</button>` : '')
                + '</p>'
            : '';
        modal.innerHTML = '<div class="modal-header hpf-header">'
            + `<h2 id="hpf-title">${esc(h.placeConfirmTitle(st.name))}</h2>`
            + `<button type="button" class="close-btn" data-hpf="cancel" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + '<div class="modal-content hpf-body">'
            + `<p class="hpf-area"><strong>${esc(area ? h.placeArea(area) : h.placeAreaNone)}</strong></p>`
            + `<p class="hpf-cost" id="hpf-cost">${esc(cost)}</p>`
            + `<p class="hpf-mode">${esc(terminal ? h.placeTerminal : h.placeShared)}</p>`
            + note
            + '</div>'
            + '<div class="buttons hpf-foot">'
            + `<button type="button" class="secondary" data-hpf="cancel">${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary" data-hpf="go"${st.busy ? ' disabled aria-busy="true"' : ''}>`
            + `${esc(terminal ? h.placeGoTerminal : h.placeGo)}</button>`
            + '</div>';
    },

    historyPlaceClick(e: MouseEvent): void {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-hpf]');
        if (!el || !state) return;
        switch (el.dataset.hpf) {
            case 'cancel': this.closeHistoryPlaceFind(); return;
            case 'go': void this.historyPlaceGo(); return;
            case 'noteLink': {
                const run = state.note?.link?.run;
                this.closeHistoryPlaceFind();
                run?.();
                return;
            }
            default: return;
        }
    },

    /**
     * The confirmation's button: the terminal's link (asked of the bridge,
     * or the one it already gave), or the direct form's write.
     */
    async historyPlaceGo(): Promise<void> {
        const st = state;
        if (!st || st.busy) return;
        if (st.link) {
            const link = st.link;
            this.closeHistoryPlaceFind();
            this.launchResearchLink(link, 'terminal');
            return;
        }
        const ctx = this.historyManageContext();
        if (!ctx?.base) {
            st.note = { text: strings.history.manageNoBridge };
            this.renderHistoryPlaceFind();
            return;
        }
        st.busy = true;
        st.note = null;
        this.renderHistoryPlaceFind();
        const before = this.researchHeadNow(st.rid);
        const scheme = announcedResearchScheme();
        const r = await postBridgePlace(ctx.base, st.id, ctx.features, { tree: st.rid, ...(scheme ? { scheme } : {}) });
        if (state !== st) return;
        st.busy = false;
        if (r.ok) {
            // Only a research that says `history.place.direct`: first in line.
            this.closeHistoryPlaceFind();
            this.showToast(strings.history.placeToast(st.name), 6000, { kind: 'history-place' });
            this.historyManageWritten(st.rid, before, r);
            return;
        }
        if (r.code === 'link' && r.link) {
            if (st.direct) {
                // The bridge leaves it to the terminal after all: the same confirmation, its button opens the link.
                st.link = r.link;
                this.renderHistoryPlaceFind();
                document.querySelector<HTMLElement>(`#${HISTORY_PLACE_DIALOG_ID} [data-hpf="go"]`)?.focus({ preventScroll: true });
                return;
            }
            this.closeHistoryPlaceFind();
            this.launchResearchLink(r.link, 'terminal');
            return;
        }
        st.note = this.historyPlaceRefusalNote(r);
        this.renderHistoryPlaceFind();
        if (r.code === 'gone' || r.code === 'done') void this.readBridgeHistory(st.rid);
    },

    /** §6a.4 refusals: off with the link to switch it on, archive with why, busy, anything else in the bridge's words. */
    historyPlaceRefusalNote(r: HistoryWriteRefusal): PlaceFindState['note'] {
        const h = strings.history;
        if (r.code === 'off') {
            const can = !!r.link || !!this.historyManageContext()?.canLinkOn;
            return {
                text: h.manageOff,
                ...(can ? { link: { label: h.enableSearch, run: () => (r.link ? this.launchResearchLink(r.link, 'terminal') : this.historyEnableSearch()) } } : {}),
            };
        }
        if (r.code === 'archive') return { text: h.findArchive(r.reason) };
        if (r.code === 'busy') return { text: h.errBusy };
        return { text: r.reason || (r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed) };
    },

    /** §6a.6: a place's history again — the terminal decides; the bridge's link opens it (nothing starts here). */
    historyPlaceSearchAgainShown(key: string): boolean {
        const d = this.historyManageDrawn();
        const place = d?.payload?.places[key];
        if (!d?.payload || !place?.id || place.skip) return false;
        if (place.history !== 'done' && place.history !== 'empty') return false;
        return manageCan(d.env, 'place') && manageSearchOn(d.payload, d.env) && !historyWaiting(d.payload, d.env.treeState);
    },

    async historyPlaceSearchAgain(key: string): Promise<void> {
        const d = this.historyManageDrawn();
        const id = d?.payload?.places[key]?.id;
        if (!d?.base || !id) return;
        const scheme = announcedResearchScheme();
        const r = await postBridgePlace(d.base, id, d.features, { tree: d.rid, ...(scheme ? { scheme } : {}) });
        if (r.ok) {
            this.showToast(strings.history.placeToast(d.names.place(key)), 6000, { kind: 'history-place' });
            this.historyManageWritten(d.rid, this.researchHeadNow(d.rid), r);
            return;
        }
        if (r.code === 'link' && r.link) {
            this.launchResearchLink(r.link, 'terminal');
            return;
        }
        const note = this.historyPlaceRefusalNote(r);
        this.showToast(note?.text ?? '', 6000, note?.link ? { action: { label: note.link.label, run: note.link.run } } : {});
        if (r.code === 'gone' || r.code === 'done') void this.readBridgeHistory(d.rid);
    },
});
