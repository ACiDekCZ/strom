/**
 * The main window's wiring of the Research overview in a window of its own
 * (spec 079 §6, K3, 6g): it sends the overview window the research's state
 * after every change of what the overview shows (one post per tick) and at
 * once to a window that said hello; it builds nothing while no overview
 * window is open. It runs the research actions such a window asks for, and
 * tells the UI when the first overview window opens or the last one closes.
 */

import type { WindowEntry, WindowRegistry } from './window-registry.js';
import {
    readOverviewAction, setOverviewChangeListener, setOverviewWindowProbe, type OverviewAction,
} from './overview-window.js';

/** What the wiring needs of the app (the UI in the app, fakes in a test). */
export interface OverviewMainDeps {
    /** The research's state for the overview window now (`research-state`). */
    state(): unknown;
    /** Run a checked research action; its outcome goes back to an action sent with `reqId`. */
    run(action: OverviewAction): unknown;
    /** The first overview window opened, or the last one closed (6g). */
    openChanged(open: boolean): void;
}

type RegistryPart = Pick<WindowRegistry, 'list' | 'onChange' | 'onWindowHello' | 'postResearchState' | 'focusWindow'>;

export interface OverviewMain {
    /** An overview window is open. */
    open(): boolean;
    /** What the overview shows may have changed: the state goes out with the next tick (only to an open window). */
    changed(): void;
    /**
     * A research action from a window: an overview action is checked and
     * run (its outcome returned); anything else (another action, arguments
     * it does not take) is not run (`handled: false`).
     */
    handle(action: string, args: unknown): { handled: boolean; result?: unknown };
    stop(): void;
}

const overviewIds = (list: readonly WindowEntry[]): string[] => list.filter(e => e.kind === 'overview').map(e => e.id);

export function startOverviewMain(registry: RegistryPart, deps: OverviewMainDeps): OverviewMain {
    let wasOpen = false;
    let queued = false;
    const open = () => overviewIds(registry.list()).length > 0;

    const post = () => {
        if (!open()) return;
        let state: unknown;
        try {
            state = deps.state();
        } catch (err) {
            console.error('research state for the overview window failed', err);
            return;
        }
        registry.postResearchState(state);
    };

    const changed = () => {
        if (queued || !open()) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            post();
        });
    };

    const offChange = registry.onChange(() => {
        const now = open();
        if (now === wasOpen) return;
        wasOpen = now;
        try { deps.openChanged(now); } catch (err) { console.error('overview window change failed', err); }
    });
    // A window that said hello (new, or reloaded) has nothing yet: the state goes now.
    const offHello = registry.onWindowHello((_id, kind) => {
        if (kind === 'overview') post();
    });

    setOverviewWindowProbe({
        open,
        focus: () => {
            const id = overviewIds(registry.list())[0];
            if (id) void registry.focusWindow(id);
        },
    });
    setOverviewChangeListener(changed);

    return {
        open,
        changed,
        handle(action, args) {
            const a = readOverviewAction(action, args);
            if (!a) return { handled: false };
            return { handled: true, result: deps.run(a) };
        },
        stop() {
            offChange();
            offHello();
            setOverviewWindowProbe(null);
            setOverviewChangeListener(null);
        },
    };
}
