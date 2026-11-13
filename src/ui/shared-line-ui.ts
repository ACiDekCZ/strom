/**
 * The "with …" line of a shared event in a person's life (spec 085 §2a–2d):
 * under the date and place in the person dialog's list of events and in its
 * life timeline. The given names lead to those persons, the rest of the line
 * opens the event's editor from the side of the person whose life it is.
 * The line itself is made by src/shared-with-line.ts from the open tree's
 * index of shared events (never a scan of the persons while drawing).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { LifeEvent, PersonId } from '../types.js';
import { strings } from '../strings.js';
import { sharedWithLine, sharedWithLineHtml } from '../shared-with-line.js';
import { uiModule } from './module.js';

export const sharedLineMethods = uiModule({
    /**
     * "with Terezie, Bohumil, Anežka" under a person's shared event ('' for
     * an event of one person). `open`: the line opens the event's editor
     * (not for a locked person or tree).
     */
    sharedLineHtml(viewerId: PersonId | null, event: LifeEvent, open = true): string {
        if (!viewerId || !event.shareId) return '';
        const line = sharedWithLine(event, viewerId, { data: DataManager.getData(), index: DataManager.getSharedEventIndex() });
        if (!line) return '';
        const esc = (t: string) => this.escapeHtml(t);
        const attrs = open
            ? ` data-shared-viewer="${esc(viewerId)}" data-shared-event="${esc(event.id)}" title="${esc(strings.events.sharedLineOpen)}"`
            : '';
        return sharedWithLineHtml(line, {
            lead: strings.events.sharedLine, more: strings.events.sharedLineMore, esc, attrs, open,
            nameHtml: n => `<button type="button" class="shared-line-name" data-shared-person="${esc(n.personId)}" title="${esc(n.full)}">${esc(n.text)}</button>`,
        });
    },

    /** A name opens that person, the rest of a line its event's editor (sharedLineHtml's lines under `root`). */
    bindSharedLines(root: HTMLElement): void {
        root.querySelectorAll<HTMLElement>('.shared-line').forEach(line => {
            line.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                // A name, or the touch target around it (its item, the comma included).
                const target = e.target as HTMLElement;
                const name = target.closest<HTMLElement>('.shared-line-name')
                    ?? target.closest<HTMLElement>('.shared-line-item')?.querySelector<HTMLElement>('.shared-line-name');
                if (name?.dataset.sharedPerson) {
                    this.openLifelinePerson(name.dataset.sharedPerson as PersonId);
                    return;
                }
                const viewer = line.dataset.sharedViewer as PersonId | undefined;
                if (viewer && line.dataset.sharedEvent) this.openEventEditorFor(viewer, line.dataset.sharedEvent);
            });
        });
    },
});
