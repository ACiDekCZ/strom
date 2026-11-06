/**
 * "Read again…" in the source viewer (spec 059 §4): the research reads a
 * source again from its original (`POST sources/read`) and compares the new
 * reading with the source's transcript. The transcript never changes; a
 * difference becomes a task of the research.
 *
 * Offered only while the research's bridge reads sources again
 * (`read.source`), reads now (`accepts.read.ready`) and its file says it has
 * the source's original (`_STROM_ORIG Y`). The action goes through the bridge
 * and an agent reads: the AI badge alone. A source whose original or
 * transcript the research turned down (409 noscan / notext) loses the action
 * until the research's next file.
 */

import { DataManager } from '../data.js';
import { Source, SourceExcerpt } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { researchBridgeAgentLabel } from './research-open-mark.js';
import { readSourceAgainOffered, readSourceAgainClip, readSourceId, LiveRead, ReadResult } from '../research-read.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Sources turned down (`tree|S…`) → the research's file they were turned down at. */
const held = new Map<string, string>();
/** What the open viewer shows of reading its source again (redrawn when it changes). */
let drawnKey = '';

/** What the viewer shows of reading a source again. */
interface SourceAgainView {
    /** The research's source (S…), '' none. */
    refn: string;
    /** "Read again…" offered now. */
    offered: boolean;
    /** Its reading under way. */
    running: LiveRead | null;
    /** The last reading of it known here that differs from the transcript. */
    after: ReadResult | null;
}

export const readSourceMethods = uiModule({
    /** The research's file now (its head and import time): a new one lifts what it turned down. */
    readSourceFileMark(): string {
        const ctx = this.researchSyncLink();
        return ctx ? `${ctx.link.head ?? ''}|${ctx.link.syncedAt}` : '';
    },

    /** 409 read.source.noscan / notext: no action at the source until the research's next file. */
    holdReadSourceAgain(refn: string): void {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        held.set(`${treeId}|${refn}`, this.readSourceFileMark());
        this.refreshReadSourceViewer();
    },

    /** The action is held for the source in the research's present file. */
    readSourceAgainHeld(refn: string): boolean {
        const treeId = DataManager.getCurrentTreeId();
        const mark = treeId ? held.get(`${treeId}|${refn}`) : undefined;
        return mark !== undefined && mark === this.readSourceFileMark();
    },

    readSourceAgainView(src: Source): SourceAgainView {
        const none: SourceAgainView = { refn: '', offered: false, running: null, after: null };
        const refn = readSourceId(src.refn?.trim());
        const link = this.researchOriginalsLink();
        if (!refn || !link || this.sourceViewerReadOnly || !this.readDocumentAccepts()) return none;
        const up = this.researchBridgeUp(link.researchId);
        const running = up ? this.readSourceRunning(refn) : null;
        const offered = up && !running && !this.readSourceAgainHeld(refn)
            && readSourceAgainOffered(this.researchStatusOf(link.researchId), src);
        const last = this.readSourceResultOf(refn);
        return { refn, offered, running, after: last?.source?.agree === 'differ' ? last : null };
    },

    /**
     * The links row under the transcript: "Reading result…" (`reading`, when the source has one),
     * "Read again…" or its reading under way, and after a reading that differs, a line saying so.
     */
    readSourceLinksHtml(src: Source, reading: string): string {
        const t = strings.read;
        const view = this.readSourceAgainView(src);
        drawnKey = this.readSourceViewKey(src, view);
        const action = view.running
            ? `<span class="viewer-read-again-live" id="source-viewer-read-again-live"><span class="viewer-read-again-dot" aria-hidden="true"></span>`
              + `<span>${esc(t.readingAgain)}</span> <button type="button" class="link-button viewer-read-again-show" data-read-again-open="${esc(view.running.id)}">${esc(t.show)}</button></span>`
            : view.offered
                ? `<button type="button" class="link-button viewer-read-again" id="source-viewer-read-again" title="${esc(t.sourceAgainTitle)}">${researchBridgeAgentLabel(t.sourceAgain)}</button>`
                : '';
        const row = reading || action ? `<p class="viewer-reading">${reading}${action}</p>` : '';
        const after = view.after && !view.running ? this.readSourceAfterHtml(view.after) : '';
        return `${row}${after}`;
    },

    /** "Read again 6 Nov 2026 · 2 places differ from the transcript · Result ›". */
    readSourceAfterHtml(res: ReadResult): string {
        const t = strings.read;
        const link = this.researchOriginalsLink();
        const live = link ? this.readsOfResearch(link.researchId).find(r => r.id === res.id) : undefined;
        const at = new Date(live?.at || Date.now());
        const date = at.toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'short', year: 'numeric' });
        const n = Math.max(1, res.source?.variants.length ?? 1);
        return `<p class="viewer-read-again-after" id="source-viewer-read-again-after"><span>${esc(t.againAfter(date, n))}</span>`
            + ` <button type="button" class="link-button viewer-read-again-result" data-read-again-open="${esc(res.id)}">${esc(t.againResultLink)}</button></p>`;
    },

    /**
     * "Read again…" beside an excerpt's "Full quality": that excerpt alone, only for a source of one
     * excerpt (a single excerpt of several would be compared with the whole transcript).
     */
    readSourceExcerptHtml(src: Source, excerpts: SourceExcerpt[], i: number): string {
        const view = this.readSourceAgainView(src);
        if (!view.offered || !this.readSourceExcerptClip(src, excerpts, i)) return '';
        const t = strings.read;
        return `<button type="button" class="link-button viewer-read-again viewer-read-again--excerpt" data-read-again-clip="${i}"
                    title="${esc(t.sourceAgainTitle)}">${researchBridgeAgentLabel(t.sourceAgain)}</button>`;
    },

    /** The clip to read the viewer's excerpt `i` by ('' none: the source has other excerpts in the research). */
    readSourceExcerptClip(src: Source, excerpts: SourceExcerpt[], i: number): string {
        const exc = excerpts[i];
        if (!exc) return '';
        // Excerpts the research holds back from the file count too.
        const heldOnes = (src.heldClips ?? []).filter(c => !excerpts.some(e => e.clip === c))
            .map(c => ({ id: `held-${c}`, clip: c }) as SourceExcerpt);
        return readSourceAgainClip({ excerpts: [...excerpts, ...heldOnes] }, exc.id) ?? '';
    },

    wireReadSourceAgain(body: HTMLElement, src: Source, excerpts: SourceExcerpt[]): void {
        body.querySelector('#source-viewer-read-again')?.addEventListener('click', () => this.showReadSourceAgain(src.id));
        body.querySelectorAll<HTMLElement>('[data-read-again-clip]').forEach(el => {
            el.addEventListener('click', () => this.showReadSourceAgain(src.id, this.readSourceExcerptClip(src, excerpts, Number(el.dataset.readAgainClip))));
        });
        body.querySelectorAll<HTMLElement>('[data-read-again-open]').forEach(el => {
            el.addEventListener('click', () => this.showReadDocumentDialog({ readId: el.dataset.readAgainOpen }));
        });
    },

    readSourceViewKey(src: Source, view: SourceAgainView): string {
        return [src.id, view.refn, view.offered, view.running?.id ?? '', view.after?.id ?? '', view.after?.source?.variants.length ?? ''].join('|');
    },

    /** After readings, a refusal or a status: the open viewer redrawn when what it shows of reading again changed. */
    refreshReadSourceViewer(): void {
        const id = this.sourceViewerId;
        if (!id || !document.getElementById('source-viewer-modal')?.classList.contains('active')) return;
        const src = DataManager.getData().sources?.[id];
        if (!src) return;
        if (this.readSourceViewKey(src, this.readSourceAgainView(src)) === drawnKey) return;
        this.renderSourceViewer();
    },
});
