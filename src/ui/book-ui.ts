/**
 * Family book UI: a dialog in the export menu that generates the printable book
 * (src/book.ts) and opens it in a new window for the user to print. The tree
 * SVG is produced here (via the poster layout) and handed to the pure generator.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PrivacyMode, applyLivingPrivacy } from '../privacy.js';
import { stripMedia } from '../attachments.js';
import { buildFamilyBook } from '../book.js';
import { buildTreeSvg } from '../export-image.js';
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
        const maxGen = document.getElementById('book-max-gen') as HTMLInputElement | null;
        if (maxGen) maxGen.value = '';
        const dropMedia = document.getElementById('book-drop-media') as HTMLInputElement | null;
        if (dropMedia) dropMedia.checked = false;

        document.getElementById('book-modal')?.classList.add('active');
    },

    closeBookDialog(): void {
        document.getElementById('book-modal')?.classList.remove('active');
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
        const maxGenRaw = (document.getElementById('book-max-gen') as HTMLInputElement | null)?.value.trim() || '';
        const maxGenerations = maxGenRaw ? Math.max(1, parseInt(maxGenRaw, 10)) : undefined;
        const cur = getCurrentLanguage();
        const lang = cur === 'cs' ? 'cs' : cur === 'de' ? 'de' : 'en';

        // The tree overview SVG (drop media strips photos there too, if requested).
        let treeSvg: string | undefined;
        const layout = TreeRenderer.getPosterLayout();
        if (layout.positions.size > 0) {
            // The overview SVG must honour the same privacy/media choices as
            // the book body — otherwise the tree page leaks living names.
            let svgData = applyLivingPrivacy(data, privacyMode);
            if (dropMedia) svgData = stripMedia(svgData);
            treeSvg = buildTreeSvg(svgData, layout, {
                treeName: TreeManager.getActiveTreeMetadata()?.name,
                dateLabel: new Date().toLocaleDateString(),
            });
        }

        const html = buildFamilyBook(data, {
            title,
            lang,
            privacyMode,
            dropMedia,
            maxGenerations,
            treeSvg,
            dateLabel: strings.book.compiled(new Date().toLocaleDateString()),
        });

        this.closeBookDialog();

        // Open in a new window for printing (Ctrl+P). Not embedded in app exports.
        const win = window.open('', '_blank');
        if (!win) { this.showAlert(strings.export.failed, 'warning'); return; }
        win.document.open();
        win.document.write(html);
        win.document.close();
    },
});
