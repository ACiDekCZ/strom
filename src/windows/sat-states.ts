/**
 * The satellite window's states (spec 079 §3, mockups 3a–3g): one strip under
 * the header while there is content, one state in place of the content when
 * the window has nothing to show, a toast for a one-off event. The window is
 * never greyed out as a whole.
 *
 * 1 loading     — until the tree comes: the view's skeleton, "Loading the
 *                 tree…" only after 300 ms, the header's controls muted;
 * 2 read-only   — the main window follows a live research: the window's own
 *                 following of the agent (spec 097 §1–§3, §6; the table of
 *                 strip states in ZADANI_DEV): attached, without jumps in
 *                 this view, the agent idle, paused, detached, the bridge
 *                 lost; each with its icon, words and buttons, and "Go to
 *                 the main window" last;
 * 3 main closed — `main-bye` or no status for 3 s (the client decides): an
 *                 amber strip "as of {time}", Make this the main window, Open
 *                 Strom (takes precedence over 2);
 * 4 conflict    — an edit was not applied: a toast (6 s), the data is fresh;
 * 5a switched   — another tree in the main window: the view stays, a toast
 *                 "{a} → {b}" (4 s);
 * 5b gone       — the tree was deleted: a state with Close window;
 * 6 locked      — the tree is locked in the main window: a state with Go to
 *                 the main window; after the unlock the tree comes (state 1).
 */

import { strings } from '../strings.js';
import type { AgentFollow } from './agent-follow-state.js';

/** How long the loading state waits before it says so (a small tree does not flash). */
export const LOADING_LABEL_DELAY_MS = 300;
export const CONFLICT_TOAST_MS = 6000;
export const SWITCHED_TOAST_MS = 4000;

/**
 * The strip under the header (spec 097: the higher one wins). While the main
 * window follows a live research, one of `lost` … `attached` stands;
 * `takeover` / `takeoverFailed` belong to taking over after the main window
 * closed (§7).
 */
export type SatStrip = 'takeover' | 'takeoverFailed' | 'closed' | 'lost' | 'paused' | 'detached' | 'idle' | 'attachedNoJump' | 'attached' | null;
export type SatEmpty = 'gone' | 'locked' | null;

export interface SatScreenInput {
    connection: 'connecting' | 'connected' | 'main-closed';
    hasTree: boolean;
    gone: boolean;
    live: boolean;
    locked: boolean;
    /** The tree was locked since the copy came: it shows again when the main window sends it anew (the copy is dropped meanwhile). */
    awaitingTree: boolean;
    /** The window's own following of the agent (null or missing: attached). */
    agent?: AgentFollow | null;
    /** The agent works on nobody of this tree now. */
    agentIdle?: boolean;
    /** The view shown has no jumps (the descendants, the timeline). */
    noJumpView?: boolean;
    /** The main window's bridge does not answer (it is tried again). */
    bridgeLost?: boolean;
    /** Taking over after the main window closed (§7): under way here, or impossible. */
    takeover?: 'running' | 'failed' | null;
}

/** The strip while the main window follows a live research (states 4–9). */
function liveStrip(s: SatScreenInput): SatStrip {
    if (s.bridgeLost) return 'lost';
    if (s.agent === 'paused') return 'paused';
    if (s.agent === 'detached') return 'detached';
    if (s.agentIdle) return 'idle';
    return s.noJumpView ? 'attachedNoJump' : 'attached';
}

export interface SatScreen {
    strip: SatStrip;
    empty: SatEmpty;
    /** The view's skeleton in place of the content. */
    loading: boolean;
    /** The header's controls muted (nothing to act on). */
    muted: boolean;
}

/** What the window shows for its state (§3; 3 before 2, a state in place of the content before the skeleton). */
export function satelliteScreen(s: SatScreenInput): SatScreen {
    const closed = s.connection === 'main-closed';
    let empty: SatEmpty = null;
    if (s.gone) empty = 'gone';
    else if (s.locked && (!closed || !s.hasTree)) empty = 'locked';
    const loading = !empty && (!s.hasTree || s.awaitingTree);
    let strip: SatStrip = null;
    if (s.takeover === 'running') strip = 'takeover';
    else if (s.takeover === 'failed') strip = 'takeoverFailed';
    else if (closed) strip = 'closed';
    else if (s.live && !empty && !loading) strip = liveStrip(s);
    return { strip, empty, loading, muted: loading || empty !== null };
}

/** What the states need from the satellite client (SatelliteClient fits). */
export interface SatStatesClient {
    readonly connection: SatScreenInput['connection'];
    readonly hasTree: boolean;
    readonly treeGone: boolean;
    readonly lastHeardAt: number;
    readonly status: { live: boolean; locked: boolean } | null;
    on(event: 'connection' | 'status' | 'data' | 'tree-gone', cb: () => void): () => void;
    on(event: 'tree', cb: (e: { name: string; switchedFrom: { name: string } | null; afterConflict: boolean }) => void): () => void;
    on(event: 'conflict', cb: () => void): () => void;
}

/** The window's following of the agent as the strip reads it (spec 097). */
export interface SatAgentView {
    follow: AgentFollow | null;
    idle: boolean;
    noJump: boolean;
    lost: boolean;
    takeover: 'running' | 'failed' | null;
}

export interface SatStatesOptions {
    /** "Go to the main window" (states 2 and 6). */
    goToMain: () => void;
    /** The window's following of the agent now (none: the strip of spec 079 alone). */
    agent?: () => SatAgentView;
    /** "Detach this window" (spec 097 §2). */
    detach?: () => void;
    /** "Follow the agent" (§2). */
    attach?: () => void;
    /** "Back to the agent" (§3). */
    back?: () => void;
    /** "Open Strom" (state 3): a new main window. */
    openStrom: () => void;
    /** "Make this the main window" (state 3). */
    makeMain: () => void;
    /** "Close window" (state 5b). */
    closeWindow: () => void;
    toast: (message: string, ms: number) => void;
    /** The time the copy was current, as the strip of state 3 says it. */
    formatTime: (ts: number) => string;
    /** The content (the view's container): inert while a state or the skeleton stands in its place. */
    content?: () => HTMLElement | null;
}

/** The strip's icons (16 × 16, the colour from the strip's class; spec 097 §1). */
const SVG = (inner: string, attrs = ''): string =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"${attrs}>${inner}</svg>`;
const ICONS = {
    follow: SVG('<circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle>'),
    pause: SVG('<circle cx="12" cy="12" r="8.5"></circle><path d="M10 8.5v7M14 8.5v7" stroke-linecap="round"></path>'),
    off: SVG('<circle cx="12" cy="12" r="8.5"></circle>', ' stroke-dasharray="3 3"'),
    warn: SVG('<path d="M12 3.5 21 19.5H3z" stroke-linejoin="round"></path><path d="M12 10v4.5M12 17.2v.1"></path>', ' stroke-linecap="round"'),
    spin: SVG('<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"></path>', ' stroke-linecap="round"'),
} as const;

const STRIP_ICON: Record<Exclude<SatStrip, null>, keyof typeof ICONS> = {
    takeover: 'spin', takeoverFailed: 'warn', closed: 'warn', lost: 'warn',
    paused: 'pause', detached: 'off', idle: 'follow', attachedNoJump: 'follow', attached: 'follow',
};

/** The amber strips (the main window closed, the bridge lost, no taking over). */
const AMBER: readonly SatStrip[] = ['closed', 'lost', 'takeoverFailed'];

/** Widths of the skeleton's rows (% of the area), as in 3a. */
const SKELETON_ROWS = [92, 74, 86, 64, 90, 58, 80, 70, 88, 62, 84, 72];

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(doc: Document, className: string, text: string, run: () => void): HTMLButtonElement {
    const b = el(doc, 'button', className, text);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
}

/**
 * Put the states under the header. They follow the client's events; `refresh`
 * writes their texts again (another language), `update` looks at the window's
 * following of the agent again (its words change only with the state).
 * `screen` is the state shown now.
 */
export function mountSatStates(doc: Document, client: SatStatesClient, opts: SatStatesOptions): { refresh: () => void; update: () => void; screen: () => SatScreen } {
    const html = doc.documentElement;
    let awaitingTree = false;
    let wasLocked = false;
    let shown: SatScreen = { strip: null, empty: null, loading: false, muted: false };
    /** The strip as written: its state and, while lost, the window's own button (detach or follow). */
    let stripKey = '';
    let stripText = '';

    // The strip (3b, 3c; spec 097 §1): its words change only with its state (role=status says each change once).
    const strip = el(doc, 'div', 'sat-strip');
    strip.setAttribute('role', 'status');
    strip.hidden = true;
    const icon = el(doc, 'span', 'sat-strip-icon');
    icon.setAttribute('aria-hidden', 'true');
    const text = el(doc, 'span', 'sat-strip-text');
    const actions = el(doc, 'div', 'sat-strip-actions');
    strip.append(icon, text, actions);

    // In place of the content (3f, 3g).
    const empty = el(doc, 'div', 'sat-empty');
    empty.hidden = true;
    const emptyBox = el(doc, 'div', 'sat-empty-box');
    const emptyTitle = el(doc, 'h1', 'sat-empty-title');
    const emptyNote = el(doc, 'p', 'sat-empty-note');
    const emptyBtn = el(doc, 'button', 'sat-empty-btn');
    emptyBtn.type = 'button';
    emptyBox.append(emptyTitle, emptyNote, emptyBtn);
    empty.append(emptyBox);
    emptyBtn.addEventListener('click', () => {
        if (shown.empty === 'gone') opts.closeWindow();
        else opts.goToMain();
    });

    // The skeleton (3a).
    const skeleton = el(doc, 'div', 'sat-skeleton');
    skeleton.setAttribute('aria-busy', 'true');
    skeleton.hidden = true;
    for (const w of SKELETON_ROWS) {
        const bar = el(doc, 'div', 'sat-skeleton-row');
        bar.style.width = `${w}%`;
        skeleton.append(bar);
    }
    const loadingLabel = el(doc, 'div', 'sat-loading-label');
    loadingLabel.setAttribute('role', 'status');
    skeleton.append(loadingLabel);
    let labelTimer: ReturnType<typeof setTimeout> | null = null;

    doc.body.append(strip, skeleton, empty);

    // The content and the states below the strip: its height as the page's offset.
    const syncOffset = (): void => {
        const h = strip.hidden ? 0 : Math.ceil(strip.getBoundingClientRect().height);
        html.style.setProperty('--sat-strip-h', `${h}px`);
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncOffset).observe(strip);

    const writeStrip = (kind: SatStrip, agent: SatAgentView | null): void => {
        const w = strings.win;
        // A press on the strip's button keeps the focus in the strip: on the button standing in its place now.
        const pressed = [...actions.children].indexOf(doc.activeElement as Element);
        actions.replaceChildren();
        strip.className = 'sat-strip';
        if (kind) strip.classList.add(`sat-strip--${kind}`);
        strip.classList.toggle('sat-strip--amber', AMBER.includes(kind));
        icon.innerHTML = kind ? ICONS[STRIP_ICON[kind]] : '';
        const goToMain = (): HTMLButtonElement => button(doc, 'sat-strip-btn sat-strip-btn--link sat-strip-main', w.goToMain, () => opts.goToMain());
        const detach = (): HTMLButtonElement => button(doc, 'sat-strip-btn sat-strip-detach', w.detach, () => opts.detach?.());
        const attach = (): HTMLButtonElement => button(doc, 'sat-strip-btn sat-strip-attach', w.attach, () => opts.attach?.());
        const closedButtons = (): HTMLButtonElement[] => [
            button(doc, 'sat-strip-btn sat-strip-make-main', w.makeMain, () => opts.makeMain()),
            button(doc, 'sat-strip-btn sat-strip-btn--primary sat-strip-open', w.openStrom, () => opts.openStrom()),
        ];
        switch (kind) {
            case 'takeover':
                stripText = w.takingOver;
                break;
            case 'takeoverFailed':
                stripText = w.takeoverFailed;
                actions.append(...closedButtons());
                break;
            case 'closed':
                stripText = w.mainClosed(opts.formatTime(client.lastHeardAt));
                actions.append(...closedButtons());
                break;
            case 'lost':
                stripText = w.bridgeLost;
                actions.append(agent?.follow === 'detached' ? attach() : detach(), goToMain());
                break;
            case 'paused':
                stripText = w.agentPaused;
                actions.append(button(doc, 'sat-strip-btn sat-strip-btn--primary sat-strip-back', strings.live.followBack, () => opts.back?.()), detach(), goToMain());
                break;
            case 'detached':
                stripText = w.agentDetached;
                actions.append(attach(), goToMain());
                break;
            case 'idle':
                stripText = w.agentIdle;
                actions.append(detach(), goToMain());
                break;
            case 'attachedNoJump':
                stripText = w.agentAttachedNoJump;
                actions.append(detach(), goToMain());
                break;
            case 'attached':
                stripText = w.agentAttached;
                actions.append(detach(), goToMain());
                break;
            default:
                stripText = '';
        }
        text.textContent = stripText;
        if (pressed >= 0 && actions.children.length > 0) (actions.children[Math.min(pressed, actions.children.length - 1)] as HTMLElement).focus();
    };

    const writeEmpty = (kind: SatEmpty): void => {
        const w = strings.win;
        emptyBox.classList.toggle('sat-empty--locked', kind === 'locked');
        if (kind === 'gone') {
            emptyTitle.textContent = w.treeGone;
            emptyNote.textContent = w.treeGoneNote;
            emptyBtn.textContent = w.closeWindow;
            emptyBtn.className = 'sat-empty-btn sat-empty-btn--primary';
        } else if (kind === 'locked') {
            emptyTitle.textContent = w.treeLocked;
            emptyNote.textContent = w.treeLockedNote;
            emptyBtn.textContent = w.goToMain;
            emptyBtn.className = 'sat-empty-btn';
        }
    };

    const render = (force = false): void => {
        const s = client.status;
        // Locked now: the copy shows again only when the main window sends the tree anew (it does at the unlock).
        if (s?.locked && !wasLocked) awaitingTree = true;
        wasLocked = !!s?.locked;
        const agent = opts.agent?.() ?? null;
        const next = satelliteScreen({
            connection: client.connection,
            hasTree: client.hasTree,
            gone: client.treeGone,
            live: !!s?.live,
            locked: !!s?.locked,
            awaitingTree,
            ...(agent ? { agent: agent.follow, agentIdle: agent.idle, noJumpView: agent.noJump, bridgeLost: agent.lost, takeover: agent.takeover } : {}),
        });
        const prev = shown;
        shown = next;
        const key = `${next.strip}${next.strip === 'lost' ? `:${agent?.follow === 'detached'}` : ''}`;
        if (force || key !== stripKey) {
            stripKey = key;
            strip.hidden = next.strip === null;
            writeStrip(next.strip, agent);
            syncOffset();
        }
        if (force || next.empty !== prev.empty) {
            empty.hidden = next.empty === null;
            writeEmpty(next.empty);
        }
        if (force || next.loading !== prev.loading) {
            skeleton.hidden = !next.loading;
            loadingLabel.textContent = strings.win.loading;
            if (labelTimer) { clearTimeout(labelTimer); labelTimer = null; }
            loadingLabel.classList.remove('is-shown');
            if (next.loading) labelTimer = setTimeout(() => { labelTimer = null; loadingLabel.classList.add('is-shown'); }, LOADING_LABEL_DELAY_MS);
        }
        html.classList.toggle('sat-muted', next.muted);
        const content = opts.content?.();
        if (content) {
            const away = next.loading || next.empty !== null;
            content.inert = away;
            if (away) content.setAttribute('aria-hidden', 'true');
            else content.removeAttribute('aria-hidden');
        }
    };

    client.on('connection', () => render());
    client.on('status', () => render());
    client.on('data', () => render());
    client.on('tree-gone', () => render());
    client.on('tree', (e) => {
        // A whole tree: what the lock held back is here again.
        awaitingTree = false;
        render();
        if (e.switchedFrom && !e.afterConflict) opts.toast(strings.win.treeSwitched(e.switchedFrom.name, e.name), SWITCHED_TOAST_MS);
    });
    client.on('conflict', () => opts.toast(strings.win.editConflict, CONFLICT_TOAST_MS));
    render(true);
    return { refresh: () => render(true), update: () => render(), screen: () => shown };
}
