/**
 * Attachments UI for the person modal: the file picker + list, inline notes,
 * a fullscreen image preview, and opening PDFs in a new tab. Each mutation goes
 * straight through DataManager (its own undoable action).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { Attachment } from '../types.js';
import { strings } from '../strings.js';
import { dataUrlByteSize } from '../photo.js';
import {
    compressImageAttachment, readFileAsDataUrl, totalAttachmentBytes,
    MAX_PDF_BYTES, ATTACHMENT_IMAGE_TYPES, ATTACHMENT_WARN_BYTES, pdfBlobFromDataUrl,
} from '../attachments.js';
import { uiModule } from './module.js';
import { emptyStateHtml } from './empty-state.js';

import { iconSvg } from '../icons.js';
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Human-readable byte size (kB / MB). */
function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function isImage(att: Attachment): boolean {
    return att.mimeType.startsWith('image/');
}

/**
 * Capture-phase Escape handler for the fullscreen image preview. Registered
 * only while the overlay is open so that Escape closes ONLY the preview and
 * never falls through to close the underlying edit modal. Kept at module scope
 * so it can be removed on close (no leaks / double-handling).
 */
let attachmentOverlayEscHandler: ((e: KeyboardEvent) => void) | null = null;

/** Convert a data URL to a Blob (for opening PDFs via an object URL). */
export const attachmentsMethods = uiModule({
    /** Render the attachments list + total for the currently edited person. */
    renderAttachmentsList(): void {
        const container = document.getElementById('attachments-list');
        const totalEl = document.getElementById('attachments-total');
        if (!container || !this.currentId) return;
        const person = DataManager.getPerson(this.currentId);
        if (!person) return;

        const attachments = person.attachments ?? [];
        const locked = DataManager.isPersonLocked(this.currentId);

        if (attachments.length === 0) {
            // Compact empty state: the "Add attachment" button sits right below.
            container.innerHTML = emptyStateHtml({
                title: strings.emptyStates.attachmentsTitle,
                text: strings.emptyStates.attachmentsText,
                className: 'attachments-empty',
                compact: true,
            });
        } else {
            container.innerHTML = attachments.map(att => {
                const thumb = isImage(att)
                    ? `<span class="attachment-thumb" data-attachment-id="${esc(att.id)}"><img src="${esc(att.dataUrl)}" alt=""></span>`
                    : `<span class="attachment-thumb" title="PDF" data-attachment-id="${esc(att.id)}">${iconSvg('file', { size: 18 })}</span>`;
                const noteField = locked
                    ? (att.note ? `<span class="attachment-size">${esc(att.note)}</span>` : '')
                    : `<input type="text" class="attachment-note-input" value="${esc(att.note ?? '')}"
                           data-i18n-placeholder="attachments.notePlaceholder"
                           data-attachment-id="${esc(att.id)}">`;
                const del = locked ? '' : `
                    <div class="attachment-actions">
                        <button type="button" class="attachment-delete-btn" title="${esc(strings.attachments.delete)}" aria-label="${esc(strings.attachments.delete)}"
                            data-attachment-id="${esc(att.id)}">${iconSvg('trash')}</button>
                    </div>`;
                return `
                    <div class="attachment-row">
                        ${thumb}
                        <div class="attachment-main">
                            <span class="attachment-name">${esc(att.name)}</span>
                            <span class="attachment-size">${esc(formatBytes(att.sizeBytes))}</span>
                            ${noteField}
                        </div>
                        ${del}
                    </div>`;
            }).join('');
            // Attachment ids come from data files: wire handlers via data
            // attributes, never inline JS (the browser decodes &#39; back to a
            // quote inside an attribute, so escaping cannot protect onclick).
            container.querySelectorAll<HTMLElement>('.attachment-thumb[data-attachment-id]').forEach(el => {
                el.addEventListener('click', () => this.previewAttachment(el.dataset.attachmentId ?? ''));
            });
            container.querySelectorAll<HTMLInputElement>('.attachment-note-input[data-attachment-id]').forEach(el => {
                el.addEventListener('change', () => this.updateAttachmentNoteFromInput(el.dataset.attachmentId ?? '', el.value));
            });
            container.querySelectorAll<HTMLElement>('.attachment-delete-btn[data-attachment-id]').forEach(el => {
                el.addEventListener('click', () => { void this.deleteAttachment(el.dataset.attachmentId ?? ''); });
            });
        }

        // Total + email-size warning.
        if (totalEl) {
            const bytes = totalAttachmentBytes(DataManager.getData());
            if (bytes === 0) {
                totalEl.textContent = '';
                totalEl.className = 'attachments-total';
            } else {
                totalEl.textContent = strings.attachments.total(attachments.length, formatBytes(bytes));
                totalEl.className = bytes > ATTACHMENT_WARN_BYTES ? 'attachments-total warn' : 'attachments-total';
            }
        }

        const addBtn = document.getElementById('btn-add-attachment');
        if (addBtn) addBtn.style.display = locked ? 'none' : '';
    },

    /** Handle a picked file: compress images, size-check PDFs, then attach. */
    async handleAttachmentInput(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !this.currentId) return;

        let dataUrl: string;
        let mimeType: string;
        try {
            if (ATTACHMENT_IMAGE_TYPES.includes(file.type)) {
                // Compressed to a bounded JPEG regardless of source image type.
                dataUrl = await compressImageAttachment(file);
                mimeType = 'image/jpeg';
            } else if (file.type === 'application/pdf') {
                if (file.size > MAX_PDF_BYTES) {
                    this.showAlert(strings.attachments.pdfTooLarge, 'warning');
                    return;
                }
                dataUrl = await readFileAsDataUrl(file);
                mimeType = 'application/pdf';
            } else {
                this.showAlert(strings.attachments.unsupportedType, 'warning');
                return;
            }
        } catch {
            this.showAlert(strings.attachments.readError, 'error');
            return;
        }

        DataManager.addAttachment(this.currentId, {
            name: file.name,
            mimeType,
            dataUrl,
            sizeBytes: dataUrlByteSize(dataUrl),
        });
        this.renderAttachmentsList();
    },

    /** Image → fullscreen overlay; PDF → new tab via an object URL. */
    previewAttachment(attachmentId: string): void {
        if (!this.currentId) return;
        const att = DataManager.getPerson(this.currentId)?.attachments?.find(a => a.id === attachmentId);
        if (!att) return;
        if (isImage(att)) {
            const img = document.getElementById('attachment-overlay-img') as HTMLImageElement | null;
            const overlay = document.getElementById('attachment-overlay');
            if (img) img.src = att.dataUrl;
            overlay?.classList.add('active');
            // Escape closes only the preview — capture-phase + stopPropagation so
            // it never reaches the global handler that would close the edit modal.
            if (!attachmentOverlayEscHandler) {
                attachmentOverlayEscHandler = (e: KeyboardEvent) => {
                    if (e.key !== 'Escape') return;
                    if (!document.getElementById('attachment-overlay')?.classList.contains('active')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.closeAttachmentOverlay();
                };
                document.addEventListener('keydown', attachmentOverlayEscHandler, true);
            }
        } else {
            // Only a PDF is ever opened, and always as application/pdf.
            const blob = pdfBlobFromDataUrl(att.dataUrl, att.mimeType);
            if (!blob) {
                this.showAlert(strings.attachments.unsupportedType, 'warning');
                return;
            }
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            // The tab keeps its own reference; revoke shortly after.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
    },

    closeAttachmentOverlay(): void {
        document.getElementById('attachment-overlay')?.classList.remove('active');
        const img = document.getElementById('attachment-overlay-img') as HTMLImageElement | null;
        if (img) img.src = '';
        if (attachmentOverlayEscHandler) {
            document.removeEventListener('keydown', attachmentOverlayEscHandler, true);
            attachmentOverlayEscHandler = null;
        }
    },

    updateAttachmentNoteFromInput(attachmentId: string, note: string): void {
        if (!this.currentId) return;
        DataManager.updateAttachmentNote(this.currentId, attachmentId, note);
    },

    async deleteAttachment(attachmentId: string): Promise<void> {
        if (!this.currentId) return;
        // Name the file — a list of scans all confirming "Delete this
        // attachment?" tells you nothing about which one you hit.
        const person = DataManager.getPerson(this.currentId);
        const att = person?.attachments?.find(a => a.id === attachmentId);
        if (!att) return;
        const d = strings.danger;
        const confirmed = await this.showConfirm(d.undoHint, d.deleteAttachmentTitle(att.name),
            { confirmLabel: d.deleteAttachment, variant: 'danger' });
        if (!confirmed) return;
        DataManager.removeAttachment(this.currentId, attachmentId);
        this.renderAttachmentsList();
    },
});
