/**
 * The other research trees on this computer (spec 011, U4a): their state
 * marks in the tree switcher (followed live, running, waiting, not running),
 * one dot on the closed switcher for the other trees, the "Elsewhere" strip in
 * the research panel and the overview's Now, and the sentence when the
 * browser keeps the page from the research programs.
 *
 * The other trees' bridges are asked for their status only
 * (askResearchBridge: nothing is sent, nothing fetched), one at a time, about
 * once a minute and when the switcher opens; never on a device that cannot
 * reach them (a phone, Safari, a shared file). The open tree's own state comes
 * from its own ask and the live session. Nothing here is persisted but whether
 * "Other trees" is unfolded (localStorage).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeMetadata } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { researchLinksEnabled, storedResearchBridge, storedResearchWaiting } from '../research-device.js';
import { parseLiveBridge } from '../research-link.js';
import { waitingTodoCount } from '../research-waiting.js';
import {
    agoShort, BridgeAnswer, elsewhereTrees, otherBridgeTargets, OtherBridgesPoller, OtherBridgesTimings, OTHER_BRIDGES_TIMINGS,
    researchTreesDot, researchTreeState, ResearchTreeState,
} from '../research-others.js';
import { el, liveSession, onComputer } from './research-ui.js';
import { researchBridgesAskable, researchPageVisible } from './research-sync-ui.js';
import { uiModule } from './module.js';

/** One mark beside a tree's name. */
interface ResearchMark {
    kind: 'live' | 'running' | 'waiting' | 'off';
    text: string;
    /** A shorter text where room is scarce (a phone held sideways). */
    short?: string;
}

/** A tree's marks and the sentence that says them (screen readers, hover). */
interface ResearchMarks {
    marks: ResearchMark[];
    sr: string;
}

interface ElsewhereTree {
    tree: TreeMetadata;
    name: string;
    state: ResearchTreeState;
}

/** "Other trees" unfolded in the panel (this device). */
const OPEN_KEY = 'strom-other-trees-open';

/** The last answer of each research's bridge (a busy answer keeps the one before). */
const known = new Map<string, BridgeAnswer>();
let poller: OtherBridgesPoller | null = null;
let marksTimer: ReturnType<typeof setTimeout> | null = null;
/** The "Elsewhere" trees as last drawn (a change redraws the panel). */
let elsewhereDrawn = '';

function timings(): OtherBridgesTimings {
    const o = (globalThis as { __OTHER_RESEARCH_MS?: Partial<OtherBridgesTimings> }).__OTHER_RESEARCH_MS;
    return { ...OTHER_BRIDGES_TIMINGS, ...(o ?? {}) };
}

function othersOpen(): boolean {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

function setOthersOpen(open: boolean): void {
    try {
        if (open) localStorage.setItem(OPEN_KEY, '1');
        else localStorage.removeItem(OPEN_KEY);
    } catch { /* private window: unfolded for this view only */ }
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The text with the command `strom app` set as code. */
function withCommand(parent: HTMLElement, text: string): HTMLElement {
    const parts = text.split('strom app');
    parts.forEach((part, i) => {
        if (part) parent.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) parent.appendChild(el('code', undefined, 'strom app'));
    });
    return parent;
}

function marksHtml(m: ResearchMarks): string {
    const inner = m.marks.map(b => `<span class="rs-mark rs-mark--${b.kind}" aria-hidden="true">${b.short
        ? `<span class="rs-full">${esc(b.text)}</span><span class="rs-short">${esc(b.short)}</span>` : esc(b.text)}</span>`).join('');
    return inner ? `<span class="tree-item-badges" role="img" aria-label="${esc(m.sr)}">${inner}</span>` : '';
}

function marksElement(m: ResearchMarks, cls = ''): HTMLElement {
    const group = el('span', `rs-marks${cls ? ` ${cls}` : ''}`);
    for (const b of m.marks) {
        const mark = el('span', `rs-mark rs-mark--${b.kind}`);
        mark.setAttribute('aria-hidden', 'true');
        if (b.short) {
            mark.append(el('span', 'rs-full', b.text), el('span', 'rs-short', b.short));
        } else mark.textContent = b.text;
        group.appendChild(mark);
    }
    return group;
}

export const researchOthersMethods = uiModule({
    /** Start asking the other trees' bridges (after the first render; once). */
    initOtherResearch(): void {
        if (poller || typeof window === 'undefined') return;
        poller = new OtherBridgesPoller({
            targets: () => this.otherResearchTargets(),
            ask: async (researchId, timeout) => {
                await this.askResearchBridge(researchId, timeout);
                return this.researchAnswerOf(researchId);
            },
            visible: researchPageVisible,
            enabled: () => this.otherResearchEnabled(),
            onAnswer: () => this.refreshResearchMarks(),
            onRound: () => this.refreshResearchMarks(),
            timings,
        });
        poller.start();
        document.addEventListener('visibilitychange', () => {
            if (researchPageVisible()) poller?.kick();
        });
        window.addEventListener('strom:tree-switched', () => this.refreshResearchMarks());
        this.refreshResearchMarks();
    },

    /** Marks apply on this device: a computer (not a phone), not Safari, research links on, not a shared file. */
    otherResearchEnabled(): boolean {
        return !DataManager.isViewMode() && onComputer() && researchLinksEnabled() && researchBridgesAskable();
    },

    /** Ask the other trees now unless their answers are fresh (the switcher opened). */
    kickOtherResearch(): void {
        if (this.otherResearchEnabled()) poller?.kick();
    },

    /** The researches a round asks: the other trees' (not the open one, not copies, not archives, address known). */
    otherResearchTargets(): string[] {
        const s = liveSession();
        const entries = TreeManager.getVisibleTrees().filter(t => !!t.research).map(t => ({
            treeId: t.id,
            researchId: t.research!.id,
            copy: !!t.research!.copy,
            archive: this.researchModeOf(t.research!.id, t.research) === 'archive',
            hasAddress: !!parseLiveBridge(storedResearchBridge(t.research!.id)?.base),
        }));
        return otherBridgeTargets(entries, TreeManager.getActiveTreeId(), s && !s.ended ? [s.researchId] : []);
    },

    /** A research's bridge's last answer in this page (its own poll or the other trees' round). */
    researchAnswerOf(researchId: string): BridgeAnswer | null {
        const rt = this.researchBridgeAnswer(researchId);
        const prev = known.get(researchId) ?? null;
        if (rt && !rt.busy && (!prev || rt.at >= prev.at)) {
            const answer: BridgeAnswer = { result: rt.up ? 'up' : rt.why === 'denied' ? 'denied' : 'off', status: rt.status, at: rt.at };
            known.set(researchId, answer);
            return answer;
        }
        return prev;
    },

    /** A tree's research state (null: no research, a copy, an archive, not known yet, or no marks on this device). */
    researchTreeStateOf(tree: TreeMetadata): ResearchTreeState | null {
        const link = tree.research;
        if (!link || link.copy || !this.otherResearchEnabled()) return null;
        const s = liveSession();
        if (s && !s.ended && s.treeId === tree.id) {
            return researchTreeState(null, { live: { working: s.working, waiting: s.waiting, accepts: s.accepts } });
        }
        if (this.researchModeOf(link.id, link) === 'archive') return null;
        const noAddress = !parseLiveBridge(storedResearchBridge(link.id)?.base);
        return researchTreeState(this.researchAnswerOf(link.id), { noAddress, accepts: this.researchAcceptsOf(link.id) });
    },

    /** The browser keeps the page from this computer's programs (one state for every tree). */
    researchMarksBlocked(): boolean {
        if (!this.otherResearchEnabled()) return false;
        return TreeManager.getVisibleTrees().some(t => !!t.research && !t.research.copy && this.researchAnswerOf(t.research.id)?.result === 'denied');
    },

    /** A tree's marks and their sentence (null: none; an idle tree has no marks but its sentence). */
    researchMarksOf(tree: TreeMetadata): ResearchMarks | null {
        if (this.researchMarksBlocked()) return null;
        const state = this.researchTreeStateOf(tree);
        if (!state || state.kind === 'blocked') return null;
        const o = strings.otherResearch;
        const marks: ResearchMark[] = [];
        let sr = '';
        if (state.kind === 'live') {
            marks.push({ kind: 'live', text: o.badgeLive(state.lines), short: state.lines >= 2 ? o.badgeLiveShort(state.lines) : undefined });
            sr = o.srLive(state.lines);
        } else if (state.kind === 'running') {
            marks.push({ kind: 'running', text: o.badgeRunning(state.lines) });
            sr = o.srRunning(state.lines);
        } else if (state.kind === 'idle') {
            sr = o.srIdle;
        } else {
            marks.push({ kind: 'off', text: o.badgeOff });
            const stored = storedResearchWaiting(tree.research!.id);
            const last = stored ? waitingTodoCount(stored.items) : 0;
            sr = [o.srOff, last > 0 ? o.offLast(last, agoShort(stored!.at, Date.now(), getCurrentLanguage())) : '', o.offReconnect].filter(Boolean).join(' ');
        }
        if (state.kind !== 'off' && state.waiting > 0) {
            marks.push({ kind: 'waiting', text: o.badgeWaiting(state.waiting) });
            sr += ` ${o.srWaiting(state.waiting)}`;
        }
        return { marks, sr };
    },

    /** The switcher row's marks (HTML; '' for none). */
    treeSwitcherMarksHtml(tree: TreeMetadata): string {
        const m = this.researchMarksOf(tree);
        return m ? marksHtml(m) : '';
    },

    /** The row's hover text: the marks' sentence. */
    treeSwitcherTitle(tree: TreeMetadata): string {
        return this.researchMarksOf(tree)?.sr ?? '';
    },

    /** The switcher marks trees at all now (its width makes room for them). */
    treeSwitcherMarksShown(): boolean {
        return this.otherResearchEnabled() && TreeManager.getVisibleTrees().some(t => !!t.research && !t.research.copy);
    },

    /** The sentence at the switcher's foot when the browser keeps the page from the research programs (HTML). */
    treeSwitcherBlockedHtml(): string {
        const o = strings.otherResearch;
        return `<div class="tree-switcher-blocked" data-research-blocked${this.researchMarksBlocked() ? '' : ' hidden'}>`
            + `<span class="tree-switcher-blocked-text">${esc(o.blockedSwitcher)}</span> `
            + `<button type="button" class="link-button tree-switcher-blocked-link" role="menuitem" `
            + `onclick="event.stopPropagation(); window.Strom.UI.showOtherResearchAllowHow()">${esc(o.blockedHow)} ↗</button></div>`;
    },

    /** The phone sheet's row: the marks on a second line (not running: how it reconnects). */
    treeSheetMarks(tree: TreeMetadata): { extra: HTMLElement; title: string } | null {
        const m = this.researchMarksOf(tree);
        if (!m || m.marks.length === 0) return m ? { extra: el('span', 'rs-marks rs-marks--sheet'), title: m.sr } : null;
        const extra = marksElement(m, 'rs-marks--sheet');
        if (m.marks.some(b => b.kind === 'off')) {
            extra.appendChild(withCommand(el('span', 'rs-marks__hint'), ` · ${strings.otherResearch.offReconnectShort}`));
        }
        extra.setAttribute('role', 'img');
        extra.setAttribute('aria-label', m.sr);
        return { extra, title: m.sr };
    },

    /** "How to allow ↗" under the switcher: today's hint on the browser's permission. */
    showOtherResearchAllowHow(): void {
        document.getElementById('tree-switcher-dropdown')?.classList.remove('active');
        void this.showResearchConnectFailed(new TypeError('blocked')).then(retry => {
            if (!retry) return;
            poller?.kick(0);
            this.refreshResearchStateSoon();
        });
    },

    /** The other trees worth naming in the panel: an agent works there or something waits. */
    researchElsewhere(): ElsewhereTree[] {
        if (!this.otherResearchEnabled() || this.researchMarksBlocked()) return [];
        const activeId = TreeManager.getActiveTreeId();
        const trees: ElsewhereTree[] = [];
        for (const tree of TreeManager.getVisibleTrees()) {
            if (tree.id === activeId || !tree.research || tree.research.copy) continue;
            const state = this.researchTreeStateOf(tree);
            if (state) trees.push({ tree, name: tree.name, state });
        }
        return elsewhereTrees(trees, getCurrentLanguage());
    },

    /** One "Elsewhere" row: the tree, its marks, ›; selecting it opens that tree. */
    researchElsewhereRow(t: ElsewhereTree, label: boolean): HTMLButtonElement {
        const o = strings.otherResearch;
        const m = this.researchMarksOf(t.tree);
        const row = el('button', 'rs-elsewhere__row');
        row.type = 'button';
        row.dataset.treeId = t.tree.id;
        if (label) row.appendChild(el('span', 'rs-elsewhere__label', o.otherTreeLabel));
        row.appendChild(el('span', 'rs-elsewhere__name', t.name));
        if (m) row.appendChild(marksElement(m));
        const chev = el('span', 'rs-elsewhere__chev', '›');
        chev.setAttribute('aria-hidden', 'true');
        row.appendChild(chev);
        row.setAttribute('aria-label', o.otherTreeSr(t.name, (m?.marks ?? []).map(b => b.text).join(', ')));
        if (m) row.title = m.sr;
        row.onclick = () => { void this.switchToTree(t.tree.id); };
        return row;
    },

    /**
     * The "Elsewhere" strip (under the panel's head, first in the overview's
     * Now): one other tree as a row, two or more as "Other trees: N" that
     * unfolds them. Nothing when no other tree is worth naming.
     */
    appendResearchElsewhere(parent: HTMLElement, where: 'panel' | 'overview'): void {
        const trees = this.researchElsewhere();
        elsewhereDrawn = this.researchPanelMarksKey(trees);
        if (trees.length === 0) return;
        const strip = el('div', `rs-elsewhere rs-elsewhere--${where}`);
        if (trees.length === 1) {
            strip.appendChild(this.researchElsewhereRow(trees[0], true));
        } else {
            const open = othersOpen();
            const sum = el('button', 'rs-elsewhere__sum');
            sum.type = 'button';
            sum.setAttribute('aria-expanded', String(open));
            const caret = el('span', 'rs-elsewhere__caret', open ? '▾' : '▸');
            caret.setAttribute('aria-hidden', 'true');
            sum.append(caret, el('span', 'rs-elsewhere__sumtext', strings.otherResearch.otherTrees(trees.length)));
            const dot = researchTreesDot(trees.map(t => t.state));
            if (dot) {
                const d = el('span', `rs-dot rs-dot--${dot}`);
                d.setAttribute('aria-hidden', 'true');
                sum.appendChild(d);
            }
            const rows = el('div', 'rs-elsewhere__rows');
            rows.hidden = !open;
            for (const t of trees) rows.appendChild(this.researchElsewhereRow(t, false));
            sum.onclick = () => {
                const now = rows.hidden;
                setOthersOpen(now);
                rows.hidden = !now;
                sum.setAttribute('aria-expanded', String(now));
                caret.textContent = now ? '▾' : '▸';
            };
            strip.append(sum, rows);
        }
        parent.appendChild(strip);
    },

    /**
     * The chip "+N trees" on the folded panel (unfolds it with the other trees
     * shown) and on the phone strip (the tree list). Null: none to name.
     */
    researchElsewhereChip(where: 'collapsed' | 'phone'): HTMLButtonElement | null {
        const trees = this.researchElsewhere();
        if (trees.length === 0) return null;
        const chip = el('button', 'live-panel-chip rs-elsewhere-chip');
        chip.type = 'button';
        const dot = researchTreesDot(trees.map(t => t.state));
        if (dot) {
            const d = el('span', `rs-dot rs-dot--${dot}`);
            d.setAttribute('aria-hidden', 'true');
            chip.appendChild(d);
        }
        chip.appendChild(el('span', undefined, strings.otherResearch.otherTreesChip(trees.length)));
        chip.onclick = (e) => {
            e.stopPropagation();
            if (where === 'phone') {
                this.showTreeSwitcherSheet();
                return;
            }
            setOthersOpen(true);
            this.toggleLivePanel();
        };
        return chip;
    },

    /**
     * Bring the marks up to date where they show (the open switcher list or
     * sheet, the closed switcher's dot, the panel's "Elsewhere"): in place,
     * after the current task (never in the way of drawing).
     */
    refreshResearchMarks(): void {
        if (marksTimer) return;
        marksTimer = setTimeout(() => {
            marksTimer = null;
            this.applyResearchMarks();
        }, 0);
    },

    applyResearchMarks(): void {
        const trees = TreeManager.getVisibleTrees();
        const byId = new Map(trees.map(t => [t.id as string, t]));
        // The open list: each row's marks and hover sentence, the blocked sentence.
        const dropdown = document.getElementById('tree-switcher-dropdown');
        if (dropdown && !DataManager.isViewMode()) {
            dropdown.classList.toggle('with-research', this.treeSwitcherMarksShown());
            dropdown.querySelectorAll<HTMLElement>('.tree-switcher-item[data-tree-id]').forEach(row => {
                const tree = byId.get(row.dataset.treeId ?? '');
                if (!tree) return;
                const html = this.treeSwitcherMarksHtml(tree);
                const old = row.querySelector('.tree-item-badges');
                if ((old?.outerHTML ?? '') !== html) {
                    old?.remove();
                    if (html) row.insertAdjacentHTML('beforeend', html);
                }
                const title = this.treeSwitcherTitle(tree);
                if (title) row.title = title;
                else row.removeAttribute('title');
            });
            const blocked = dropdown.querySelector<HTMLElement>('[data-research-blocked]');
            if (blocked) blocked.hidden = !this.researchMarksBlocked();
        }
        // The open sheet "Trees".
        document.querySelectorAll<HTMLElement>('.bottom-sheet-item[data-tree-id]').forEach(row => {
            const tree = byId.get(row.dataset.treeId ?? '');
            const label = row.querySelector('.bottom-sheet-label');
            if (!tree || !label) return;
            label.querySelector('.rs-marks')?.remove();
            const m = this.treeSheetMarks(tree);
            if (m) label.appendChild(m.extra);
        });
        const sheetBlocked = document.getElementById('tree-sheet-research-blocked');
        if (sheetBlocked) sheetBlocked.hidden = !this.researchMarksBlocked();
        this.refreshTreeSwitcherDot();
        // "Elsewhere" changed: the panel (and the overview) again.
        if (document.getElementById('live-panel') || document.getElementById('research-overview')) {
            if (this.researchPanelMarksKey(this.researchElsewhere()) !== elsewhereDrawn) this.renderLivePanel();
        }
    },

    /** The panel is being drawn with the marks as they are now (a change later draws it again). */
    noteResearchMarksDrawn(): void {
        elsewhereDrawn = this.researchPanelMarksKey(this.researchElsewhere());
    },

    /** What the panel shows of the marks: the other trees named, and whether the open tree's bridge answers (its idle panel). */
    researchPanelMarksKey(trees: readonly ElsewhereTree[]): string {
        const researchId = this.activeResearchId();
        const answer = researchId && this.otherResearchEnabled() ? this.researchAnswerOf(researchId) : null;
        const working = answer?.status?.working.some(w => !w.paused) ? 'w' : '';
        return `${elsewhereKey(trees)}#${answer?.result ?? ''}${working}`;
    },

    /** The closed switcher's dot: amber when something waits in another tree, green when an agent works in one. */
    refreshTreeSwitcherDot(): void {
        const btn = document.querySelector<HTMLElement>('.tree-switcher-btn');
        if (!btn) return;
        let dot = btn.querySelector<HTMLElement>('.tree-switcher-dot');
        const others = this.researchElsewhere();
        const kind = researchTreesDot(others.map(t => t.state));
        if (!kind) {
            dot?.remove();
            btn.removeAttribute('aria-label');
            return;
        }
        if (!dot) {
            dot = el('span', 'tree-switcher-dot');
            dot.setAttribute('aria-hidden', 'true');
            btn.appendChild(dot);
        }
        dot.dataset.kind = kind;
        const waiting = others.reduce((n, t) => n + t.state.waiting, 0);
        const name = TreeManager.getActiveTreeMetadata()?.name ?? '';
        btn.setAttribute('aria-label', strings.otherResearch.switcherDotSr(name, waiting));
    },
});

function elsewhereKey(trees: readonly ElsewhereTree[]): string {
    return trees.map(t => `${t.tree.id}:${t.name}:${t.state.kind}:${t.state.lines}:${t.state.waiting}`).join('|');
}
