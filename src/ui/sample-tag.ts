/**
 * The "Sample" tag of a sample tree (spec 143 §1): the showcase and the
 * bundled Berg family, wherever a tree is named (the toolbar's switcher, its
 * list, the phone's Trees sheet). The tag goes by the tree's mark, never by
 * its name: a renamed sample keeps it.
 *
 * Its hover text says what a sample is; on touch a tap on the tag shows the
 * same words in a small bubble (`.sample-why`) and does nothing else (the
 * switcher under it does not open). The bubble is one shared piece:
 * showSampleWhy() takes any content, so the showcase's view-only research
 * can show its own reasons in it.
 */
import { strings } from '../strings.js';
import { treeSampleKind } from '../tree-row.js';
import { storedResearchDemo } from '../research-device.js';
import type { TreeMetadata } from '../types.js';

const BUBBLE_ID = 'sample-why';
const COARSE = '(pointer: coarse)';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The tree the showcase `strom demo` made: its research's status says `tree.demo` (spec 143 K2, R1 N1). */
export function researchDemoTree(tree: Pick<TreeMetadata, 'research'>): boolean {
    return !!tree.research?.id && storedResearchDemo(tree.research.id);
}

/**
 * The tag's markup for a sample tree ('' for any other tree): a showcase,
 * the bundled sample, or the tree of the showcase `strom demo` made. Inside a
 * control (the switcher's button, a list row) it is a plain part of that
 * control; `focusable` makes it a control of its own (tab stop, Enter shows
 * the bubble) where it stands alone.
 */
export function sampleTagHtml(tree: Pick<TreeMetadata, 'sample' | 'demo' | 'research'> | null | undefined, opts: { focusable?: boolean } = {}): string {
    if (!tree || !(treeSampleKind(tree) || researchDemoTree(tree))) return '';
    installSampleTagBubble();
    const s = strings.sample;
    const own = opts.focusable ? ` tabindex="0" role="button" aria-label="${esc(`${s.tag}, ${s.tagTitle}`)}"` : '';
    return `<span class="tree-sample-tag" title="${esc(s.tagTitle)}"${own}>${esc(s.tag)}</span>`;
}

/** The tag as an element (the phone's Trees sheet builds its rows of elements), null for a tree that is no sample. */
export function sampleTagElement(tree: Pick<TreeMetadata, 'sample' | 'demo' | 'research'> | null | undefined): HTMLElement | null {
    const html = sampleTagHtml(tree);
    if (!html || typeof document === 'undefined') return null;
    const box = document.createElement('span');
    box.innerHTML = html;
    return box.firstElementChild as HTMLElement | null;
}

let installed = false;

/** Close the bubble, if one is open. */
export function hideSampleWhy(): void {
    if (typeof document === 'undefined') return;
    document.getElementById(BUBBLE_ID)?.remove();
}

/**
 * Show the bubble under `anchor` with `content` (a text, or nodes for a
 * richer bubble). It closes on a tap or click elsewhere, Escape, a scroll or
 * a resize. Returns the bubble.
 */
export function showSampleWhy(anchor: HTMLElement, content: string | Node): HTMLElement {
    installSampleTagBubble();
    hideSampleWhy();
    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.className = 'sample-why';
    bubble.setAttribute('role', 'tooltip');
    if (typeof content === 'string') {
        const span = document.createElement('span');
        span.textContent = content;
        bubble.appendChild(span);
    } else {
        bubble.appendChild(content);
    }
    document.body.appendChild(bubble);
    placeBubble(bubble, anchor);
    return bubble;
}

/** Under the anchor, inside the window with 16px to spare on each side (above it when there is no room below). */
function placeBubble(bubble: HTMLElement, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const w = bubble.offsetWidth;
    const h = bubble.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(16, Math.min(r.left, vw - w - 16));
    const below = r.bottom + 8;
    const top = below + h > vh - 8 && r.top - 8 - h >= 8 ? r.top - 8 - h : below;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
}

function coarse(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches;
}

/**
 * The tag's tap and key handling, installed once (by the first tag drawn):
 * on touch a tap on any tag shows the bubble and stops there; Enter or
 * Space on a focusable tag does the same with any pointer.
 */
export function installSampleTagBubble(): void {
    if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
    installed = true;
    document.addEventListener('click', (e) => {
        const tag = (e.target as Element | null)?.closest?.<HTMLElement>('.tree-sample-tag');
        if (!tag || !coarse()) return;
        e.preventDefault();
        e.stopPropagation();
        showSampleWhy(tag, tag.title || strings.sample.tagTitle);
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById(BUBBLE_ID)) hideSampleWhy();
            return;
        }
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const tag = (e.target as Element | null)?.closest?.<HTMLElement>('.tree-sample-tag[tabindex]');
        if (!tag) return;
        e.preventDefault();
        e.stopPropagation();
        showSampleWhy(tag, tag.title || strings.sample.tagTitle);
    }, true);
    document.addEventListener('pointerdown', (e) => {
        const bubble = document.getElementById(BUBBLE_ID);
        if (!bubble) return;
        const target = e.target as Element | null;
        if (target && (bubble.contains(target) || target.closest('.tree-sample-tag'))) return;
        hideSampleWhy();
    }, true);
    window.addEventListener('resize', hideSampleWhy);
    window.addEventListener('scroll', hideSampleWhy, true);
}
