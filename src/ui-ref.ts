/**
 * Strom - the UI singleton reached through a getter. renderer.ts, export.ts,
 * merge/ui.ts and ui/default-focus.ts call UI through getUI() instead of
 * importing src/ui.ts, so loading them does not pull in the whole UI (the
 * import cycle back into src/ui/index.ts is gone). src/ui/index.ts registers
 * the singleton when it loads.
 */
import type { UIClass } from './ui/index.js';

let uiGetter: (() => UIClass) | null = null;

export function setUIGetter(getter: () => UIClass): void {
    uiGetter = getter;
}

export function getUI(): UIClass {
    if (!uiGetter) throw new Error('UI is not loaded');
    return uiGetter();
}
