/**
 * Keyboard access for the click-only controls (review S37): the ⋯ actions
 * menu rows, the tree-switcher items, the app logo, the toolbar focus
 * count and the person context menu. The elements carry tabindex/role in the
 * markup (or where they are rendered); this module adds ONE delegated
 * keydown handler instead of per-element inline code:
 *  - Enter / Space activate the focused control (same as a click);
 *  - Arrow Up / Down move between the items of an open menu (every
 *    role="menuitem" in it, the research menu's block buttons too), and from
 *    the menu's trigger button into it; Home / End go to the first / last;
 *    inside a flyout of the ⋯ menu they stay in the flyout, on its row in
 *    the parent menu;
 *  - Arrow Left / Right switch between the neighbouring toolbar menus
 *    (Research and Actions), never on a flyout row ("For the family ›",
 *    "Tree: {name} ›") or in its flyout;
 *  - after Escape closes a menu, focus goes back to its trigger button.
 */

/** Controls that activate on Enter / Space like a button. */
const ACTIVATABLE = [
    '.tree-switcher-action', '.tree-switcher-item', '.app-logo',
    '#toolbar-focus-count', '#toolbar-focus-name', '.context-menu-item',
].join(', ');

/** Menu containers whose items take Arrow Up / Down. */
const MENU = '.tree-switcher-dropdown.active, .context-menu, .bottom-sheet-person, .bottom-sheet-menu';
const MENU_ITEM = '.tree-switcher-action, .tree-switcher-item, .context-menu-item, .bottom-sheet-person .bottom-sheet-item, '
    + '.tree-switcher-dropdown [role="menuitem"], .bottom-sheet-menu .bottom-sheet-item, .bottom-sheet-menu [role="menuitem"]';

/** Trigger button → the dropdown it opens. */
const TRIGGERS: Array<{ button: string; menu: string }> = [
    { button: '.actions-menu-btn', menu: '#actions-menu-dropdown' },
    { button: '.tree-switcher-btn', menu: '#tree-switcher-dropdown' },
];

let initialized = false;
/** The person card whose menu was opened from the keyboard. */
let menuCard: HTMLElement | null = null;

/**
 * Open a person card's menu from the keyboard: the same click handler as
 * the mouse, then focus on the first menu item so arrows / Enter work.
 */
export function openCardMenuFromKeyboard(card: HTMLElement): void {
    card.click();
    // Floating menu on desktop, bottom sheet in the bottom-navigation regime.
    const first = document.querySelector<HTMLElement>(
        '.context-menu .context-menu-item, .bottom-sheet-person .bottom-sheet-item');
    if (first) {
        menuCard = card;
        first.focus();
    }
}

/**
 * The items arrows walk for `from`: a flyout's own items inside it ("For the
 * family ›", "Tree: {name} ›"), otherwise the menu's items outside every
 * flyout — ↓ on a flyout row goes to the next row, never into the flyout
 * (menu 1020 D3: → opens it and moves focus there).
 */
function visibleItems(menu: Element, from: HTMLElement | null = null): HTMLElement[] {
    const flyout = from?.closest('.actions-submenu') ?? null;
    const scope = flyout && menu.contains(flyout) ? flyout : menu;
    return Array.from(scope.querySelectorAll<HTMLElement>(MENU_ITEM))
        .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
            && !(el as HTMLButtonElement).disabled
            && (scope !== menu || !el.closest('.actions-submenu')));
}

/** A toolbar menu button that is there (the Research button is hidden in a narrow window). */
function shownButton(selector: string): HTMLElement | null {
    const btn = document.querySelector<HTMLElement>(selector);
    return btn && btn.getClientRects().length > 0 ? btn : null;
}

/** ← / →: from one toolbar menu to its neighbour (Research | Actions), focus on its first item. */
function switchToolbarMenu(e: KeyboardEvent, target: HTMLElement): boolean {
    const research = document.getElementById('research-menu');
    const actions = document.getElementById('actions-menu-dropdown');
    if (research?.classList.contains('active') && research.contains(target)) {
        const btn = shownButton('.actions-menu-btn');
        if (!btn) return false;
        e.preventDefault();
        btn.click();
        if (actions?.classList.contains('active')) moveInMenu(actions, null, 1);
        return true;
    }
    // In Actions, ← goes to Research (on its left) — not from a flyout row or its flyout (→ / ← open and close it).
    if (e.key === 'ArrowLeft' && actions?.classList.contains('active') && actions.contains(target) && !target.closest('.actions-submenu-wrap')) {
        const btn = shownButton('#research-menu-btn');
        if (!btn) return false;
        e.preventDefault();
        btn.click();
        const menu = document.getElementById('research-menu');
        if (menu?.classList.contains('active')) {
            const first = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
                .find(el => el.getClientRects().length > 0 && !el.closest('.research-menu-heading'));
            if (first) first.focus();
            else moveInMenu(menu, null, 1);
        }
        return true;
    }
    return false;
}

/** Move focus by `step` among the visible items of `menu` (wrapping; a flyout's within it). */
function moveInMenu(menu: Element, current: HTMLElement | null, step: 1 | -1): void {
    const items = visibleItems(menu, current);
    if (items.length === 0) return;
    const idx = current ? items.indexOf(current) : -1;
    const next = idx === -1
        ? (step === 1 ? items[0] : items[items.length - 1])
        : items[(idx + step + items.length) % items.length];
    if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
    next.focus();
}

function onKeydown(e: KeyboardEvent): void {
    // An element's own handler already took the key (e.g. the "Strom:" row).
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;

    if ((e.key === 'Enter' || e.key === ' ') && target.matches(ACTIVATABLE)) {
        e.preventDefault();
        target.click();
        return;
    }

    if (e.key === 'Home' || e.key === 'End') {
        const menu = target.closest(MENU);
        if (menu && target.matches(MENU_ITEM)) {
            const items = visibleItems(menu, target);
            const to = e.key === 'Home' ? items[0] : items[items.length - 1];
            if (to) {
                e.preventDefault();
                if (!to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
                to.focus();
            }
        }
        return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        switchToolbarMenu(e, target);
        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const menu = target.closest(MENU);
        if (menu && target.matches(MENU_ITEM)) {
            e.preventDefault();
            // Items of an open flyout belong to it; the rest to the top-level list.
            moveInMenu(menu, target, step);
            return;
        }
        for (const t of TRIGGERS) {
            if (!target.matches(t.button)) continue;
            const dropdown = document.querySelector(t.menu);
            if (dropdown?.classList.contains('active')) {
                e.preventDefault();
                moveInMenu(dropdown, null, step);
            }
            return;
        }
        return;
    }

    if (e.key === 'Escape') {
        // Person menu opened from a card: back to the card once it closes.
        if (menuCard && target.closest('.context-menu, .bottom-sheet-person')) {
            const card = menuCard;
            setTimeout(() => {
                if (!document.querySelector('.context-menu, .bottom-sheet-person') && card.isConnected) card.focus();
            }, 0);
            return;
        }
        // The global Escape handler closes the menu; put focus back on the
        // button that opened it (the focused row is about to disappear).
        for (const t of TRIGGERS) {
            const dropdown = document.querySelector(t.menu);
            if (!dropdown?.contains(target)) continue;
            setTimeout(() => {
                if (dropdown.classList.contains('active')) {
                    // Only a submenu ("For the family", "Tree") closed: back to its row.
                    if (target.getClientRects().length === 0 || target.closest('.actions-submenu-wrap:not(.submenu-open) .actions-submenu')) {
                        target.closest('.actions-submenu-wrap')?.querySelector<HTMLElement>('.actions-submenu-row')?.focus();
                    }
                    return;
                }
                document.querySelector<HTMLElement>(t.button)?.focus();
            }, 0);
            return;
        }
    }
}

/** Install the delegated handler. Idempotent; call once at startup. */
export function initKeyboardAccess(): void {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    document.addEventListener('keydown', onKeydown);
    // Tabbing to a person card outside the view must not scroll the tree
    // container: pan/zoom is a transform, and a scroll offset would shift
    // the whole canvas out of step with it.
    const container = document.getElementById('tree-container');
    container?.addEventListener('scroll', () => {
        if (container.scrollLeft !== 0 || container.scrollTop !== 0) {
            container.scrollLeft = 0;
            container.scrollTop = 0;
        }
    });
}
