/**
 * The showcase's research is only read (spec 143 K4.1): its main actions stay
 * in sight, greyed with their marks, and say why they do nothing in a bubble
 * (`.sample-why`, the one of the Sample tag): "View only in the sample", the
 * command of the full research (`strom demo`) with Copy, what the action does
 * in the full research with its mark, and "How to ↗".
 *
 * One helper greys an action wherever it is drawn (markShowcaseOff); the
 * bubble comes on hover (a mouse), on the keyboard's focus and on a click or
 * tap, never running the action. Escape, a tap elsewhere or the focus leaving
 * close it. The showcase's own row (`.sample-note`) says the same under the
 * head of the research's overview.
 */
import { strings, getCurrentLanguage } from '../strings.js';
import { hideSampleWhy, installSampleTagBubble, showSampleWhy } from './sample-tag.js';
import { copyPlainText } from './table-view/table-cell.js';
import { setShowcaseWhy, showcaseAsOf, type ResearchActionMark, type ResearchShowcaseAction } from '../research-link.js';

/** The command that sets up the full research with the same made-up family. */
export const SHOWCASE_DEMO_COMMAND = 'strom demo';
/** Where the web says how (its anchor at the `strom demo` line). */
export const SHOWCASE_HOW_TO_URL = 'https://stromapp.info/research/#demo';
/** The bubble's id (the Sample tag's bubble: one at a time). */
export const SAMPLE_WHY_ID = 'sample-why';

const HOVER = '(hover: hover)';
const OFF = '[data-showcase-off]';

/** The mark of an action's group in words ("terminal", "AI + terminal"; '' : none). */
export function showcaseMarkWords(mark: ResearchActionMark): string {
    const s = strings.sample;
    return mark === 'agent' ? s.markAgent : mark === 'terminal' ? s.markTerminal : '';
}

/** "In full research: {action} · {mark}" ('' without an action). */
export function showcaseWhatText(label: string, mark: ResearchActionMark): string {
    const s = strings.sample;
    const text = label.replace(/\s*[↗…]\s*$/, '').trim();
    if (!text) return '';
    const words = showcaseMarkWords(mark);
    return words ? s.whyWhat(text, words) : s.whyWhatPlain(text);
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** `strom demo` as code with its Copy button. */
export function showcaseCodeEl(): HTMLElement {
    const box = make('span', 'sample-code');
    box.appendChild(make('code', undefined, SHOWCASE_DEMO_COMMAND));
    const copy = make('button', 'sample-copy', strings.sample.copy);
    copy.type = 'button';
    copy.setAttribute('aria-label', `${strings.sample.copy}: ${SHOWCASE_DEMO_COMMAND}`);
    copy.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyPlainText(SHOWCASE_DEMO_COMMAND);
        copy.textContent = strings.sample.copied;
    });
    box.appendChild(copy);
    return box;
}

/** "How to ↗": the web's page in a new window. */
export function showcaseHowToEl(): HTMLAnchorElement {
    const a = make('a', 'sample-howto', strings.sample.howTo);
    a.href = SHOWCASE_HOW_TO_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

/** The bubble's lines for an action (its label and mark; no label: without the action's line). */
export function showcaseWhyContent(label = '', mark: ResearchActionMark = 'none'): HTMLElement[] {
    const s = strings.sample;
    const lines: HTMLElement[] = [make('b', undefined, s.whyTitle)];
    const full = make('span', 'sample-why__full');
    full.append(`${s.whyFull} `, showcaseCodeEl());
    lines.push(full);
    const what = showcaseWhatText(label, mark);
    if (what) lines.push(make('span', 'what', what));
    lines.push(showcaseHowToEl());
    return lines;
}

/** The control the bubble stands for now (null: none, or the bubble of the Sample tag). */
let shownFor: HTMLElement | null = null;
let hoverClose: ReturnType<typeof setTimeout> | null = null;

function cancelHoverClose(): void {
    if (hoverClose !== null) clearTimeout(hoverClose);
    hoverClose = null;
}

/** Close the bubble of an action (the Sample tag's stays its own). */
export function hideShowcaseWhy(): void {
    cancelHoverClose();
    if (!shownFor) return;
    shownFor = null;
    hideSampleWhy();
}

/**
 * Show why an action does nothing in the showcase: beside `anchor` (null: the
 * focused control, else at the top of the window). Returns the bubble.
 */
export function showShowcaseWhy(anchor: HTMLElement | null, label = '', mark: ResearchActionMark = 'none'): HTMLElement {
    cancelHoverClose();
    const focused = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const at = anchor ?? (focused && focused !== document.body ? focused : null);
    const bubble = showSampleWhy(at ?? document.body, showcaseWhyContent(label, mark));
    bubble.classList.add('sample-why--action');
    if (!at) {
        bubble.style.left = `${Math.max(16, Math.round((window.innerWidth - bubble.offsetWidth) / 2))}px`;
        bubble.style.top = '16px';
    }
    shownFor = at;
    // The bubble keeps itself open under the pointer (its Copy, its link) and closes when it leaves it.
    bubble.addEventListener('mouseenter', cancelHoverClose);
    bubble.addEventListener('mouseleave', () => scheduleHoverClose());
    bubble.addEventListener('focusout', (e) => {
        const next = e.relatedTarget as Node | null;
        if (next && (bubble.contains(next) || shownFor?.contains(next))) return;
        hideShowcaseWhy();
    });
    return bubble;
}

function scheduleHoverClose(): void {
    cancelHoverClose();
    hoverClose = setTimeout(() => {
        hoverClose = null;
        // The keyboard's focus on the control keeps it.
        if (shownFor && document.activeElement === shownFor && shownFor.matches(':focus-visible')) return;
        hideShowcaseWhy();
    }, 250);
}

/**
 * A main action of the research greyed in the showcase: seen (focusable, its
 * mark kept), `aria-disabled` and described by the bubble; a click, Enter or a
 * tap shows the bubble and runs nothing. `label`: the action's name in the
 * bubble (default: the control's text).
 */
export function markShowcaseOff<T extends HTMLElement>(el: T, mark: ResearchActionMark, label?: string): T {
    installShowcaseWhy();
    el.dataset.showcaseOff = mark;
    el.dataset.showcaseLabel = label ?? shownLabel(el);
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('aria-describedby', SAMPLE_WHY_ID);
    el.removeAttribute('aria-haspopup');
    el.classList.add('is-showcase-off');
    // Seen and focusable (never `disabled`), not dragged.
    if ((el as Partial<HTMLButtonElement>).disabled) (el as unknown as HTMLButtonElement).disabled = false;
    if (el.hasAttribute('draggable')) el.setAttribute('draggable', 'false');
    return el;
}

const MARK_PARTS = ['research-open-sr', 'research-ai-badge', 'research-open-mark'];

/** The control's own words (without the mark and its hidden words). */
function shownLabel(el: HTMLElement): string {
    const walk = (n: Node): string => {
        const e = n as HTMLElement;
        if (e.classList && MARK_PARTS.some(c => e.classList.contains(c))) return '';
        if (e.classList && e.childNodes) return Array.from(e.childNodes as ArrayLike<Node>).map(walk).join('');
        return n.textContent ?? '';
    };
    return walk(el).replace(/\s+/g, ' ').trim();
}

function offOf(target: EventTarget | null): HTMLElement | null {
    return (target as Element | null)?.closest?.<HTMLElement>(OFF) ?? null;
}

/**
 * A click, Enter or Space on a greyed control (or inside it): nothing of its own runs, the bubble
 * says why. True when it was one.
 */
export function showcaseOffEvent(e: Event): boolean {
    if (e.type === 'keydown') {
        const key = (e as KeyboardEvent).key;
        if (key !== 'Enter' && key !== ' ') return false;
    } else if (e.type !== 'click') {
        return false;
    }
    const off = offOf(e.target);
    if (!off) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    showFor(off);
    return true;
}

/**
 * An item's actions in the showcase (spec 143 K4.1): its answer (`answerKeys`) greyed with its mark,
 * a website kept (a read), every other write and link of the research gone.
 */
export function showcaseItemActions<T extends { key: string; href?: string; off?: boolean; write?: boolean; disabled?: boolean }>(
    list: T[], answerKeys: readonly string[], answerOff: boolean,
): void {
    for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        if (a.href) continue;
        if (answerOff && answerKeys.includes(a.key)) list[i] = { ...a, off: true, write: false, disabled: false };
        else list.splice(i, 1);
    }
}

function showFor(el: HTMLElement): void {
    if (shownFor === el && document.getElementById(SAMPLE_WHY_ID)) {
        cancelHoverClose();
        return;
    }
    const mark = el.dataset.showcaseOff;
    showShowcaseWhy(el, el.dataset.showcaseLabel ?? '', mark === 'agent' || mark === 'terminal' ? mark : 'none');
}

function hoverable(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(HOVER).matches;
}

/** The labels of the showcase's main actions asked without a control (the second guard behind the UI). */
function actionLabel(action: ResearchShowcaseAction | null): { label: string; mark: ResearchActionMark } {
    const s = strings;
    switch (action) {
        case 'work': return { label: s.sample.continueResearch, mark: 'agent' };
        case 'send': return { label: s.sync.sendButton, mark: 'terminal' };
        case 'conflict': return { label: s.sync.decideInResearch, mark: 'terminal' };
        case 'conflict-agent': return { label: s.research.leaveToAgent, mark: 'agent' };
        case 'chat': return { label: s.research.askAgent, mark: 'agent' };
        case 'waiting-answer': return { label: s.research.answer, mark: 'none' };
        case 'queue-order': return { label: s.sample.queueOrder, mark: 'none' };
        case 'work-now': return { label: s.verify.processNow, mark: 'agent' };
        case 'direction-new': return { label: s.live.dirFormNew, mark: 'terminal' };
        default: return { label: '', mark: 'none' };
    }
}

let installed = false;

/**
 * Installed once (by the first control greyed, and at the start): the greyed
 * controls' pointer, key and focus, and the bubble said by the research's
 * second guard (an action asked without one of them).
 */
export function installShowcaseWhy(): void {
    if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
    installed = true;
    installSampleTagBubble();
    // Nothing of a greyed control runs: its press, drag and click stop here, before any handler of its own.
    const stop = (e: Event): void => {
        if (!offOf(e.target)) return;
        e.stopImmediatePropagation();
    };
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'dragstart', 'dblclick', 'contextmenu'] as const) {
        document.addEventListener(type, (e) => {
            if (type === 'dragstart' && offOf(e.target)) e.preventDefault();
            stop(e);
        }, { capture: true });
    }
    document.addEventListener('click', (e) => { showcaseOffEvent(e); }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shownFor) {
            hideShowcaseWhy();
            return;
        }
        showcaseOffEvent(e);
    }, true);
    document.addEventListener('focusin', (e) => {
        const off = offOf(e.target);
        if (!off) return;
        // The keyboard's focus says why at once; a click's focus waits for its click.
        let visible = false;
        try { visible = off.matches(':focus-visible'); } catch { visible = true; }
        if (visible) showFor(off);
    });
    document.addEventListener('focusout', (e) => {
        const off = offOf(e.target);
        if (!off || shownFor !== off) return;
        const next = e.relatedTarget as Node | null;
        const bubble = document.getElementById(SAMPLE_WHY_ID);
        if (next && bubble?.contains(next)) return;
        hideShowcaseWhy();
    });
    document.addEventListener('mouseover', (e) => {
        if (!hoverable()) return;
        const off = offOf(e.target);
        if (off) showFor(off);
    });
    document.addEventListener('mouseout', (e) => {
        if (!hoverable()) return;
        const off = offOf(e.target);
        if (!off || shownFor !== off) return;
        const next = e.relatedTarget as Node | null;
        if (next && (off.contains(next) || document.getElementById(SAMPLE_WHY_ID)?.contains(next))) return;
        scheduleHoverClose();
    });
    setShowcaseWhy((el, action) => {
        const { label, mark } = actionLabel(action);
        const off = el ? offOf(el) ?? el : null;
        if (off?.dataset.showcaseOff !== undefined) showFor(off);
        else showShowcaseWhy(off, label, mark);
    });
}

/** The showcase's day ("1. 11. 2026"), '' when not known. */
export function showcaseDayText(ts: number | null = showcaseAsOf(), lang: string = getCurrentLanguage()): string {
    if (ts === null || !Number.isFinite(ts)) return '';
    try {
        return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(ts));
    } catch {
        return new Date(ts).toISOString().slice(0, 10);
    }
}

/**
 * The showcase's quiet row under a head (no frame): "Sample as of 1 Nov 2026"
 * (`asOf`), "View only in the sample – full research:", `strom demo` with
 * Copy and "How to ↗".
 */
export function sampleNoteEl(opts: { asOf?: boolean } = {}): HTMLElement {
    installShowcaseWhy();
    const s = strings.sample;
    const p = make('p', 'sample-note');
    const day = opts.asOf ? showcaseDayText() : '';
    if (day) p.appendChild(make('span', 'sample-note__asof', s.asOfLine(day)));
    p.appendChild(make('span', 'sample-note__text', s.readOnly));
    p.appendChild(showcaseCodeEl());
    p.appendChild(showcaseHowToEl());
    return p;
}

// The research's second guard says why from the start (an action asked before any control was greyed).
installShowcaseWhy();

/**
 * When the research last worked, and on which line: the last run ended, else (`byLines`: a showcase's
 * snapshot keeps no runs) the newest of its lines' last work.
 */
export function researchLastWork(
    s: { runsEnded?: ReadonlyArray<{ ended: string; research?: string | null }> | null; researches?: ReadonlyArray<{ id: string; last?: { at: string } }> | null },
    byLines: boolean,
): { at: number; research?: string } | null {
    const run = [...(s.runsEnded ?? [])].sort((a, b) => Date.parse(b.ended) - Date.parse(a.ended))[0];
    const runAt = run ? Date.parse(run.ended) : NaN;
    if (run && Number.isFinite(runAt)) return { at: runAt, ...(run.research ? { research: run.research } : {}) };
    if (!byLines) return null;
    let best: { at: number; research?: string } | null = null;
    for (const d of s.researches ?? []) {
        const at = Date.parse(d.last?.at ?? '');
        if (Number.isFinite(at) && (!best || at > best.at)) best = { at, research: d.id };
    }
    return best;
}
