/**
 * Keyboard access for the click-only controls (review S37): the ⋯ actions
 * menu rows, the tree-switcher items, the app logo, the toolbar focus
 * count and the person context menu. The elements carry tabindex/role in the
 * markup (or where they are rendered); this module adds ONE delegated
 * keydown handler instead of per-element inline code:
 *  - Enter / Space activate the focused control (same as a click);
 *  - Arrow Up / Down move between the items of an open menu, and from the
 *    menu's trigger button into it;
 *  - after Escape closes a menu, focus goes back to its trigger button.
 */

/** Controls that activate on Enter / Space like a button. */
const ACTIVATABLE = [
    '.tree-switcher-action', '.tree-switcher-item', '.app-logo',
    '#toolbar-focus-count', '#toolbar-focus-name', '.context-menu-item',
].join(', ');

/** Menu containers whose items take Arrow Up / Down. */
const MENU = '.tree-switcher-dropdown.active, .context-menu, .bottom-sheet-person';
const MENU_ITEM = '.tree-switcher-action, .tree-switcher-item, .context-menu-item, .bottom-sheet-person .bottom-sheet-item';

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

function visibleItems(menu: Element): HTMLElement[] {
    return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM))
        .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

/** Move focus by `step` among the visible items of `menu` (wrapping). */
function moveInMenu(menu: Element, current: HTMLElement | null, step: 1 | -1): void {
    const items = visibleItems(menu);
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

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const menu = target.closest(MENU);
        if (menu && target.matches(MENU_ITEM)) {
            e.preventDefault();
            // Items of an open "Strom:" submenu belong to it; the rest to the
            // top-level list — both are simply the visible ones.
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
                    // Only the "Strom:" submenu closed: back to its row.
                    if (target.getClientRects().length === 0) {
                        document.getElementById('actions-tree-row')?.focus();
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
