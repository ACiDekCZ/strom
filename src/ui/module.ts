/**
 * Helper for splitting the UI implementation across module files.
 *
 * Each module exports an object of methods created via `uiModule({...})`. Inside
 * those methods `this` is typed as the full `UIClass`, so cross-module calls
 * (`this.showToast()`, `this.currentId`, …) type-check exactly as they did when
 * everything lived in one class. The facade (`src/ui/index.ts`) merges the
 * method objects onto `UIClass.prototype` and merges their types into the
 * `UIClass` interface, so the runtime object is a single class instance with
 * identical `this` binding — a purely mechanical split, no behavior change.
 *
 * The `UIClass` import is type-only, so this file has no runtime dependency on
 * the facade and no import cycle is created.
 */

import type { UIClass } from './index.js';

export function uiModule<T>(methods: T & ThisType<UIClass>): T {
    return methods;
}
