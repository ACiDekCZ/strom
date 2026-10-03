/**
 * Cross-tab save announcements. Two tabs of the app share one IndexedDB; each
 * keeps its tree in RAM and saves the whole tree, so the tab that saves last
 * silently wins. Every successful save is announced on a BroadcastChannel;
 * a tab that has the same tree open is told so it can warn its user (and
 * offer a reload). Nothing is merged automatically.
 *
 * Degrades to a no-op where BroadcastChannel is unavailable.
 */

const CHANNEL_NAME = 'strom-tree-saves';

interface SaveMessage {
    type: 'tree-saved';
    treeId: string;
    tabId: string;
}

/** Random per-tab id so a tab ignores its own echoes. */
const TAB_ID = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let channel: BroadcastChannel | null = null;
let listener: ((treeId: string) => void) | null = null;
/** Trees another tab saved since this tab read them: this tab's copy is stale. */
const staleTrees = new Set<string>();

function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    if (typeof BroadcastChannel === 'undefined') return null;
    try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (ev: MessageEvent) => handleMessage(ev.data);
    } catch {
        channel = null;
    }
    return channel;
}

/** Exported for tests: route an incoming message to the listener. */
export function handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Partial<SaveMessage>;
    if (m.type !== 'tree-saved' || typeof m.treeId !== 'string') return;
    if (m.tabId === TAB_ID) return;
    staleTrees.add(m.treeId);
    listener?.(m.treeId);
}

/**
 * Another tab saved `treeId` since this tab read it: what this tab holds is
 * not what is stored. Nothing of it may go to Strom Research (it would take
 * back what the other tab loaded), until the tree is read again.
 */
export function isTreeStale(treeId: string): boolean {
    return staleTrees.has(treeId);
}

/** This tab read the tree again (or reloaded): its copy is current. */
export function clearTreeStale(treeId: string): void {
    staleTrees.delete(treeId);
}

/** Tell other tabs that this tab just persisted `treeId`. */
export function announceTreeSaved(treeId: string): void {
    const ch = getChannel();
    if (!ch) return;
    const msg: SaveMessage = { type: 'tree-saved', treeId, tabId: TAB_ID };
    try { ch.postMessage(msg); } catch { /* best-effort */ }
}

/** Register the handler for saves made by OTHER tabs (one handler per tab). */
export function onTreeSavedElsewhere(handler: (treeId: string) => void): void {
    listener = handler;
    getChannel();
}
