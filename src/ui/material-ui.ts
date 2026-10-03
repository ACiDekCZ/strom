/**
 * "Send material…" to Strom Research — files about a person or a source
 * (letters, photos, scans of a document) that the research keeps with them
 * and turns into a task for the agent (in an archive: just keeps them).
 * Nothing is added to the tree unless "Also add as an attachment" is ticked.
 *
 * The files go the way originals go (originals-ui.ts): straight to a running
 * bridge (`GET` then `PUT /media/<sha256>` with the person's or source's
 * research number and the note), else they wait in the browser's queue —
 * never for an encrypted tree or in Safari, which then need the research
 * running. Only on a computer, only for a research that takes originals.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { PersonId, MediaOriginal } from '../types.js';
import { SettingsManager } from '../settings.js';
import { sha256OfBlob } from '../sha256.js';
import { exifOrientation, originalTargets } from '../originals.js';
import { dataUrlByteSize } from '../photo.js';
import { compressImageAttachment, readFileAsDataUrl, MAX_PDF_BYTES, ATTACHMENT_IMAGE_TYPES } from '../attachments.js';
import { personSubtitle } from './person-sources-ui.js';
import { formatBytesShort, QueueOutcome } from './originals-ui.js';
import { bridgeFailure } from './research-ui.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'material-modal';
/** At most this many files in one go (more: a whole folder belongs to "Add materials"). */
export const MATERIAL_MAX_FILES = 20;
export const MATERIAL_NOTE_MAX = 500;
/** What the research never takes: programs, keys, archives (ZIP comes with batches), family trees (they go by /sync). */
const REFUSED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|sh|app|dmg|pkg|jar|apk|dll|so|dylib|pem|key|p12|pfx|gpg|asc|zip|rar|7z|tar|gz|tgz|bz2|xz|ged|gdz)$/i;

type MaterialTarget = { personId: PersonId } | { sourceId: string };

/** Is a file one the research may take (by its accepted types when it says them, else not a refused kind)? */
export function materialAccepted(name: string, type: string, accepted: { mime: string; ext: string[] }[] | null): boolean {
    if (REFUSED_EXT.test(name)) return false;
    if (!accepted || accepted.length === 0) return true;
    const ext = (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase();
    return accepted.some(t => t.mime === type || t.ext.map(e => e.toLowerCase()).includes(ext));
}

/** The dialog's files while it is open. */
let picked: File[] = [];
let rejected = 0;
let busy = false;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "TIFF", "PDF", "JPG" — the type tile's letters. */
function typeLetters(file: File): string {
    const ext = /\.([^.]+)$/.exec(file.name)?.[1];
    return (ext ?? file.type.split('/')[1] ?? '?').slice(0, 4).toUpperCase();
}

export const materialMethods = uiModule({
    /** "Send material…" is offered: on a computer, a tree linked to a research that takes originals. */
    materialAvailable(): boolean {
        const link = this.researchOriginalsLink();
        return !!link && !!this.researchMediaAccepts(link.researchId);
    },

    showMaterialDialog(target: MaterialTarget): void {
        if (!this.materialAvailable()) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        document.getElementById(DIALOG_ID)?.remove();
        picked = [];
        rejected = 0;
        busy = false;
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'modal-overlay active';
        overlay.dataset.target = JSON.stringify(target);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeMaterialDialog(); });
        this.renderMaterialDialog();
        this.pushDialog(DIALOG_ID);
    },

    materialTarget(): MaterialTarget | null {
        const raw = document.getElementById(DIALOG_ID)?.dataset.target;
        try { return raw ? JSON.parse(raw) as MaterialTarget : null; } catch { return null; }
    },

    /** The dialog's state: the files, the note, the box and the main button for the situation. */
    renderMaterialDialog(): void {
        const overlay = document.getElementById(DIALOG_ID);
        const target = this.materialTarget();
        const link = this.researchOriginalsLink();
        if (!overlay || !target || !link) return;
        const m = strings.material;
        const data = DataManager.getData();
        const isPerson = 'personId' in target;
        const subtitle = isPerson
            ? m.toPerson(personSubtitle(target.personId), '')
            : m.toSource(data.sources?.[target.sourceId]?.title ?? '');
        const archive = this.researchModeOf(link.researchId) === 'archive';
        const up = this.researchBridgeUp(link.researchId);
        const ready = originalTargets(isPerson ? { personId: target.personId } : { sourceId: target.sourceId }, data).ready;
        const bytes = picked.reduce((sum, f) => sum + f.size, 0);
        const cantWait = !up && (SettingsManager.isEncryptionEnabled() || bridgeFailure(null) === 'safari');
        let box: string;
        let primary: { label: string; act: string };
        if (archive && up) {
            box = m.infoArchive;
            primary = { label: m.saveArchive, act: 'send' };
        } else if (cantWait) {
            box = m.cantWait(formatBytesShort(bytes));
            primary = { label: strings.sync.startResearch, act: 'start' };
        } else if (!ready) {
            box = m.infoNoId;
            primary = { label: picked.length ? m.sendN(picked.length) : m.sendFiles, act: 'send' };
        } else if (!up) {
            box = m.infoQueue;
            primary = { label: m.sendLater, act: 'send' };
        } else {
            box = archive ? m.infoArchive : isPerson ? m.infoAgent : m.infoAgentSource;
            primary = { label: archive ? m.saveArchive : picked.length ? m.sendN(picked.length) : m.sendFiles, act: 'send' };
        }
        const note = (overlay.querySelector('#material-note') as HTMLTextAreaElement | null)?.value ?? '';
        const attach = (overlay.querySelector('#material-attach') as HTMLInputElement | null)?.checked ?? false;
        overlay.innerHTML = `
            <div class="modal modal--md material-dialog" role="dialog" data-dialog-kind="form" aria-modal="true" aria-labelledby="material-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="material-title">${esc(m.title)}</h2>
                        <div class="audit-log-subtitle">${esc(subtitle)}</div>
                    </div>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content">
                    <div class="material-drop" tabindex="-1">
                        <button type="button" class="secondary material-pick">${esc(m.pick)}</button>
                        <span class="material-drop-hint">${esc(m.dropHint)}</span>
                        <input type="file" id="material-input" multiple hidden>
                    </div>
                    ${picked.length ? `<ul class="material-list">${picked.map((f, i) => `
                        <li class="material-item">
                            <span class="material-tile" aria-hidden="true">${esc(typeLetters(f))}</span>
                            <span class="material-name">${esc(f.name)}</span>
                            <span class="material-size">${esc(formatBytesShort(f.size))}</span>
                            <button type="button" class="material-remove" data-index="${i}" aria-label="${esc(strings.relationships.remove)}">&times;</button>
                        </li>`).join('')}</ul>` : ''}
                    ${rejected ? `<p class="material-rejected">${esc(m.rejectedTypes(rejected))}</p>` : ''}
                    ${this.batchAvailable() ? `<button type="button" class="research-sync-link material-big-batch">${esc(m.bigBatch)}</button>` : ''}
                    <label class="material-note-label" for="material-note">${esc(m.note)}</label>
                    <textarea id="material-note" rows="2" maxlength="${MATERIAL_NOTE_MAX}">${esc(note)}</textarea>
                    <div class="material-note-count">${note.length} / ${MATERIAL_NOTE_MAX}</div>
                    ${isPerson ? `
                    <label class="confirm-check material-attach">
                        <input type="checkbox" id="material-attach"${attach ? ' checked' : ''}>
                        <span><span class="confirm-check-label">${esc(m.alsoAttach)}</span><span class="confirm-check-hint">${esc(m.alsoAttachHint)}</span></span>
                    </label>` : ''}
                    <p class="material-box${cantWait ? ' is-warn' : ''}"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(box)}</span></p>
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.cancel)}</button>
                    <button type="button" class="primary material-go" data-act="${primary.act}"${picked.length === 0 && primary.act === 'send' ? ' disabled' : ''}>${esc(busy ? m.sendingK(0, picked.length) : primary.label)}</button>
                </div>
            </div>`;
        const input = overlay.querySelector<HTMLInputElement>('#material-input');
        overlay.querySelector('.close-btn')?.addEventListener('click', () => this.closeMaterialDialog());
        overlay.querySelector('[data-dismiss]')?.addEventListener('click', () => this.closeMaterialDialog());
        overlay.querySelector('.material-pick')?.addEventListener('click', () => input?.click());
        overlay.querySelector('.material-big-batch')?.addEventListener('click', () => {
            const personId = 'personId' in target ? target.personId : undefined;
            this.closeMaterialDialog();
            this.showBatchDialog(personId ? { personId } : {});
        });
        input?.addEventListener('change', () => { this.addMaterialFiles(Array.from(input.files ?? [])); });
        const drop = overlay.querySelector<HTMLElement>('.material-drop');
        drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        drop?.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop?.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.remove('is-over');
            this.addMaterialFiles(Array.from(e.dataTransfer?.files ?? []));
        });
        overlay.querySelectorAll<HTMLButtonElement>('.material-remove').forEach(btn => btn.addEventListener('click', () => {
            picked.splice(Number(btn.dataset.index), 1);
            this.renderMaterialDialog();
        }));
        const noteEl = overlay.querySelector<HTMLTextAreaElement>('#material-note');
        noteEl?.addEventListener('input', () => {
            const count = overlay.querySelector('.material-note-count');
            if (count) count.textContent = `${noteEl.value.length} / ${MATERIAL_NOTE_MAX}`;
        });
        overlay.querySelector<HTMLButtonElement>('.material-go')?.addEventListener('click', (e) => {
            const act = (e.currentTarget as HTMLElement).dataset.act;
            if (act === 'start') this.researchSyncAction('startResearch');
            else void this.sendMaterial();
        });
    },

    /** Add picked / dropped files: up to 20, kinds the research takes. */
    addMaterialFiles(files: File[]): void {
        const link = this.researchOriginalsLink();
        if (!link) return;
        const accepted = this.researchAcceptsOf(link.researchId)?.mediaTypes ?? null;
        for (const f of files) {
            if (!materialAccepted(f.name, f.type, accepted)) { rejected++; continue; }
            if (picked.length >= MATERIAL_MAX_FILES) break;
            if (picked.some(p => p.name === f.name && p.size === f.size)) continue;
            picked.push(f);
        }
        this.renderMaterialDialog();
    },

    /**
     * Send (or queue) every picked file with the person or source and the
     * note; with "Also add as an attachment", the person gets attachments too
     * (their originals are the same files: nothing goes twice).
     */
    async sendMaterial(): Promise<void> {
        const overlay = document.getElementById(DIALOG_ID);
        const target = this.materialTarget();
        const link = this.researchOriginalsLink();
        if (!overlay || !target || !link || busy || picked.length === 0) return;
        const m = strings.material;
        busy = true;
        const note = (overlay.querySelector('#material-note') as HTMLTextAreaElement | null)?.value.trim().slice(0, MATERIAL_NOTE_MAX) ?? '';
        const attach = 'personId' in target && !!(overlay.querySelector('#material-attach') as HTMLInputElement | null)?.checked;
        const files = [...picked];
        const go = overlay.querySelector<HTMLButtonElement>('.material-go');
        const queuedShas: string[] = [];
        let known = 0;
        /** Files not sent nor waiting, with why (the first one is named). */
        const failed: { name: string; why: string }[] = [];
        const archive = this.researchModeOf(link.researchId) === 'archive';
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (go) { go.disabled = true; go.textContent = m.sendingK(i + 1, files.length); }
            let original: MediaOriginal;
            try {
                const sha256 = await sha256OfBlob(file);
                const orientation = exifOrientation(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
                original = { sha256, name: file.name, mimeType: file.type || 'application/octet-stream', bytes: file.size,
                    ...(orientation > 1 ? { orientation } : {}) };
            } catch {
                failed.push({ name: file.name, why: m.whyUnreadable });
                continue;
            }
            if (attach && 'personId' in target) await this.attachMaterialFile(target.personId, file, original);
            const outcome = await this.queueOriginal(original, file, { ...target, note, material: true });
            if (outcome === 'queued') queuedShas.push(original.sha256);
            else if (outcome === 'known') known++;
            else if (outcome !== 'sent') failed.push({ name: file.name, why: this.materialWhy(outcome, link.researchId) });
        }
        // What waits goes now when the bridge runs (one at a time); waited for, so the toast tells what is left.
        if (queuedShas.length) await this.researchOriginalsKick();
        const stillWaiting = queuedShas.filter(sha => this.originalStillQueued(link.treeId, sha)).length;
        busy = false;
        this.closeMaterialDialog();
        this.renderAttachmentsList();
        const name = 'personId' in target ? personSubtitle(target.personId).split(' · ')[0]
            : DataManager.getData().sources?.[target.sourceId]?.title ?? '';
        const ready = originalTargets('personId' in target ? { personId: target.personId } : { sourceId: target.sourceId }, DataManager.getData()).ready;
        const done = files.length - stillWaiting - failed.length;
        const sent = done - known;
        // The research had some already: said so (no task comes of them), never as "sent".
        const knownPart = known > 0 ? ` ${m.alreadyHadPart(known)}` : '';
        if (failed.length) {
            this.showToast(m.partialToast(done, files.length, failed[0].name, failed[0].why) + knownPart, 8000, { closable: true });
        } else if (stillWaiting > 0) {
            this.showToast((ready ? m.queuedToast(stillWaiting) : m.noIdToast(stillWaiting)) + knownPart, 6000, { closable: true });
        } else if (sent === 0 && known > 0) {
            this.showToast(m.alreadyHadToast(known), 6000, { closable: true });
        } else {
            this.showToast((archive ? m.savedArchiveToast(sent, name) : m.sentToast(sent, name)) + knownPart, 6000, { closable: true });
        }
    },

    /** Why a file of the material went nowhere (the app's own reason: it never reached the research). */
    materialWhy(outcome: QueueOutcome, researchId: string): string {
        const m = strings.material;
        switch (outcome) {
            case 'tooLarge': return m.whyTooLarge(formatBytesShort(this.researchMediaAccepts(researchId)?.maxBytes ?? 0));
            case 'noRoom': return m.whyNoRoom;
            case 'safari': return m.whySafari;
            case 'encrypted': return m.whyEncrypted;
            case 'notTaken': case 'notLinked': return m.whyNotTaken;
            default: return m.whyFailed;
        }
    },

    /** "Also add as an attachment": a preview in the tree like a normal attachment (an image or a PDF). */
    async attachMaterialFile(personId: PersonId, file: File, original: MediaOriginal): Promise<void> {
        try {
            let dataUrl: string;
            let mimeType: string;
            if (ATTACHMENT_IMAGE_TYPES.includes(file.type)) {
                dataUrl = await compressImageAttachment(file);
                mimeType = 'image/jpeg';
            } else if (file.type === 'application/pdf' && file.size <= MAX_PDF_BYTES) {
                dataUrl = await readFileAsDataUrl(file);
                mimeType = 'application/pdf';
            } else {
                return;
            }
            DataManager.addAttachment(personId, { name: file.name, mimeType, dataUrl, sizeBytes: dataUrlByteSize(dataUrl), original });
        } catch (err) {
            console.warn('Adding the material as an attachment failed', err);
        }
    },

    closeMaterialDialog(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        picked = [];
        rejected = 0;
    },
});
