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
import { PersonId, Person } from '../types.js';
import {
    upcomingAnniversaries, onThisDay, Anniversary, OnThisDayEvent,
} from '../anniversaries.js';
import { uiModule } from './module.js';

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
            ? `<div class="anniversaries-empty">${a.empty}</div>`
            : items.map(item => {
                const names = item.personIds.map(id => personName(data.persons[id as PersonId]));
                const label = this.anniversaryLabel(item, names);
                const when = item.daysUntil === 0 ? a.today
                    : item.daysUntil === 1 ? a.tomorrow : a.inDays(item.daysUntil);
                // TODAY reads as a solid copper chip; other dates stay quiet.
                const chipCls = item.daysUntil === 0 ? 'anniversary-when today' : 'anniversary-when';
                // Person ids come from data files (JSON import) — escape them too.
                const onclick = `window.Strom.UI.focusPersonFromAnniversary('${this.escapeHtml(item.personIds[0])}')`;
                return `<div class="anniversary-row" onclick="${onclick}">
                    <span class="anniversary-text">${this.escapeHtml(label)}</span>
                    <span class="${chipCls}">${this.escapeHtml(when)}</span>
                </div>`;
            }).join('');

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
    maybeShowOnThisDay(): void {
        if (!SettingsManager.isOnThisDayEnabled()) return;
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;

        const today = new Date();
        const key = `strom-otd-${treeId}-${today.toISOString().slice(0, 10)}`;
        if (localStorage.getItem(key) === '1') return;

        const events = onThisDay(DataManager.getData(), today);
        if (events.length === 0) return;

        const card = document.getElementById('otd-card');
        const textEl = document.getElementById('otd-text');
        if (!card || !textEl) return;

        const ev = events[0];
        const data = DataManager.getData();
        const persons = ev.personIds.map(id => data.persons[id as PersonId]);
        textEl.textContent = this.onThisDayText(ev, persons);
        card.dataset.personId = ev.personIds[0];
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

    focusOnThisDay(): void {
        const card = document.getElementById('otd-card');
        const personId = card?.dataset.personId;
        this.dismissOnThisDay();
        if (personId) TreeRenderer.setFocus(personId as PersonId);
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
