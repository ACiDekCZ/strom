/**
 * Archive search dialog: prefilled FamilySearch link for anyone, plus Czech
 * register (matriky) portals when relevant (Czech UI language or a place in
 * the person's data matching a Czech district).
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId } from '../types.js';
import {
    ARCHIVE_PORTALS,
    suggestArchives,
    personPlaces,
    familySearchUrl,
    isCzechRelevant,
} from '../archives.js';
import { uiModule } from './module.js';

export const archivesUiMethods = uiModule({
    showArchiveSearch(personId: PersonId): void {
        this.closeArchiveSearch();
        const person = DataManager.getPerson(personId);
        if (!person) return;

        const lang = getCurrentLanguage();
        const name = `${person.firstName} ${person.lastName}`.trim() || '?';
        const places = personPlaces(person);

        // Suggested Czech portals from the person's places
        const suggested = new Map<string, { portal: typeof ARCHIVE_PORTALS[number]; place: string }>();
        for (const place of places) {
            for (const portal of suggestArchives(place)) {
                if (!suggested.has(portal.id)) suggested.set(portal.id, { portal, place });
            }
        }

        const czech = isCzechRelevant(person, lang);
        const coverageLang = lang === 'cs' ? 'cs' : 'en';

        const link = (url: string, label: string, hint?: string) => `
            <a class="archive-link" href="${url}" target="_blank" rel="noopener noreferrer">
                <span class="archive-link-name">${label}</span>
                ${hint ? `<span class="archive-link-hint">${hint}</span>` : ''}
            </a>`;

        let czechHtml = '';
        if (czech) {
            const suggestedHtml = [...suggested.values()]
                .map(({ portal, place }) => link(portal.url,
                    `⭐ ${portal.name} — ${portal.institution}`,
                    `${strings.archives.suggestedFor} „${place}" · ${portal.coverage[coverageLang]}`))
                .join('');
            const restHtml = ARCHIVE_PORTALS
                .filter(p => !suggested.has(p.id))
                .map(p => link(p.url, `${p.name} — ${p.institution}`, p.coverage[coverageLang]))
                .join('');
            czechHtml = `
                <h3>${strings.archives.czechSection}</h3>
                ${suggestedHtml}
                <details ${suggested.size === 0 ? 'open' : ''}>
                    <summary>${strings.archives.allPortals}</summary>
                    ${restHtml}
                </details>`;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'archives-modal';
        overlay.innerHTML = `
            <div class="modal archives-modal">
                <div class="modal-header">
                    <h2>${strings.archives.title}</h2>
                    <button class="close-btn" id="archives-close-x">&times;</button>
                </div>
                <p class="kinship-from"><strong>${name}</strong>${places.length ? ` · ${places.join(', ')}` : ''}</p>
                <h3>${strings.archives.internationalSection}</h3>
                ${link(familySearchUrl(person), 'FamilySearch', strings.archives.familySearchHint)}
                ${czechHtml}
                <p class="archive-disclaimer">${strings.archives.disclaimer}</p>
                <div class="modal-buttons">
                    <button type="button" class="secondary" id="archives-close">${strings.kinship.close}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => this.closeArchiveSearch();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#archives-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#archives-close-x') as HTMLButtonElement).onclick = close;
        // ESC support via the shared dialog stack (see misc.ts keyboard handler).
        this.clearDialogStack();
        this.pushDialog('archives-modal');
    },

    closeArchiveSearch(): void {
        document.getElementById('archives-modal')?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== 'archives-modal');
    },
});
