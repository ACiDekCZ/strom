/**
 * Relationship calculator UI: pick a second person, show the kinship term
 * (Czech/English) and highlight the connecting path in the tree. Only the
 * tree's real links count; a path that only the links "linked in the view
 * only" make is said apart (src/view-link-kinship.ts).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId } from '../types.js';
import { PersonPicker } from '../person-picker.js';
import { findRelationship } from '../kinship.js';
import { viewOnlyRelationship } from '../view-link-kinship.js';
import { uiModule } from './module.js';
import { shownName } from '../person-name.js';

function personName(id: PersonId): string {
    const p = DataManager.getPerson(id);
    if (!p) return '?';
    return shownName(p);
}

export const kinshipUiMethods = uiModule({
    showRelationshipCalculator(fromId: PersonId): void {
        this.closeRelationshipCalculator();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'kinship-modal';
        overlay.innerHTML = `
            <div class="modal kinship-modal modal--sm" role="dialog" data-dialog-kind="info" aria-modal="true">
                <div class="modal-header">
                    <h2>${strings.kinship.title}</h2>
                    <button class="close-btn" id="kinship-close-x" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                <p class="kinship-from">${strings.kinship.fromLabel}: <strong>${this.escapeHtml(personName(fromId))}</strong></p>
                <div id="kinship-picker-container">
                    <label>${strings.kinship.pickLabel}</label>
                    <div id="kinship-picker"></div>
                </div>
                <div id="kinship-result" class="kinship-result" style="display:none"></div>
                <div class="buttons" id="kinship-footer">
                    <button type="button" class="secondary" id="kinship-close" data-dismiss>${strings.buttons.close}</button>
                    <button type="button" class="primary" id="kinship-highlight" hidden>${strings.kinship.highlight}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        let currentPath: PersonId[] = [];

        const close = () => this.closeRelationshipCalculator();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#kinship-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#kinship-close') as HTMLButtonElement).onclick = close;
        // ESC support via the shared dialog stack (see misc.ts keyboard handler).
        this.clearDialogStack();
        this.pushDialog('kinship-modal');

        const highlightBtn = overlay.querySelector('#kinship-highlight') as HTMLButtonElement;
        highlightBtn.onclick = () => {
            TreeRenderer.highlightPath(currentPath);
            close();
        };

        const treeData = DataManager.getData();
        // Placeholders ("unknown parent") are not people one asks about.
        const persons = Object.values(treeData?.persons ?? {}).filter(p => p.id !== fromId && !p.isPlaceholder);

        this.kinshipPicker = new PersonPicker({
            containerId: 'kinship-picker',
            placeholder: strings.personPicker.placeholder,
            showBirthYear: true,
            persons,
            onSelect: (toId: PersonId) => {
                const resultEl = overlay.querySelector('#kinship-result') as HTMLElement;
                const relation = findRelationship(treeData!, fromId, toId);
                resultEl.style.display = 'block';

                const cur = getCurrentLanguage();
                const lang = cur === 'cs' ? 'cs' : cur === 'de' ? 'de' : 'en';
                if (!relation) {
                    const viewOnly = viewOnlyRelationship(treeData!, TreeRenderer.getViewLayer()?.links ?? [], fromId, toId);
                    if (viewOnly) {
                        const v = strings.viewLinks;
                        const ref = viewOnly.via.map(l => `${l.hypo} ${l.variant}`).join(', ');
                        resultEl.innerHTML = `
                            <p class="kinship-no-real">${this.escapeHtml(v.noReal)}</p>
                            <p class="kinship-view-only"><span class="view-link-icon" aria-hidden="true"></span>${this.escapeHtml(v.viewOnlyRelation(viewOnly.relation.term[lang], ref))}</p>
                        `;
                    } else {
                        resultEl.innerHTML = `<p>${strings.kinship.noRelation}</p>`;
                    }
                    highlightBtn.hidden = true;
                    currentPath = [];
                    return;
                }

                const pathNames = relation.path.map(id => this.escapeHtml(personName(id))).join(' → ');
                resultEl.innerHTML = `
                    <p class="kinship-sentence"><strong>${this.escapeHtml(personName(toId))}</strong>
                        ${strings.kinship.isOf} <strong>${this.escapeHtml(personName(fromId))}</strong>:
                        <span class="kinship-term">${this.escapeHtml(relation.term[lang])}</span></p>
                    <p class="kinship-path">${pathNames}</p>
                `;
                currentPath = relation.path;
                // Highlighting needs the path on screen.
                highlightBtn.hidden = !relation.path.some(id => TreeRenderer.isVisible(id));
            },
        });
    },

    closeRelationshipCalculator(): void {
        if (this.kinshipPicker) {
            this.kinshipPicker.destroy();
            this.kinshipPicker = null;
        }
        document.getElementById('kinship-modal')?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== 'kinship-modal');
    },
});
