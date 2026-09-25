/**
 * Anniversaries UI: a panel of upcoming anniversaries (birthdays, wedding
 * anniversaries, round milestones) reachable from the tree menu, plus a gentle
 * once-a-day "on this day" card shown after the tree loads. Computations are
 * pure (src/anniversaries.ts); this module only renders and wires clicks.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings } from '../strings.js';
import { PersonId, Person, StromData, TreeId } from '../types.js';
import { TreeManager } from '../tree-manager.js';
import { getTreesDataForMatching } from '../cross-tree.js';
import {
    upcomingAnniversaries, onThisDay, Anniversary, OnThisDayEvent,
} from '../anniversaries.js';
import { uiModule } from './module.js';
import { emptyStateHtml } from './empty-state.js';

function personName(p?: Person): string {
    return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

export const anniversariesUiMethods = uiModule({
    /** Open the upcoming-anniversaries panel for the active tree. */
    showAnniversariesDialog(): void {
        this.closeMobileMenu?.();
        document.getElementById('tree-switcher-dropdown')?.classList.remove('active');
        const modal = document.getElementById('anniversaries-modal');
        const list = document.getElementById('anniversaries-list');
        if (!modal || !list) return;

        const data = DataManager.getData();
        const items = upcomingAnniversaries(data, new Date(), 30, SettingsManager.isDeathAnniversariesEnabled());
        const a = strings.anniversaries;

        list.innerHTML = items.length === 0
            ? emptyStateHtml({
                title: strings.emptyStates.anniversariesTitle,
                text: strings.emptyStates.anniversariesText,
                className: 'anniversaries-empty',
            })
            : items.map(item => {
                const names = item.personIds.map(id => personName(data.persons[id as PersonId]));
                const label = this.anniversaryLabel(item, names);
                const when = item.daysUntil === 0 ? a.today
                    : item.daysUntil === 1 ? a.tomorrow : a.inDays(item.daysUntil);
                // TODAY reads as a solid copper chip; other dates stay quiet.
                const chipCls = item.daysUntil === 0 ? 'anniversary-when today' : 'anniversary-when';
                // Person ids come from data files (JSON import): never put them
                // into inline JS — the browser decodes &#39; back to a quote
                // inside an attribute. Data attribute + listener instead.
                return `<div class="anniversary-row" data-person-id="${this.escapeHtml(item.personIds[0])}">
                    <span class="anniversary-text">${this.escapeHtml(label)}</span>
                    <span class="${chipCls}">${this.escapeHtml(when)}</span>
                </div>`;
            }).join('');
        list.querySelectorAll<HTMLElement>('.anniversary-row[data-person-id]').forEach(row => {
            row.addEventListener('click', () => this.focusPersonFromAnniversary(row.dataset.personId as PersonId));
        });

        modal.classList.add('active');
    },

    closeAnniversariesDialog(): void {
        document.getElementById('anniversaries-modal')?.classList.remove('active');
    },

    /** Localized one-line description of an upcoming anniversary. */
    anniversaryLabel(item: Anniversary, names: string[]): string {
        const a = strings.anniversaries;
        switch (item.type) {
            case 'birthday': return a.birthday(names[0], item.years);
            case 'wedding': return a.wedding(names[0], names[1] ?? '', item.years);
            case 'birth-milestone': return a.birthMilestone(names[0], item.years);
            case 'death-milestone': return a.deathMilestone(names[0], item.years);
            case 'death': return a.deathAnniversary(names[0], item.years);
        }
    },

    focusPersonFromAnniversary(personId: string): void {
        this.closeAnniversariesDialog();
        this.dismissOnThisDay();
        TreeRenderer.setFocus(personId as PersonId);
    },

    /**
     * Show the "on this day" card once per tree per calendar day. Called after
     * the first render (idle) so it never delays startup.
     */
    async maybeShowOnThisDay(): Promise<void> {
        if (!SettingsManager.isOnThisDayEnabled()) return;
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;

        const today = new Date();
        const key = `strom-otd-${treeId}-${today.toISOString().slice(0, 10)}`;
        if (localStorage.getItem(key) === '1') return;

        // The open tree first; the other visible trees only when asked for
        // (read from the cross-tree cache: people without their images).
        let found: { ev: OnThisDayEvent; data: StromData; otherTree?: { id: TreeId; name: string } } | null = null;
        const own = onThisDay(DataManager.getData(), today);
        if (own.length > 0) found = { ev: own[0], data: DataManager.getData() };
        else if (SettingsManager.isOnThisDayAllTrees()) {
            const trees = await getTreesDataForMatching(TreeManager).catch(() => null);
            for (const [id, tree] of trees ?? []) {
                if (id === treeId) continue;
                const events = onThisDay(tree.data, today);
                if (events.length > 0 && (!found || events[0].years > found.ev.years)) {
                    found = { ev: events[0], data: tree.data, otherTree: { id, name: tree.name } };
                }
            }
            // The user may have switched trees while the others were read.
            if (DataManager.getCurrentTreeId() !== treeId) return;
        }
        if (!found) return;

        const card = document.getElementById('otd-card');
        const textEl = document.getElementById('otd-text');
        if (!card || !textEl) return;

        const { ev, data, otherTree } = found;
        const persons = ev.personIds.map(id => data.persons[id as PersonId]);
        textEl.textContent = this.onThisDayText(ev, persons)
            + (otherTree ? strings.anniversaries.fromTree(otherTree.name) : '');
        card.dataset.personId = ev.personIds[0];
        if (otherTree) card.dataset.treeId = otherTree.id;
        else delete card.dataset.treeId;
        card.classList.add('active');
        // Mark shown for today regardless of whether the user interacts.
        localStorage.setItem(key, '1');
    },

    /** Localized "on this day" sentence (gender-aware verb in Czech). */
    onThisDayText(ev: OnThisDayEvent, persons: (Person | undefined)[]): string {
        const a = strings.anniversaries;
        const ago = a.yearsAgo(ev.years);
        const female = persons[0]?.gender === 'female';
        const n1 = personName(persons[0]);
        switch (ev.type) {
            case 'birth': return a.otdBirth(n1, ago, female);
            case 'death': return a.otdDeath(n1, ago, female);
            case 'wedding': return a.otdWedding(n1, personName(persons[1]), ago);
        }
    },

    async focusOnThisDay(): Promise<void> {
        const card = document.getElementById('otd-card');
        const personId = card?.dataset.personId;
        const treeId = card?.dataset.treeId;
        this.dismissOnThisDay();
        if (!personId) return;
        // An anniversary from another tree: open that tree first (its own card
        // would only repeat this one, so it counts as shown today).
        if (treeId && treeId !== DataManager.getCurrentTreeId()) {
            try {
                localStorage.setItem(`strom-otd-${treeId}-${new Date().toISOString().slice(0, 10)}`, '1');
            } catch { /* no storage */ }
            await this.switchToTree(treeId);
        }
        if (DataManager.getPerson(personId as PersonId)) TreeRenderer.setFocus(personId as PersonId);
    },

    dismissOnThisDay(): void {
        document.getElementById('otd-card')?.classList.remove('active');
    },

    /** Count of anniversaries within 7 days, for the menu badge (0 = none). */
    anniversaryBadgeCount(): number {
        if (DataManager.isViewMode()) return 0;
        return upcomingAnniversaries(DataManager.getData(), new Date(), 7, SettingsManager.isDeathAnniversariesEnabled()).length;
    },
});
