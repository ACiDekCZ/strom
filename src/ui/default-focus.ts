/**
 * "Focus default person" (spec 111): the ⌂ buttons beside "Focused on" (the
 * desktop pill, the tablet and sideways-phone toolbar, the phone's person
 * panel) and the shortcut call only this module. It holds the target (the
 * tree's default person, src/default-person.ts), its state (the default
 * person in focus already: ⌂ filled and muted, a click does nothing) and the
 * action (a focus with a step of the history and "Focused on {name} · ↩ Back").
 *
 * Every `.focus-home` button names the view it belongs to in
 * `data-home-view` (family when it has none): the buttons of the focus pill
 * and the toolbar stand in the family view, the descendants badge's and the
 * fan's in theirs. A button outside its view, in another window (spec
 * 079/110) or without a target is `hidden`.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { getUI } from '../ui-ref.js';
import { strings } from '../strings.js';
import { iconSvg } from '../icons.js';
import { shownName } from '../person-name.js';
import { defaultTarget, type DefaultTarget } from '../default-person.js';
import type { PersonId, ViewMode } from '../types.js';

export type { DefaultReason, DefaultTarget } from '../default-person.js';

/** Spec 111 K1.5: true = variant A (a default person gone → the first person, as opening does), false = B (no target). */
export const FALLBACK_TO_FIRST = true;

/** The views where ⌂ and the shortcut work (§7); the map, the timeline and the table have none. */
const HOME_VIEWS: readonly ViewMode[] = ['family', 'descendants', 'fan'];

/** The person the tree was focused on when it opened or was switched to (the target of "Last focused"). */
let openedFocusId: PersonId | null = null;

/** Note the person the tree is focused on right after it opened (TreeRenderer.restoreFromSession). */
export function rememberOpenedFocus(id: PersonId | null): void {
    openedFocusId = id;
}

/** This window is the main one (other windows have no ⌂ and no shortcut, spec 079/110). */
function isMainWindow(): boolean {
    if (DataManager.isWindowCopy()) return false;
    return typeof document === 'undefined' || !document.documentElement.classList.contains('window-satellite');
}

/** The target of "Focus default person" now (null: none, ⌂ hidden). */
export function resolveDefaultTarget(): DefaultTarget | null {
    return defaultTarget(DataManager.getData(), openedFocusId, FALLBACK_TO_FIRST);
}

/** The person in the middle of the view: the fan's pinned centre while one is pinned, else the focus. */
function shownCentre(): PersonId | null {
    const focus = TreeRenderer.getFocusPersonId();
    if (TreeRenderer.getViewMode() === 'fan') return getUI().liveFollowPinned?.() ?? focus;
    return focus;
}

/** The default person is in the middle of the view already (§4): ⌂ does nothing. */
export function isAtDefault(t: DefaultTarget): boolean {
    return shownCentre() === t.id;
}

/** ⌂ and the shortcut work here: the main window in the family, descendants or fan view. */
export function isDefaultFocusContext(): boolean {
    return isMainWindow() && HOME_VIEWS.includes(TreeRenderer.getViewMode());
}

/**
 * Focus the tree's default person, as a focus from a card's tab does: a step
 * of the history, "Focused on {name} · ↩ Back", the depths of a new focus.
 * The fan's pinned centre is released first; when the default person is the
 * focus already, the release alone is the step (as "Release" is). Returns
 * false when nothing happens (another window or view, no target, the default
 * person in the middle already).
 */
export function focusDefaultPerson(source: 'button' | 'shortcut'): boolean {
    void source;
    if (!isDefaultFocusContext()) return false;
    const t = resolveDefaultTarget();
    if (!t || isAtDefault(t)) return false;
    if (TreeRenderer.getViewMode() === 'fan' && getUI().liveFollowPinned?.()) {
        // Released without the rule's own re-centring: the fan goes straight to the default person.
        getUI().unpinFanCenter?.(false);
        if (TreeRenderer.getFocusPersonId() === t.id) {
            TreeRenderer.getFanView()?.recenterAsOrigin(t.id);
            updateDefaultFocusButtons();
            return true;
        }
    }
    void TreeRenderer.focusFromTab(t.id).then(() => updateDefaultFocusButtons());
    return true;
}

/** What the shortcut reads of a key press (a KeyboardEvent fits). */
export interface DefaultFocusKeyEvent {
    key: string; code: string;
    ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
    isComposing?: boolean;
}

/**
 * The press is the shortcut of "Focus default person" (§6): 'h' = H or h
 * (Shift and Caps Lock too) without Ctrl, ⌘ or Alt, not while composing;
 * 'mod1' = ⌘1 on a Mac, Ctrl+1 elsewhere, read by the key's place (Digit1):
 * a Czech keyboard types "+" there. The number pad's 1 is not it.
 * `typing`: the keyboard is in a text field (H is a letter there; ⌘1 / Ctrl+1 still counts).
 */
export function defaultFocusKey(e: DefaultFocusKeyEvent, mac: boolean, typing: boolean): 'h' | 'mod1' | null {
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.code === 'Digit1') return 'mod1';
    if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
    return e.key === 'h' || e.key === 'H' ? 'h' : null;
}

/** The view a ⌂ button belongs to (its `data-home-view`, family when none). */
function buttonView(btn: HTMLElement): ViewMode {
    return (btn.dataset.homeView as ViewMode | undefined) ?? 'family';
}

/** The keys of the action for `aria-keyshortcuts` (§6). */
function keyShortcuts(): string {
    return getUI().isMacPlatform() ? 'H Meta+1' : 'H Control+1';
}

/**
 * Bring every ⌂ button of the window to the target and the state now:
 * hidden, data-state (active / home), the icon, the tooltip and the
 * accessible name. Cheap (attributes only); called after every focus and
 * render, a change of the default person, a language switch.
 */
export function updateDefaultFocusButtons(): void {
    if (typeof document === 'undefined') return;
    const buttons = document.querySelectorAll<HTMLButtonElement>('.focus-home');
    if (buttons.length === 0) return;
    const main = isMainWindow();
    const t = main ? resolveDefaultTarget() : null;
    const view = TreeRenderer.getViewMode();
    const person = t ? DataManager.getPerson(t.id) : null;
    const name = person ? shownName(person) : '';
    const home = !!t && isAtDefault(t);
    const reasonNote = !t ? '' : t.reason === 'opened' ? strings.focus.focusHomeOpened
        : t.reason === 'first' || t.reason === 'fallbackFirst' ? strings.focus.focusHomeFirst : '';
    const label = home ? strings.focus.focusHomeAt(name) : `${strings.focus.focusHome(name)}${reasonNote}`;
    const tip = home ? label : `${label} (H)`;
    const state = home ? 'home' : 'active';
    const shortcuts = keyShortcuts();
    buttons.forEach(btn => {
        const hide = !t || buttonView(btn) !== view;
        if (btn.hidden !== hide) btn.hidden = hide;
        if (hide) return;
        if (btn.dataset.state !== state || !btn.firstElementChild) {
            btn.dataset.state = state;
            btn.innerHTML = iconSvg(home ? 'home-filled' : 'home', { size: 16, className: 'focus-home-icon' });
        }
        if (btn.title !== tip) btn.title = tip;
        if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-disabled', home ? 'true' : 'false');
        if (btn.getAttribute('aria-keyshortcuts') !== shortcuts) btn.setAttribute('aria-keyshortcuts', shortcuts);
    });
}

/**
 * Wire the ⌂ buttons present now (index.html): a click focuses the default
 * person and goes no further (the pill and the toolbar have handlers of
 * their own). A button added later calls `bindDefaultFocusButton` itself.
 */
export function initDefaultFocusButtons(): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll<HTMLButtonElement>('.focus-home').forEach(bindDefaultFocusButton);
    // A switch of the view shows the buttons of the new view (the map, the timeline and the table have none).
    if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => updateDefaultFocusButtons())
            .observe(document.body, { attributes: true, attributeFilter: ['data-view-mode'] });
    }
    updateDefaultFocusButtons();
}

/** Wire one ⌂ button (once). */
export function bindDefaultFocusButton(btn: HTMLButtonElement): void {
    if (btn.dataset.homeBound) return;
    btn.dataset.homeBound = '1';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.getAttribute('aria-disabled') === 'true') return;
        focusDefaultPerson('button');
    });
}
