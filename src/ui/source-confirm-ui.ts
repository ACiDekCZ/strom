/**
 * "Confirm transcription" / "Undo confirmation" in the source viewer (spec 022):
 * the line saying who read the entry, with a small text button at its end
 * while the research's bridge takes it (`sources.confirm`), at rest with a
 * sentence when the bridge is not running, and the research's answer under
 * it. No mark: the action stays in the app and goes through the bridge.
 *
 * The answer is shown at once but never written into the tree: the research
 * writes it and its next version brings the same (`_STROM_READ`, `_CONF`,
 * `_TXT`), so the tree stays in step with the research. Until then the
 * answer stands over the source's own state (`said`). See src/source-confirm.ts.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { Source } from '../types.js';
import { strings } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { uiModule } from './module.js';
import { onBridgeStatus, lastBridgeStatus } from './research-sync-ui.js';
import { bridgeBase } from './history-ui.js';
import {
    postSourceConfirm, sourceConfirmAction, sourceConfirmOffer, sourceConfirmRef, sourceReadState,
    type SourceConfirmAction, type SourceConfirmOffer, type SourceReadState,
} from '../source-confirm.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The research's answer, over the source's own state until the tree has it. */
interface Said extends SourceReadState {
    /** The source's mark of the wording when it was asked: another one in the tree = a newer version came. */
    asked: string;
    /** The research's version after the write ('' not said): the tree at it has the answer. */
    head: string;
}

/**
 * A sentence under the line. `blocks`: the action is not offered while the
 * source's wording is this one (a refusal that waits for the research's next
 * file: the wording changed, the source merged, withdrawn, …).
 */
interface Note { text: string; mark: string; blocks: boolean }

const said = new Map<string, Said>();
const notes = new Map<string, Note>();
const busy = new Set<string>();
let listening = false;
/** The line as last drawn: redrawn only when it changes. */
let lastRowHtml = '';

const keyOf = (treeId: string, sourceId: string): string => `${treeId}|${sourceId}`;

export const sourceConfirmMethods = uiModule({
    /** Who read the source as the app shows it now: the research's answer until the tree has it. */
    sourceConfirmState(src: Source): SourceReadState {
        const own = sourceReadState(src);
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return own;
        const key = keyOf(treeId, src.id);
        const s = said.get(key);
        if (!s) return own;
        const head = TreeManager.getTreeMetadata(treeId)?.research?.head ?? '';
        const caughtUp = own.read === s.read && own.conf === s.conf && own.txt === s.txt;
        // A newer version of the source came (another wording), or the tree is at the written version.
        const moved = own.txt !== s.asked && own.txt !== s.txt;
        if (caughtUp || moved || (!!s.head && head === s.head)) {
            said.delete(key);
            return own;
        }
        return { read: s.read, conf: s.conf, txt: s.txt };
    },

    /** What the viewer offers for the source now. */
    sourceConfirmOfferFor(src: Source, state: SourceReadState): SourceConfirmOffer {
        const ctx = this.researchSyncLink();
        const treeId = DataManager.getCurrentTreeId();
        if (!ctx || !treeId) return { kind: 'none' };
        const key = keyOf(treeId, src.id);
        const note = notes.get(key);
        // Another wording came: what was said of the old one goes.
        if (note && note.mark !== state.txt) notes.delete(key);
        else if (note?.blocks) return { kind: 'none' };
        const rid = ctx.link.id;
        const up = this.researchBridgeUp(rid) && !!bridgeBase(rid);
        const features = up ? this.researchStatusOf(rid)?.features : (this.researchStatusOf(rid) ?? lastBridgeStatus(rid))?.features;
        return sourceConfirmOffer(sourceConfirmAction(src, state), {
            features,
            bridgeUp: up,
            agentless: this.activeResearchAgentless(),
            readOnly: DataManager.isReadOnly() || DataManager.isTreeLocked(),
        });
    },

    /** The line under the transcript: who read it, the action at its end, the sentence under it ('' none). */
    sourceReadByHtml(src: Source): string {
        const s = strings.sources;
        const state = this.sourceConfirmState(src);
        const text = state.read === 'both' && state.conf ? s.readConfirmed(formatFlexDate(state.conf))
            : state.read ? s.readBy[state.read] : '';
        const offer = this.sourceConfirmOfferFor(src, state);
        const treeId = DataManager.getCurrentTreeId();
        const key = treeId ? keyOf(treeId, src.id) : '';
        const c = s.confirm;
        let button = '';
        let note = key ? notes.get(key)?.text ?? '' : '';
        if (offer.kind === 'ready') {
            const undo = offer.action === 'unconfirm';
            button = ` <button type="button" class="link-button viewer-confirm" id="source-viewer-confirm" data-action="${offer.action}"
                title="${esc(undo ? c.undoTitle : c.actionTitle)}"${busy.has(key) ? ' disabled aria-busy="true"' : ''}>${esc(undo ? c.undo : c.action)}</button>`;
        } else if (offer.kind === 'rest') {
            note = offer.action === 'unconfirm' ? c.restUndo : c.restConfirm;
        }
        this.sourceConfirmListen();
        if (!text && !button && !note) return lastRowHtml = '';
        return lastRowHtml = `<div class="viewer-read-by-row" id="source-viewer-read-by">${text || button
            ? `<p class="viewer-read-by-line">${text ? `<span class="viewer-read-by">${esc(text)}</span>` : ''}${button}</p>` : ''}${note
            ? `<p class="viewer-confirm-note" id="source-viewer-confirm-note" role="status">${esc(note)}</p>` : ''}</div>`;
    },

    /** The button's click (after the viewer's body is drawn). */
    wireSourceConfirm(body: HTMLElement, src: Source): void {
        const btn = body.querySelector<HTMLButtonElement>('#source-viewer-confirm');
        btn?.addEventListener('click', () => void this.sendSourceConfirm(src.id, btn.dataset.action as SourceConfirmAction));
    },

    /** Draw the line again in place (the rest of the viewer stays: its images, its scroll). */
    refreshSourceReadBy(): void {
        const id = this.sourceViewerId;
        const modal = document.getElementById('source-viewer-modal');
        const host = document.getElementById('source-viewer-read-by');
        const src = id ? DataManager.getData().sources?.[id] : undefined;
        if (!src || !modal?.classList.contains('active')) return;
        const before = lastRowHtml;
        const html = this.sourceReadByHtml(src);
        if (!host) {
            if (html && src.transcript) this.renderSourceViewer();
            return;
        }
        if (html === before) return;
        const focused = document.activeElement?.id === 'source-viewer-confirm';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const next = tmp.firstElementChild;
        if (next) host.replaceWith(next);
        else host.remove();
        const body = document.getElementById('source-viewer-body');
        if (body) this.wireSourceConfirm(body, src);
        if (focused) document.getElementById('source-viewer-confirm')?.focus({ preventScroll: true });
    },

    /** The bridge coming or going changes what the line offers (registered on the first line drawn). */
    sourceConfirmListen(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((rid) => {
            const ctx = this.researchSyncLink();
            if (ctx && ctx.link.id.toLowerCase() === rid.toLowerCase()) this.refreshSourceReadBy();
        });
    },

    /** `POST /sources/confirm`: the answer shown at once; a refusal said under the line. */
    async sendSourceConfirm(sourceId: string, action: SourceConfirmAction): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        const src = DataManager.getData().sources?.[sourceId];
        const ctx = this.researchSyncLink();
        if (!treeId || !src || !ctx) return;
        const key = keyOf(treeId, sourceId);
        const state = this.sourceConfirmState(src);
        const offer = this.sourceConfirmOfferFor(src, state);
        const base = bridgeBase(ctx.link.id);
        const ref = sourceConfirmRef(src.refn);
        if (busy.has(key) || offer.kind !== 'ready' || offer.action !== action || !base || !ref) return;
        busy.add(key);
        notes.delete(key);
        this.refreshSourceReadBy();
        const features = this.researchStatusOf(ctx.link.id)?.features;
        const res = await postSourceConfirm(base, { source: ref, txt: state.txt, confirm: action === 'confirm' }, features);
        busy.delete(key);
        const c = strings.sources.confirm;
        if (res.ok) {
            said.set(key, { read: res.read, conf: res.conf, txt: res.txt, asked: sourceReadState(src).txt, head: res.head });
        } else {
            const wait = (text: string): Note => ({ text, mark: state.txt, blocks: true });
            const say = (text: string): Note => ({ text, mark: state.txt, blocks: false });
            const note = res.code === 'changed' ? wait(c.changed)
                : res.code === 'merged' ? wait(c.merged)
                    : res.code === 'retracted' ? wait(c.retracted)
                        : res.code === 'reader' ? wait(c.reader)
                            : res.code === 'none' ? wait(c.none)
                                : res.code === 'archive' ? wait(c.archive)
                                    : res.code === 'busy' ? say(strings.history.errBusy)
                                        : res.code === 'locked' ? say(c.locked)
                                            : res.code === 'held' && res.held ? say(this.researchWriteHeldText(res.held, false).toast)
                                                : res.code === 'network' ? say(strings.history.storiesBridgeDown)
                                                    : say(strings.live.waitingWrite.writeFailed);
            notes.set(key, note);
        }
        if (DataManager.getCurrentTreeId() === treeId && this.sourceViewerId === sourceId) this.refreshSourceReadBy();
    },
});
