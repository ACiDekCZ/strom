/**
 * History of places — a place's region by hand (spec 1028 §4, research R5):
 * the picker over the manager (or over Places), the step "let the research
 * decide again" with a note, and the History line of a place in the Places
 * dialog (§4.6).
 *
 * The pure model is src/history-manage.ts (`regionPicker`, `pickerCheck`,
 * `mapResultText`, `placesHistoryLine`); the write is `postBridgeMap`.
 */

import { strings, joinAnd } from '../strings.js';
import { placeKey } from '../places.js';
import type { HistoryPlace } from '../history.js';
import {
    regionPicker, pickerCheck, pickerBody, mapResultText, matchesQuery, regionName, manageCan, placesHistoryLine,
    type RegionPicker, type PickerChoice,
} from '../history-manage.js';
import {
    postBridgeMap, historyMapNote, HISTORY_MAP_NOTE_MAX, type HistoryMapBody, type HistoryWriteRefusal,
} from '../history-bridge.js';
import { uiModule } from './module.js';

export const HISTORY_MAP_DIALOG_ID = 'history-map-modal';

interface PickerState {
    /** The payload's place key. */
    key: string;
    rid: string;
    picker: RegionPicker;
    chosen: PickerChoice[];
    step: 'pick' | 'redo';
    query: string;
    note: string;
    busy: boolean;
    error: string;
    /** Focus goes back here on close. */
    opener: HTMLElement | null;
}

let state: PickerState | null = null;

/** The payload's place key by the Places dialog's key (the research's name first, then the key itself). */
function placesHistoryKeys(places: Record<string, HistoryPlace>, nameOf: (k: string) => string): Map<string, string> {
    const byTreeKey = new Map<string, string>();
    for (const k of Object.keys(places)) {
        byTreeKey.set(placeKey(nameOf(k)), k);
        if (!byTreeKey.has(placeKey(k))) byTreeKey.set(placeKey(k), k);
    }
    return byTreeKey;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** At most HISTORY_MAP_NOTE_MAX code points (after NFC), a surrogate pair never split. */
function clipNote(v: string): string {
    const cps = Array.from(v.normalize('NFC'));
    return cps.length > HISTORY_MAP_NOTE_MAX ? cps.slice(0, HISTORY_MAP_NOTE_MAX).join('') : v;
}

/** The place's way back from a write: its regions by hand, its redo, or the research's choice. */
export function mapUndoBody(key: string, before: HistoryPlace | undefined): HistoryMapBody {
    if (before?.manual && before.regions?.length) return { place: key, regions: before.regions.map(r => ({ ...r })) };
    if (before?.redo) return { place: key, redo: true, ...(before.note ? { note: before.note } : {}) };
    return { place: key, do: 'auto' };
}

export const historyMapMethods = uiModule({
    /** The region picker for a payload place (§4.1): only with `history.map` and the bridge running. */
    openHistoryRegionPicker(key: string): void {
        const d = this.historyManageDrawn();
        if (!d?.payload || !manageCan(d.env, 'map')) return;
        const picker = regionPicker(d.payload, d.env.lang, d.names, key);
        if (!picker) return;
        this.closeLifelineHistoryPopups();
        const active = document.activeElement;
        state = {
            key, rid: d.rid, picker, chosen: picker.chosen.map(c => ({ ...c })), step: 'pick', query: '', note: '',
            busy: false, error: '', opener: active instanceof HTMLElement ? active : null,
        };
        document.getElementById(HISTORY_MAP_DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = HISTORY_MAP_DIALOG_ID;
        overlay.innerHTML = '<div class="modal hmp-modal" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="hmp-title" data-skeleton="done"></div>';
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) this.closeHistoryRegionPicker(); });
        overlay.addEventListener('click', e => this.historyMapClick(e));
        overlay.addEventListener('input', e => this.historyMapInput(e));
        overlay.addEventListener('change', e => this.historyMapChange(e));
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.target as HTMLElement).matches('input.hmp-year')) {
                e.preventDefault();
                document.querySelector<HTMLButtonElement>(`#${HISTORY_MAP_DIALOG_ID} [data-hmp="assign"]`)?.click();
            }
        });
        document.body.appendChild(overlay);
        this.pushDialog(HISTORY_MAP_DIALOG_ID);
        this.renderHistoryRegionPicker();
        overlay.querySelector<HTMLElement>(state.chosen.length ? 'input.hmp-year' : 'input.hmp-q')?.focus({ preventScroll: true });
    },

    closeHistoryRegionPicker(): void {
        const opener = state?.opener;
        state = null;
        document.getElementById(HISTORY_MAP_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== HISTORY_MAP_DIALOG_ID);
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    },

    /** Escape: the redo step back to the choice, else close. */
    historyMapEscape(): void {
        if (state?.step === 'redo' && !state.busy) {
            state.step = 'pick';
            state.error = '';
            this.renderHistoryRegionPicker();
            document.querySelector<HTMLElement>(`#${HISTORY_MAP_DIALOG_ID} [data-hmp="redo"]`)?.focus();
            return;
        }
        this.closeHistoryRegionPicker();
    },

    renderHistoryRegionPicker(): void {
        const modal = document.querySelector<HTMLElement>(`#${HISTORY_MAP_DIALOG_ID} .hmp-modal`);
        if (!modal || !state) return;
        const h = strings.history;
        const st = state;
        const close = `<button type="button" class="close-btn" data-hmp="cancel" aria-label="${esc(strings.buttons.close)}">&times;</button>`;
        if (st.step === 'redo') {
            const d = this.historyManageDrawn();
            const why = d?.payload?.places[st.key]?.why ?? '';
            modal.innerHTML = `<div class="modal-header hmp-header"><div class="hmp-heading"><h2 id="hmp-title">${esc(h.redoTitle)}</h2>`
                + `<p class="hmp-why">${esc([st.picker.place, why].filter(Boolean).join(' · '))}</p></div>${close}</div>`
                + '<div class="modal-content hmp-body">'
                + `<p class="hmp-text">${esc(h.redoBody)}</p>`
                + `<label class="hmp-label" for="hmp-note">${esc(h.redoNote)}</label>`
                + `<textarea id="hmp-note" class="hmp-note-input" data-hmp="note" rows="3" placeholder="${esc(st.picker.notePh)}">${esc(st.note)}</textarea>`
                + `<p class="hmp-error" role="alert"${st.error ? '' : ' hidden'}>${esc(st.error)}</p>`
                + '</div>'
                + '<div class="buttons hmp-foot">'
                + `<button type="button" class="secondary" data-hmp="back"${st.busy ? ' disabled' : ''}>${esc(h.redoBack)}</button>`
                + `<button type="button" class="primary" data-hmp="redoGo"${st.busy ? ' disabled' : ''}>${esc(h.redoConfirm)}</button>`
                + '</div>';
            return;
        }
        const title = st.chosen.length > 1 ? h.mapTitleMany(st.picker.place) : h.mapTitle(st.picker.place);
        modal.innerHTML = `<div class="modal-header hmp-header"><div class="hmp-heading"><h2 id="hmp-title">${esc(title)}</h2>`
            + (st.picker.why ? `<p class="hmp-why">${esc(st.picker.why)}</p>` : '') + `</div>${close}</div>`
            + '<div class="modal-content hmp-body">'
            + `<h3 class="hmp-label">${esc(h.mapRegions)}</h3>`
            + `<div class="hmp-chosen">${this.historyMapChosenHtml()}</div>`
            + `<p class="hmp-note">${esc(h.mapYearsNote)}</p>`
            + '<div class="hmp-search"><svg class="hmp-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg>'
            + `<input type="search" class="hmp-q" data-hmp="q" autocomplete="off" spellcheck="false" placeholder="${esc(h.mapSearchPh)}" aria-label="${esc(h.mapSearchPh)}" value="${esc(st.query)}"></div>`
            + `<div class="hmp-list" role="group" aria-label="${esc(h.mapRegions)}">${this.historyMapListHtml()}</div>`
            + '<p class="hmp-result" aria-live="polite"></p>'
            + `<p class="hmp-error" role="alert"${st.error ? '' : ' hidden'}>${esc(st.error)}</p>`
            + '</div>'
            + '<div class="buttons hmp-foot">'
            + `<button type="button" class="link hmp-redo-link" data-hmp="redo"${st.busy ? ' disabled' : ''}>${esc(h.mapRedoLink)}</button>`
            + `<button type="button" class="secondary" data-hmp="cancel" data-dismiss>${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary" data-hmp="assign">${esc(h.mapConfirm)}</button>`
            + '</div>';
        this.historyMapValidate();
    },

    /** The regions to choose from (the search's filter, the chosen ones ticked). */
    historyMapListHtml(): string {
        if (!state) return '';
        const st = state;
        const on = new Set(st.chosen.map(c => c.id));
        return st.picker.list.map(r => `<label class="hmp-opt${r.indent ? ' is-indent' : ''}" data-id="${esc(r.id)}"${matchesQuery(r.search, st.query) ? '' : ' hidden'}>`
                + `<input type="checkbox" data-hmp="pick" value="${esc(r.id)}"${on.has(r.id) ? ' checked' : ''}>`
                + `<span class="hmp-opt-name">${esc(r.name)}</span>`
                + (r.meta ? `<span class="hmp-opt-meta">${esc(r.meta)}</span>` : '') + '</label>').join('')
            + `<p class="hmp-empty"${st.picker.list.some(r => matchesQuery(r.search, st.query)) ? ' hidden' : ''}>${esc(strings.history.searchNone)}</p>`;
    },

    /**
     * The research's data changed while the picker is open (a read after a write elsewhere,
     * the research's agent): the regions to choose from and the place's line follow; what is
     * chosen, the typed years, the search and the note stay, and so does the focus.
     */
    refreshHistoryRegionPicker(): void {
        if (!state || state.busy) return;
        const d = this.historyManageDrawn();
        if (!d?.payload || d.rid !== state.rid) return;
        const picker = regionPicker(d.payload, d.env.lang, d.names, state.key);
        if (!picker) return;
        state.picker = { ...picker, chosen: state.picker.chosen };
        const modal = document.querySelector<HTMLElement>(`#${HISTORY_MAP_DIALOG_ID} .hmp-modal`);
        if (!modal) return;
        const why = modal.querySelector<HTMLElement>('.hmp-why');
        if (state.step === 'redo') {
            if (why) why.textContent = [picker.place, d.payload.places[state.key]?.why ?? ''].filter(Boolean).join(' · ');
            return;
        }
        if (why) { why.textContent = picker.why; why.hidden = !picker.why; }
        const list = modal.querySelector<HTMLElement>('.hmp-list');
        if (!list) return;
        const active = document.activeElement;
        const focused = active instanceof HTMLInputElement && list.contains(active) ? active.value : null;
        const scroll = list.scrollTop;
        list.innerHTML = this.historyMapListHtml();
        list.scrollTop = scroll;
        if (focused !== null) list.querySelector<HTMLInputElement>(`input[data-hmp="pick"][value="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    },

    /** The chosen regions with their years and ×. */
    historyMapChosenHtml(): string {
        const st = state;
        if (!st) return '';
        const h = strings.history;
        if (!st.chosen.length) return `<p class="hmp-none">${esc(h.mapNone)}</p>`;
        const byId = new Map(st.picker.list.map(r => [r.id, r]));
        // By position: a region may be chosen twice, each time with its own period.
        return st.chosen.map((c, i) => {
            const r = byId.get(c.id);
            const name = r?.name ?? c.id;
            const year = (which: 'from' | 'to', value: string) =>
                `<label class="hmp-year-wrap"><span>${esc(which === 'from' ? h.mapFrom : h.mapTo)}</span>`
                + `<input type="text" class="hmp-year" data-hmp="${which}" data-id="${esc(c.id)}" data-i="${i}" inputmode="numeric" maxlength="4" autocomplete="off"`
                + ` pattern="[0-9]{3,4}" placeholder="${esc(h.periodYear)}" value="${esc(value)}"`
                + ` aria-label="${esc(h.mapYearLabel(name, which === 'from' ? h.mapFrom : h.mapTo))}"></label>`;
            return `<div class="hmp-sel" data-id="${esc(c.id)}" data-i="${i}">`
                + `<span class="hmp-sel-name">${esc(name)}${r?.parent ? ` <span class="hmp-sel-parent">${esc(r.parent)}</span>` : ''}</span>`
                + `<span class="hmp-years">${year('from', c.from)}${year('to', c.to)}</span>`
                + `<button type="button" class="hmp-x" data-hmp="remove" data-id="${esc(c.id)}" data-i="${i}" aria-label="${esc(h.mapRemove(name))}">&times;</button>`
                + `<p class="hmp-sel-err" hidden></p></div>`;
        }).join('');
    },

    /** Years checked, the sentence of what happens, Assign on or off — without redrawing the inputs. */
    historyMapValidate(): void {
        const root = document.getElementById(HISTORY_MAP_DIALOG_ID);
        const st = state;
        if (!root || !st || st.step !== 'pick') return;
        const h = strings.history;
        const d = this.historyManageDrawn();
        const check = d?.payload ? pickerCheck(d.payload, st.chosen) : { rows: [], ok: false };
        st.chosen.forEach((c, i) => {
            const row = root.querySelector<HTMLElement>(`.hmp-sel[data-i="${i}"]`);
            if (!row) return;
            const problem = check.rows[i];
            row.classList.toggle('is-bad', !!problem);
            row.querySelectorAll('input.hmp-year').forEach(inp => inp.setAttribute('aria-invalid', String(!!problem)));
            const err = row.querySelector<HTMLElement>('.hmp-sel-err');
            if (err) {
                err.hidden = !problem;
                err.textContent = problem === 'overlap' ? h.mapYearsOverlap : problem === 'years' ? h.mapYearsBad : '';
            }
        });
        const result = root.querySelector<HTMLElement>('.hmp-result');
        if (result) result.textContent = d?.payload && st.chosen.length ? mapResultText(d.payload, st.chosen.map(c => c.id), d.env.lang) : '';
        const assign = root.querySelector<HTMLButtonElement>('[data-hmp="assign"]');
        if (assign) assign.disabled = !check.ok || st.busy;
        const title = root.querySelector<HTMLElement>('#hmp-title');
        if (title) title.textContent = st.chosen.length > 1 ? h.mapTitleMany(st.picker.place) : h.mapTitle(st.picker.place);
    },

    historyMapRedrawChosen(): void {
        const box = document.querySelector<HTMLElement>(`#${HISTORY_MAP_DIALOG_ID} .hmp-chosen`);
        if (box) box.innerHTML = this.historyMapChosenHtml();
        this.historyMapValidate();
    },

    historyMapClick(e: Event): void {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-hmp]');
        if (!el || !state || (el as HTMLButtonElement).disabled) return;
        const st = state;
        switch (el.dataset.hmp) {
            case 'cancel': this.closeHistoryRegionPicker(); return;
            case 'remove': {
                const id = el.dataset.id ?? '';
                const at = Number(el.dataset.i);
                st.chosen = st.chosen.filter((c, i) => i !== at);
                const box = document.querySelector<HTMLInputElement>(`#${HISTORY_MAP_DIALOG_ID} input[data-hmp="pick"][value="${CSS.escape(id)}"]`);
                if (box) box.checked = st.chosen.some(c => c.id === id);
                this.historyMapRedrawChosen();
                document.querySelector<HTMLElement>(`#${HISTORY_MAP_DIALOG_ID} input.hmp-q`)?.focus({ preventScroll: true });
                return;
            }
            case 'redo':
                st.step = 'redo';
                st.error = '';
                this.renderHistoryRegionPicker();
                document.getElementById('hmp-note')?.focus();
                return;
            case 'back':
                this.historyMapEscape();
                return;
            case 'assign': void this.historyMapAssign(); return;
            case 'redoGo': void this.historyMapRedo(); return;
            default: return;
        }
    },

    historyMapInput(e: Event): void {
        const el = e.target as HTMLInputElement | HTMLTextAreaElement;
        const st = state;
        if (!st) return;
        const which = el.dataset.hmp;
        if (which === 'q') {
            st.query = el.value;
            const root = document.getElementById(HISTORY_MAP_DIALOG_ID);
            let any = false;
            for (const r of st.picker.list) {
                const opt = root?.querySelector<HTMLElement>(`.hmp-opt[data-id="${CSS.escape(r.id)}"]`);
                const hit = matchesQuery(r.search, st.query);
                any ||= hit;
                if (opt) opt.hidden = !hit;
            }
            const empty = root?.querySelector<HTMLElement>('.hmp-empty');
            if (empty) empty.hidden = any;
        } else if (which === 'from' || which === 'to') {
            const digits = el.value.replace(/\D/g, '').slice(0, 4);
            if (digits !== el.value) el.value = digits;
            const c = st.chosen[Number(el.dataset.i)];
            if (c) c[which] = digits;
            this.historyMapValidate();
        } else if (which === 'note') {
            const clipped = clipNote(el.value);
            if (clipped !== el.value) el.value = clipped;
            st.note = clipped;
        }
    },

    historyMapChange(e: Event): void {
        const el = e.target as HTMLInputElement;
        const st = state;
        if (!st || el.dataset.hmp !== 'pick') return;
        if (el.checked) {
            if (!st.chosen.some(c => c.id === el.value)) st.chosen.push({ id: el.value, from: '', to: '' });
        } else {
            st.chosen = st.chosen.filter(c => c.id !== el.value);
        }
        this.historyMapRedrawChosen();
    },

    /** A refusal inside the picker (§3.7): busy, gone (read again), the bridge's sentence. */
    historyMapRefusedText(r: HistoryWriteRefusal): string {
        const h = strings.history;
        if (r.code === 'busy') return h.errBusy;
        if (r.code === 'gone') {
            const ctx = this.historyManageContext();
            if (ctx) void this.readBridgeHistory(ctx.researchId);
            return r.reason || h.mapErrGone;
        }
        if (r.held) return this.researchWriteHeldText(r.held, false).toast;
        return r.reason || strings.live.waitingWrite.writeFailed;
    },

    /** "Assign" (§4.1): `POST /history/map {place, regions}`, a toast with Undo (the place's state before). */
    async historyMapAssign(): Promise<void> {
        const st = state;
        const d = this.historyManageDrawn();
        if (!st || st.busy || !d?.base || !d.payload) return;
        const h = strings.history;
        if (!pickerCheck(d.payload, st.chosen).ok) return;
        const regions = pickerBody(st.chosen);
        const undo = mapUndoBody(st.key, d.payload.places[st.key]);
        const names = joinAnd(d.env.lang, [...new Set(regions.map(r => r.id))].map(id => regionName(d.payload!.regions?.[id] ?? { id }, d.env.lang)));
        st.busy = true;
        st.error = '';
        this.historyMapValidate();
        const before = this.researchHeadNow(d.rid);
        const r = await postBridgeMap(d.base, { place: st.key, regions }, d.features);
        if (state !== st) return;
        st.busy = false;
        if (!r.ok) {
            st.error = this.historyMapRefusedText(r);
            this.renderHistoryRegionPicker();
            return;
        }
        const place = st.picker.place;
        this.closeHistoryRegionPicker();
        this.historyManageWritten(d.rid, before, r);
        this.showToast(h.toastMapped(place, names), 8000, {
            kind: 'history-map',
            action: { label: h.undo, run: () => { void this.historyMapWrite(undo); } },
        });
    },

    /** "Decide again" (§4.2): `{place, redo: true, note}`; no Undo (the research keeps no earlier choice). */
    async historyMapRedo(): Promise<void> {
        const st = state;
        const d = this.historyManageDrawn();
        if (!st || st.busy || !d?.base) return;
        const note = historyMapNote(st.note);
        st.busy = true;
        st.error = '';
        this.renderHistoryRegionPicker();
        const before = this.researchHeadNow(d.rid);
        const r = await postBridgeMap(d.base, { place: st.key, redo: true, ...(note ? { note } : {}) }, d.features);
        if (state !== st) return;
        st.busy = false;
        if (!r.ok) {
            st.error = this.historyMapRefusedText(r);
            this.renderHistoryRegionPicker();
            return;
        }
        const place = st.picker.place;
        this.closeHistoryRegionPicker();
        this.historyManageWritten(d.rid, before, r);
        this.showToast(strings.history.toastRedo(place), 5000, { kind: 'history-map' });
    },

    /** A write of R5 outside the picker (Undo of a toast): refusals as a toast. */
    async historyMapWrite(body: HistoryMapBody): Promise<boolean> {
        const d = this.historyManageDrawn();
        if (!d?.base) return false;
        const before = this.researchHeadNow(d.rid);
        const r = await postBridgeMap(d.base, body, d.features);
        if (!r.ok) {
            this.showToast(this.historyMapRefusedText(r), 5000);
            return false;
        }
        this.historyManageWritten(d.rid, before, r);
        return true;
    },

    // ─── The History line in Places (§4.6) ────────────────────────────────

    /** Lines by the Places dialog's place key (empty: no history for the tree, the layer off). */
    placesHistoryLines(keys: readonly string[]): Map<string, string> {
        const out = new Map<string, string>();
        if (!this.historyManageAvailable()) return out;
        const d = this.historyManageDrawn();
        const p = d?.payload;
        if (!d || !p) return out;
        const byTreeKey = placesHistoryKeys(p.places, d.names.place);
        const h = strings.history;
        const canAssign = manageCan(d.env, 'map');
        for (const treeKey of keys) {
            const k = byTreeKey.get(treeKey);
            if (!k) continue;
            const line = placesHistoryLine(p, d.env, k);
            if (!line) continue;
            const action = line.action === 'assign' && canAssign ? 'assign' : 'manage';
            const html = line.legacy
                ? `<div class="place-history is-legacy"><button type="button" class="link place-history-link" data-place-hist="manage" data-hkey="${esc(k)}">${esc(line.text)} ›</button></div>`
                : `<div class="place-history"><span class="place-history-label">${esc(h.placesRow)}</span>`
                    + `<span class="place-history-text">${esc(line.text)}</span>`
                    + `<button type="button" class="link place-history-link" data-place-hist="${action}" data-hkey="${esc(k)}">`
                    + `${esc(action === 'assign' ? h.placesRowAssign : h.placesRowManage)} ›</button></div>`;
            out.set(treeKey, html);
        }
        return out;
    },

    /** Other names of the Places dialog's places for its search: the research's name and other forms (`also`). */
    placesHistoryAliases(keys: readonly string[]): Map<string, string[]> {
        const out = new Map<string, string[]>();
        if (!this.historyManageAvailable()) return out;
        const d = this.historyManageDrawn();
        const p = d?.payload;
        if (!d || !p) return out;
        const byTreeKey = placesHistoryKeys(p.places, d.names.place);
        for (const treeKey of keys) {
            const k = byTreeKey.get(treeKey);
            const place = k ? p.places[k] : undefined;
            if (k && place) out.set(treeKey, [d.names.place(k), k, ...(place.also ?? [])]);
        }
        return out;
    },

    /** "Manage ›": the manager on its Places tab at this place; "Assign region ›": the picker at once. */
    placesHistoryAction(action: string, key: string): void {
        if (action === 'assign') this.openHistoryRegionPicker(key);
        else this.openHistoryManage({ tab: 'places', place: key });
    },

    /** The history changed: the open Places dialog's History lines again. */
    refreshPlacesHistoryRows(): void {
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        const rows = [...modal.querySelectorAll<HTMLElement>('.place-row[data-key]')];
        const lines = this.placesHistoryLines(rows.map(r => r.dataset.key ?? ''));
        for (const row of rows) {
            row.querySelector('.place-history')?.remove();
            const html = lines.get(row.dataset.key ?? '');
            if (html) row.querySelector('.place-head')?.insertAdjacentHTML('afterend', html);
        }
        // Other names came (or went) with the history: the search looks in them too.
        this.refreshPlacesFilterText();
    },
});


