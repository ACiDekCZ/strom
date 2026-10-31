/**
 * Family book UI: a dialog in the export menu that generates the printable book
 * (src/book.ts) and opens it in a new window for the user to print. The
 * dialog's fields map onto the book's options (defaultBookOptions); the full
 * options dialog (1031 §4) will replace it.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PrivacyMode } from '../privacy.js';
import { buildFamilyBook, defaultBookOptions } from '../book.js';
import { bookItalicFontCss } from '../book-font.js';
import { appFontFaceCss, POSTER_SERIF_FACES } from '../poster-fonts.js';
import { uiModule } from './module.js';

export const bookUiMethods = uiModule({
    showBookDialog(): void {
        this.closeMobileMenu?.();
        // Take over the dialog stack from the export menu (same pattern as poster).
        document.getElementById('export-modal')?.classList.remove('active');

        const titleInput = document.getElementById('book-title') as HTMLInputElement | null;
        if (titleInput) titleInput.value = TreeManager.getActiveTreeMetadata()?.name || '';
        // Books are printed and lent out — default to hiding living-person detail.
        const privacy = document.getElementById('book-privacy-mode') as HTMLSelectElement | null;
        if (privacy) privacy.value = 'initials';
        const dropMedia = document.getElementById('book-drop-media') as HTMLInputElement | null;
        if (dropMedia) dropMedia.checked = false;

        // Own the dialog stack (as the poster does): the first Escape closes
        // the book, and no parent dialog can reopen on top of it.
        this.clearDialogStack();
        this.pushDialog('book-modal');
        // The book's tree lays out without the links shown only in the view: said above the options.
        this.renderViewLinksNote(document.querySelector('#book-modal .modal-header'));
        document.getElementById('book-modal')?.classList.add('active');
    },

    closeBookDialog(): void {
        document.getElementById('book-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    generateFamilyBook(): void {
        const data = DataManager.getData();
        if (Object.keys(data.persons).length === 0) {
            this.showAlert(strings.book.empty, 'warning');
            return;
        }

        const title = (document.getElementById('book-title') as HTMLInputElement | null)?.value.trim() || undefined;
        const privacyMode = ((document.getElementById('book-privacy-mode') as HTMLSelectElement | null)?.value || 'initials') as PrivacyMode;
        const dropMedia = (document.getElementById('book-drop-media') as HTMLInputElement | null)?.checked || false;
        const cur = getCurrentLanguage();
        const lang = cur === 'cs' ? 'cs' : cur === 'de' ? 'de' : 'en';
        const defaults = defaultBookOptions(lang);
        const firstId = Object.keys(data.persons)[0];

        const html = buildFamilyBook(data, {
            lang,
            privacy: privacyMode,
            parts: { ...defaults.parts, media: !dropMedia },
            ...(title ? { title } : {}),
        }, {
            treeName: TreeManager.getActiveTreeMetadata()?.name,
            dateLabel: strings.book.compiled(new Date().toLocaleDateString()),
            fontCss: appFontFaceCss(POSTER_SERIF_FACES) + bookItalicFontCss(),
            hasHistory: !!(firstId && this.personPageHistory(firstId)),
            personHistory: (id) => this.personPageHistory(id),
            approveStoryUrl: (p) => this.storyApproveUrl(p.id),
            storyDraftUrls: (owner) => this.storyCompareUrls('person' in owner
                ? { personId: owner.person.id } : { partnershipId: owner.couple.id }),
        });

        this.closeBookDialog();

        // Open in a new window for printing (Ctrl+P). Not embedded in app exports.
        const win = window.open('', '_blank');
        if (!win) { this.showAlert(strings.export.failed, 'warning'); return; }
        win.document.open();
        win.document.write(html);
        win.document.close();
        // "Compare" above a story with a new version: its dialog in the book's window.
        this.wireBookStoryCompare(win.document);
    },
});
