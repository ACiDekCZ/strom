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
    anniversaryDotLit, anniversaryListFingerprint, localDayKey, AnniversariesSeen,
} from '../anniversaries.js';
import { uiModule } from './module.js';
import { emptyStateHtml } from './empty-state.js';
import { shownNameOrEmpty } from '../person-name.js';
import { measureClearance } from '../toast-slot.js';

/** Days ahead the menu count (and the ⋯ dot) covers (T33: said in its label). */
export const ANNIVERSARY_SOON_DAYS = 7;
/** Days ahead the anniversaries panel lists. */
export const ANNIVERSARY_LIST_DAYS = 30;

/** Where the device keeps what the anniversaries list held when last opened, per tree (T51). */
function seenKey(treeId: string): string {
    return `strom-ann-seen-${treeId}`;
}

function readSeen(treeId: string | null): AnniversariesSeen | null {
    if (!treeId) return null;
    try {
        const raw = localStorage.getItem(seenKey(treeId));
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<AnniversariesSeen>;
        return typeof v.day === 'string' && typeof v.list === 'string' ? { day: v.day, list: v.list } : null;
    } catch { return null; }
}

function soonAnniversaries(today: Date): Anniversary[] {
    return upcomingAnniversaries(DataManager.getData(), today, ANNIVERSARY_SOON_DAYS, SettingsManager.isDeathAnniversariesEnabled());
}

function personName(p?: Person): string {
    return p ? shownNameOrEmpty(p) : '';
}

/**
 * The notes that share the card's place at the bottom centre (T54 G11): a
 * message, the undo pill, the focus confirmation, the family and tour offers.
 */
const NOTES_AT_CARD = 'body > .toast.show:not(.toast-held), body > .undo-toast.show, .focus-toast-box.show, '
    + '.family-offer.show .family-offer-pill, .tour-offer.show';
/** Room between the card and the note under it, as between the undo pill and the family offer. */
const CARD_NOTE_GAP = 8;

/** Top edge of a note where it rests (its fixed box's own bottom, not mid-slide in its animation). */
function restingTop(el: HTMLElement): number {
    let box: HTMLElement | null = el;
    while (box && getComputedStyle(box).position !== 'fixed') box = box.parentElement;
    if (!box) return el.getBoundingClientRect().top;
    const bottom = parseFloat(getComputedStyle(box).bottom);
    return Number.isFinite(bottom) ? window.innerHeight - bottom - box.offsetHeight : box.getBoundingClientRect().top;
}

/**
 * The card stands above each note shown at its place and comes back down
 * once the note goes: one inline bottom over its own rule's (T54 G11).
 */
function liftOnThisDay(card: HTMLElement): void {
    card.style.removeProperty('bottom');
    if (!card.classList.contains('active')) return;
    const own = card.getBoundingClientRect();
    let bottom = parseFloat(getComputedStyle(card).bottom) || 0;
    const notes = [...document.querySelectorAll<HTMLElement>(NOTES_AT_CARD)]
        .map(el => ({ el, r: el.getBoundingClientRect(), top: restingTop(el) }))
        .filter(n => n.r.width > 0 && n.r.right > own.left && n.r.left < own.right && getComputedStyle(n.el).visibility !== 'hidden')
        .sort((a, b) => b.top - a.top);
    for (const n of notes) {
        const noteBottom = n.top + n.r.height;
        const cardTop = window.innerHeight - bottom - own.height;
        if (noteBottom > cardTop && n.top < window.innerHeight - bottom) bottom = window.innerHeight - n.top + CARD_NOTE_GAP;
    }
    if (bottom !== (parseFloat(getComputedStyle(card).bottom) || 0)) card.style.bottom = `${bottom}px`;
}

/** While the card shows: a note coming, going or resized moves it (watched only then). */
let otdWatch: { observer: MutationObserver; onResize: () => void } | null = null;

function watchOnThisDay(card: HTMLElement): void {
    unwatchOnThisDay();
    let frame = 0;
    const relayout = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; liftOnThisDay(card); });
    };
    const observer = new MutationObserver(relayout);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', relayout);
    otdWatch = { observer, onResize: relayout };
    liftOnThisDay(card);
}

function unwatchOnThisDay(): void {
    if (!otdWatch) return;
    otdWatch.observer.disconnect();
    window.removeEventListener('resize', otdWatch.onResize);
    otdWatch = null;
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
        const items = upcomingAnniversaries(data, new Date(), ANNIVERSARY_LIST_DAYS, SettingsManager.isDeathAnniversariesEnabled());
        const a = strings.anniversaries;

        // The menu counts the next ANNIVERSARY_SOON_DAYS only, the list reaches
        // further: both said up front, so "3" on the menu matches what is read here.
        const summary = document.getElementById('anniversaries-summary');
        if (summary) {
            const soon = items.filter(i => i.daysUntil <= ANNIVERSARY_SOON_DAYS).length;
            summary.textContent = items.length === 0 ? ''
                : `${a.soonCount(soon, ANNIVERSARY_SOON_DAYS)} · ${a.listScope(ANNIVERSARY_LIST_DAYS)}`;
        }

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
        // Opened: the menu's dot goes out until the list changes or another day comes (T51).
        this.markAnniversariesSeen();
        this.refreshActionMenuBadges();
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
        // At the undo pill's place (T54 G11): clear of ↩ ↪ and the zoom stack as they stand now.
        measureClearance();
        card.classList.add('active');
        watchOnThisDay(card);
        // Mark shown for today regardless of whether the user interacts.
        localStorage.setItem(key, '1');
    },

    /** Localized "on this day" sentence (gender-aware verb in Czech). */
    onThisDayText(ev: OnThisDayEvent, persons: (Person | undefined)[]): string {
        const a = strings.anniversaries;
        const ago = a.yearsAgo(ev.years);
        const sex = persons[0]?.gender;
        const n1 = personName(persons[0]);
        switch (ev.type) {
            case 'birth': return a.otdBirth(n1, ago, sex);
            case 'death': return a.otdDeath(n1, ago, sex);
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
        unwatchOnThisDay();
        const card = document.getElementById('otd-card');
        card?.classList.remove('active');
        card?.style.removeProperty('bottom');
    },

    /** Count of anniversaries within ANNIVERSARY_SOON_DAYS, for the menu badge (0 = none). */
    anniversaryBadgeCount(): number {
        if (DataManager.isViewMode()) return 0;
        return soonAnniversaries(new Date()).length;
    },

    /**
     * Whether the menu's anniversaries dot is lit (T51): anniversaries in the
     * next days that have not been looked at today in the same shape. The
     * count on the Anniversaries row does not depend on it.
     */
    anniversaryDotLit(): boolean {
        if (DataManager.isViewMode()) return false;
        const today = new Date();
        return anniversaryDotLit(soonAnniversaries(today), today, readSeen(DataManager.getCurrentTreeId()));
    },

    /** Remember on this device what the list held when opened today (T51). */
    markAnniversariesSeen(): void {
        const treeId = DataManager.getCurrentTreeId();
        if (DataManager.isViewMode() || !treeId) return;
        const today = new Date();
        const seen: AnniversariesSeen = { day: localDayKey(today), list: anniversaryListFingerprint(soonAnniversaries(today)) };
        try {
            localStorage.setItem(seenKey(treeId), JSON.stringify(seen));
        } catch { /* no storage: the dot stays as before */ }
    },

    /** What the menu badge's number means ("3 anniversaries in the next 7 days"): its tooltip and spoken name. */
    anniversaryBadgeHint(count: number): string {
        return strings.anniversaries.soonCount(count, ANNIVERSARY_SOON_DAYS);
    },
});
