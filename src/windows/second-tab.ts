/**
 * Another tab while the main window is open (spec 079 §5): nothing is loaded
 * or stored here. The tab says so and offers two ways on:
 *
 * - "Switch there": the main window is asked to the front (`focus-req`); no
 *   `focused` within FOCUS_WAIT_MS → the tab says where Strom is and that it
 *   can be closed;
 * - "Open as another window": the tab becomes a satellite of the main
 *   window's tree (its address rewritten, no reload).
 *
 * A link in its address (?person= ?search= ?live= ?send= ?import-url= …) and
 * launches of the installed app go to the main window, each exactly once,
 * as soon as the main window is heard (its status); the address is cleaned.
 */

import { strings } from '../strings.js';
import { WindowBus, FOCUS_WAIT_MS } from './window-bus.js';
import { newWindowId, satelliteUrl, type SatelliteKind, type SatelliteParams } from './window-role.js';
import { addressWithoutLink, linkToForward, type ForwardedLink } from './window-link.js';
import type { TreeId } from '../types.js';

/** How long "Open as another window" waits to hear which tree the main window has open. */
export const MAIN_STATUS_WAIT_MS = 1500;

export interface SecondTabOptions {
    bus?: WindowBus;
    /** `location.search` at start */
    search?: string;
    /** `location.href` now */
    href?: () => string;
    /** history.replaceState */
    replaceUrl?: (url: string) => void;
    /** The tab starts as a satellite with these parameters (the address already says so). */
    becomeSatellite?: (params: SatelliteParams) => void;
}

type Listener = () => void;

export class SecondTab {
    private readonly bus: WindowBus;
    private readonly href: () => string;
    private readonly replaceUrl: (url: string) => void;
    private readonly becomeSatelliteFn: (params: SatelliteParams) => void;
    private readonly unsubscribe: (() => void)[] = [];
    private readonly mainHeard = new Set<Listener>();
    private readonly forwardedListeners = new Set<Listener>();
    private pending: ForwardedLink[] = [];
    private mainId: string | null = null;
    private mainTree: TreeId | null = null;
    private focusWaiter: (() => void) | null = null;
    private stopped = false;
    /** Links passed on to the main window so far. */
    forwarded = 0;

    constructor(opts: SecondTabOptions = {}) {
        this.bus = opts.bus ?? new WindowBus(newWindowId());
        this.href = opts.href ?? (() => window.location.href);
        this.replaceUrl = opts.replaceUrl ?? ((url) => history.replaceState(null, '', url));
        this.becomeSatelliteFn = opts.becomeSatellite ?? (() => {});
        const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
        const link = linkToForward(search);
        if (link) {
            this.pending.push({ search: link });
            // A reload of this tab sends it no second time.
            try { this.replaceUrl(addressWithoutLink(this.href())); } catch { /* the address stays */ }
        }
    }

    /** Listen to the main window; a link waits until it is heard. */
    start(): void {
        const b = this.bus;
        this.unsubscribe.push(
            b.on('status', m => {
                this.mainId = m.from;
                this.mainTree = m.treeId;
                this.flush();
                for (const l of [...this.mainHeard]) l();
            }),
            b.on('main-bye', m => { if (m.from === this.mainId) this.mainId = null; }),
            b.on('focused', m => { if (m.from === this.mainId) this.focusWaiter?.(); }),
        );
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        for (const u of this.unsubscribe.splice(0)) u();
        this.bus.close();
    }

    /** The main window was heard (it gets links and requests). */
    get connected(): boolean {
        return this.mainId !== null;
    }

    /** A link or a launch for the main window: sent once, now or when it is heard. */
    forwardLink(link: ForwardedLink): void {
        if (!link.search && !link.files?.length) return;
        this.pending.push(link);
        this.flush();
    }

    /** Called after each link went to the main window. Returns the unsubscribe. */
    onForwarded(cb: Listener): () => void {
        this.forwardedListeners.add(cb);
        return () => { this.forwardedListeners.delete(cb); };
    }

    /**
     * "Switch there": the main window is asked to the front. Resolves whether
     * it said it has the focus within FOCUS_WAIT_MS (after it was heard).
     */
    async switchThere(): Promise<boolean> {
        if (!(await this.waitForMain())) return false;
        const main = this.mainId;
        if (!main) return false;
        const answered = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => { this.focusWaiter = null; resolve(false); }, FOCUS_WAIT_MS);
            this.focusWaiter = () => { clearTimeout(timer); this.focusWaiter = null; resolve(true); };
        });
        this.bus.post({ type: 'focus-req', to: main });
        return answered;
    }

    /**
     * "Open as another window": this tab becomes a satellite showing `kind` of
     * the main window's tree. Its address says so (a reload keeps it); the
     * satellite's start follows without a reload.
     */
    async openAsWindow(kind: SatelliteKind = 'table'): Promise<SatelliteParams> {
        await this.waitForMain();
        const params: SatelliteParams = { kind, treeId: this.mainTree, windowId: newWindowId(), newId: false };
        try {
            // This page's own address (strom.html or the folder) with the satellite's parameters only.
            const url = new URL(this.href());
            url.search = satelliteUrl(kind, params.treeId, params.windowId).replace(/^\.\/\?/, '?');
            this.replaceUrl(url.toString());
        } catch { /* the address stays */ }
        this.stop();
        this.becomeSatelliteFn(params);
        return params;
    }

    /** Resolves true once the main window is heard (now, or within MAIN_STATUS_WAIT_MS). */
    private waitForMain(): Promise<boolean> {
        if (this.mainId) return Promise.resolve(true);
        return new Promise((resolve) => {
            const done = (ok: boolean) => { clearTimeout(timer); this.mainHeard.delete(heard); resolve(ok); };
            const heard = () => done(true);
            const timer = setTimeout(() => done(false), MAIN_STATUS_WAIT_MS);
            this.mainHeard.add(heard);
        });
    }

    private flush(): void {
        if (!this.mainId || this.stopped) return;
        for (const link of this.pending.splice(0)) {
            this.bus.post({ type: 'link', ...link });
            this.forwarded++;
            for (const l of [...this.forwardedListeners]) l();
        }
    }
}

/** The view the tab opens as a window. The address names none in K1: the Table (K2 adds the views). */
export function secondTabSatelliteKind(): SatelliteKind {
    return 'table';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * The tab's screen (5a–5d): the app's name, why nothing opened here, the two
 * ways on; the green line once a link went to the main window; the sentence
 * when the main window did not come to the front. Returns its root.
 */
export function renderSecondTab(tab: SecondTab): HTMLElement {
    const html = document.documentElement;
    html.classList.add('window-second-tab');
    html.classList.remove('app-booting', 'app-loading', 'external-opening');
    const w = strings.win;
    const main = el('main', 'second-tab');
    const card = el('div', 'second-tab-card');
    const brand = el('div', 'second-tab-brand', 'Strom');
    const forwarded = el('div', 'second-tab-forwarded');
    forwarded.setAttribute('role', 'status');
    forwarded.hidden = true;
    forwarded.append(el('span', 'second-tab-dot'), el('span', 'second-tab-forwarded-text', w.linkForwarded));
    const title = el('h1', 'second-tab-title', w.alreadyOpen);
    const note = el('p', 'second-tab-note', w.alreadyOpenNote);
    const actions = el('div', 'second-tab-actions');
    const switchBtn = el('button', 'second-tab-btn second-tab-btn--primary', w.switchThere);
    switchBtn.type = 'button';
    switchBtn.id = 'second-tab-switch';
    const openBtn = el('button', 'second-tab-btn', w.openAsWindow);
    openBtn.type = 'button';
    openBtn.id = 'second-tab-open';
    actions.append(switchBtn, openBtn);
    const failed = el('p', 'second-tab-failed', `${w.switchFailed} ${w.tabCanClose}`);
    failed.setAttribute('role', 'status');
    failed.hidden = true;
    card.append(brand, forwarded, title, note, actions, failed);
    main.append(card);
    document.body.append(main);

    const showForwarded = () => { forwarded.hidden = false; };
    if (tab.forwarded > 0) showForwarded();
    tab.onForwarded(showForwarded);

    switchBtn.addEventListener('click', () => {
        failed.hidden = true;
        switchBtn.disabled = true;
        void tab.switchThere().then((ok) => {
            switchBtn.disabled = false;
            failed.hidden = ok;
        });
    });
    openBtn.addEventListener('click', () => {
        switchBtn.disabled = true;
        openBtn.disabled = true;
        void tab.openAsWindow(secondTabSatelliteKind());
    });
    return main;
}

/** The screen goes before the tab starts as a satellite (the app's views measure the page). */
export function removeSecondTabScreen(): void {
    document.querySelector('main.second-tab')?.remove();
    const html = document.documentElement;
    html.classList.remove('window-second-tab');
    // As at the start of any window: nothing is edited or welcomed before the tree is in.
    html.classList.add('app-booting', 'app-loading');
    setTimeout(() => html.classList.remove('app-booting'), 10000);
}
