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
    compressImageAttachment, readFileAsDataUrl, personMedia,
    MAX_PDF_BYTES, ATTACHMENT_IMAGE_TYPES, pdfBlobFromDataUrl,
} from '../attachments.js';
import { uiModule } from './module.js';
import { openImageViewer, ViewerOriginal } from './image-viewer.js';
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
                // Where its original stands (only a tree linked to a research).
                const { line: origLine, link: fullLink } = this.mediaStateHtml(
                    { sha: att.original?.sha256, bytes: att.original?.bytes, personId: this.currentId ?? undefined, previewBytes: att.sizeBytes },
                    att.original?.mimeType ?? att.mimeType, `data-attachment-id="${esc(att.id)}"`);
                return `
                    <div class="attachment-row">
                        ${thumb}
                        <div class="attachment-main">
                            <span class="attachment-name">${esc(att.name)}</span>
                            <span class="attachment-size">${esc(formatBytes(att.sizeBytes))}</span>
                            ${origLine}
                            ${noteField}
                        </div>
                        ${fullLink}
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
            container.querySelectorAll<HTMLElement>('.media-full-quality[data-attachment-id]').forEach(el => {
                el.addEventListener('click', () => this.openAttachmentFullQuality(el.dataset.attachmentId ?? ''));
            });
        }

        // What this person brings into the file, each part named (the whole
        // tree's size belongs to the tree statistics, not to one person).
        if (totalEl) {
            const m = personMedia(person, DataManager.getData());
            const A = strings.attachments;
            const parts = [
                m.photoBytes > 0 ? A.partPhoto(formatBytes(m.photoBytes)) : '',
                m.attachments > 0 ? A.partAttachments(m.attachments, formatBytes(m.attachmentBytes)) : '',
                m.excerpts > 0 ? A.partExcerpts(m.excerpts, formatBytes(m.excerptBytes)) : '',
            ].filter(Boolean);
            totalEl.textContent = parts.length > 0 ? A.personTotal(parts.join(' · ')) : '';
            totalEl.className = 'attachments-total';
        }

        const addBtn = document.getElementById('btn-add-attachment');
        if (addBtn) addBtn.style.display = locked ? 'none' : '';
        // A research that does not take originals yet: one quiet line by the heading.
        const older = document.getElementById('attachments-older-research');
        if (older) {
            older.hidden = !this.researchMediaOlder();
            older.textContent = strings.media.olderResearch;
        }
    },

    /** Handle a picked file: compress images, size-check PDFs, then attach. */
    async handleAttachmentInput(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !this.currentId) return;
        const personId = this.currentId;
        // The original's identity before it is shrunk (a tree linked to a research only).
        const original = ATTACHMENT_IMAGE_TYPES.includes(file.type) || file.type === 'application/pdf'
            ? await this.prepareOriginal(file, file.name) : null;

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

        DataManager.addAttachment(personId, {
            name: file.name,
            mimeType,
            dataUrl,
            sizeBytes: dataUrlByteSize(dataUrl),
            ...(original ? { original } : {}),
        });
        this.renderAttachmentsList();
        if (original) {
            const outcome = await this.queueOriginal(original, file, { personId });
            this.noteOriginalOutcome(outcome, file.size, { personId });
            this.renderAttachmentsList();
        }
    },

    /** Image → fullscreen overlay; PDF → new tab via an object URL. */
    previewAttachment(attachmentId: string): void {
        if (!this.currentId) return;
        const att = DataManager.getPerson(this.currentId)?.attachments?.find(a => a.id === attachmentId);
        if (!att) return;
        if (isImage(att)) {
            const sha = att.original?.sha256;
            const mode = this.fullQualityMode(sha, att.original?.mimeType ?? '', att.original?.bytes ?? 0);
            openImageViewer(att.dataUrl, undefined, mode === 'app' && sha ? this.viewerOriginal(sha) : undefined);
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

    /** "Full quality" on an attachment's row: here (from the bridge) or in the research. */
    openAttachmentFullQuality(attachmentId: string): void {
        if (!this.currentId) return;
        const att = DataManager.getPerson(this.currentId)?.attachments?.find(a => a.id === attachmentId);
        const sha = att?.original?.sha256;
        if (!att || !sha) return;
        this.openFullQuality(sha, att.original?.mimeType ?? att.mimeType, att.original?.bytes ?? 0, isImage(att) ? att.dataUrl : null);
    },

    /**
     * Open an original in full quality: an image in the viewer (the preview
     * first, the original loading over it), a PDF in a new tab, anything else
     * (or too large, or the bridge not running) in the research.
     */
    openFullQuality(sha: string, mimeType: string, bytes: number, previewUrl: string | null): void {
        const mode = this.fullQualityMode(sha, mimeType, bytes);
        if (mode === 'external' || (mode === null && this.researchLinkAvailable('media'))) {
            this.openOriginalInResearch(sha);
            return;
        }
        if (mode !== 'app') return;
        if (mimeType === 'application/pdf') {
            const ctl = new AbortController();
            void this.fetchOriginal(sha, () => { /* a tab opens when it is here */ }, ctl.signal).then(({ url }) => {
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }, () => this.showToast(strings.media.loadFailed, 6000));
            return;
        }
        openImageViewer(previewUrl ?? '', undefined, { ...this.viewerOriginal(sha), autoLoad: true });
    },

    /** The image viewer's "Full quality": the original fetched from the bridge, with its progress. */
    viewerOriginal(sha: string): ViewerOriginal {
        const m = strings.media;
        return {
            label: strings.research.fullQuality,
            title: strings.research.fullQualityAppTitle,
            loading: m.loadingOriginal,
            loadedOf: (a, b) => m.loadedOf(formatBytes(a), formatBytes(b)),
            chip: (w, h, size) => m.originalChip(String(w), String(h), formatBytes(size)),
            back: m.backToPreview,
            cancel: strings.buttons.cancel,
            load: (progress, signal) => this.fetchOriginal(sha, progress, signal),
            onError: (err) => {
                if ((err as Error)?.name === 'AbortError') return;
                this.showToast(this.originalGone(sha) ? m.gone : m.loadFailed, 6000);
                this.renderAttachmentsList();
            },
        };
    },

    /**
     * The third line of a row (attachment, excerpt) saying where its original
     * stands, and the "Full quality" link beside it. Empty for a tree without
     * a research.
     */
    mediaStateHtml(item: { sha?: string | null; bytes?: number; personId?: string; sourceId?: string; previewBytes?: number; fromResearch?: boolean },
        mimeType: string, dataAttr: string): { line: string; link: string } {
        const state = this.mediaStateOf({ ...item, personId: item.personId as never });
        if (!state) return { line: '', link: '' };
        const m = strings.media;
        const line = (icon: string, text: string, cls: string, title = ''): string =>
            `<span class="media-state ${cls}"${title ? ` title="${esc(title)}"` : ''}>${icon}<span>${esc(text)}</span></span>`;
        const ring = '<span class="media-ring" aria-hidden="true"></span>';
        const spin = '<span class="media-spinner" aria-hidden="true"></span>';
        switch (state.kind) {
            case 'queued': {
                const bigger = state.bytes > 0 && item.previewBytes !== undefined && Math.abs(state.bytes - item.previewBytes) > 1024;
                return { line: line(ring, state.noId ? m.queuedNoId : bigger ? m.queuedSize(formatBytes(state.bytes)) : m.queued, 'is-queued'), link: '' };
            }
            case 'sending': return { line: line(spin, m.sending, 'is-sending'), link: '' };
            case 'gone': return { line: line('', m.gone, 'is-quiet'), link: '' };
            case 'previewOnly': {
                const why = state.why === 'room' ? m.previewOnlyWhyRoom : state.why === 'encrypted' ? m.previewOnlyWhyEncrypted
                    : state.why === 'off' ? m.previewOnlyWhyOff : state.why === 'older' ? m.previewOnlyWhyOlder
                    : state.why === 'safari' ? m.safariPreviewOnly : '';
                return { line: line('', m.previewOnly, 'is-quiet', why), link: '' };
            }
            case 'inResearch': {
                const mode = this.fullQualityMode(item.sha, mimeType, item.bytes ?? 0);
                if (!mode) return { line: line('<span class="media-dot" aria-hidden="true"></span>', m.inResearch, 'is-in'), link: '' };
                const label = mode === 'app' ? strings.research.fullQuality : strings.research.fullQualityExternal;
                const title = mode === 'app' ? strings.research.fullQualityAppTitle : strings.research.fullQualityTitle;
                return { line: '', link: `<button type="button" class="link-button media-full-quality" ${dataAttr} title="${esc(title)}">${esc(label)}</button>` };
            }
        }
    },

    /** Fullscreen preview of an image (attachment, source excerpt): zoom and pan. */
    showAttachmentImage(dataUrl: string): void {
        openImageViewer(dataUrl);
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
        const m = strings.media;
        // Its original: waiting → discard it too (ticked), or send it and let the research detach it;
        // in the research → it stays there, only detached.
        const state = this.mediaStateOf({ sha: att.original?.sha256, bytes: att.original?.bytes, personId: this.currentId });
        const queuedOriginal = state?.kind === 'queued' || state?.kind === 'sending';
        const archiveNote = this.researchArchiveDeleteNote();
        const note = state?.kind === 'inResearch'
            ? { tag: archiveNote?.tag ?? strings.research.brand, text: m.deleteDetach }
            : archiveNote;
        const confirmed = await this.showConfirm(d.undoHint, d.deleteAttachmentTitle(att.name), {
            confirmLabel: d.deleteAttachment, variant: 'danger', note,
            ...(queuedOriginal ? { checkbox: { label: m.deleteDiscard(formatBytes(att.original?.bytes ?? 0)), hint: m.deleteDiscardHint, checked: true } } : {}),
        });
        if (!confirmed) return;
        const sha = att.original?.sha256;
        if (queuedOriginal && sha) await this.settleQueuedOriginal(sha, this.confirmChecked);
        DataManager.removeAttachment(this.currentId, attachmentId);
        this.renderAttachmentsList();
    },
});
