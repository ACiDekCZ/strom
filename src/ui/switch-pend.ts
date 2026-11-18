/**
 * A switch or a choice that writes (waiting buttons §6.1): it shows its new
 * state at once, dashed (`data-pend`) and locked (`aria-busy`, `aria-disabled`:
 * further clicks are ignored, visibly); after 120 ms its quiet words under the
 * label (`span.busy-st`, the 12 px spinner, "Saving…", "Turning on…"); after
 * 5 s "Waiting for the research"; at its limit the caller is told. The answer
 * ends it (a state once shown stays 300 ms at least): confirmed, the switch is
 * at rest; refused, it is back and one sentence stands at the switch
 * (`role=alert` when first drawn) with "Try again" — no toast.
 *
 * Switches are drawn anew from their data (HTML strings, rebuilt DOM), so the
 * state lives here by key and each drawing asks for it (`pendAttrs`,
 * `pendStatusHtml`, `pendRefusalHtml`); the state's changes ask the caller to
 * draw again (`redraw`).
 */

import { strings } from '../strings.js';
import { BUSY_MIN_MS, BUSY_SHOW_MS, announceBusy, busySpinHtml } from './busy.js';
import { researchActionLabel } from './research-open-mark.js';
import type { ResearchActionMark } from '../research-link.js';

/** After this long a switch still waiting says "Waiting for the research". */
export const PEND_WAIT_MS = 5000;

export interface PendOpts {
    /** The words after 120 ms (default "Saving…"). */
    label?: string;
    /** When the words become "Waiting for the research" (default 5 s; Infinity: never). */
    waitMs?: number;
    /** The limit (default none: the write's own limit ends it); `onLimit` says what follows. */
    limitMs?: number;
    onLimit?: () => void;
    /** Draw the switch again (the words came, changed, or the limit passed). */
    redraw: () => void;
}

export interface PendView {
    /** `lock`: locked, nothing shown yet; `shown`: its words; `waiting`: "Waiting for the research". */
    phase: 'lock' | 'shown' | 'waiting';
    label: string;
}

/** A refused write's sentence at its switch. */
export interface PendRefusal {
    text: string;
    retry?: () => void;
    /** One more way (the research's terminal when the bridge cannot do it), with its mark. */
    alt?: { label: string; run: () => void; mark?: ResearchActionMark };
}

interface Pend extends PendView {
    shownAt: number;
    timers: ReturnType<typeof setTimeout>[];
}

const pends = new Map<string, Pend>();
const refusals = new Map<string, PendRefusal & { said: boolean }>();
let retryListening = false;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stop(p: Pend | undefined): void {
    for (const t of p?.timers ?? []) clearTimeout(t);
}

/** The switch of `key` starts its write: locked now, its words after 120 ms, the wait's words after 5 s. */
export function startPend(key: string, opts: PendOpts): void {
    stop(pends.get(key));
    refusals.delete(key);
    const p: Pend = { phase: 'lock', label: opts.label ?? strings.busy.saving, shownAt: 0, timers: [] };
    pends.set(key, p);
    const mine = (): boolean => pends.get(key) === p;
    p.timers.push(setTimeout(() => {
        if (!mine() || p.phase !== 'lock') return;
        p.phase = 'shown';
        p.shownAt = Date.now();
        announceBusy(p.label);
        opts.redraw();
    }, BUSY_SHOW_MS));
    const wait = opts.waitMs ?? PEND_WAIT_MS;
    if (Number.isFinite(wait)) {
        p.timers.push(setTimeout(() => {
            if (!mine()) return;
            if (p.phase === 'lock') p.shownAt = Date.now();
            p.phase = 'waiting';
            p.label = strings.busy.waitingResearch;
            opts.redraw();
        }, Math.max(wait, BUSY_SHOW_MS)));
    }
    if (opts.limitMs !== undefined && Number.isFinite(opts.limitMs)) {
        p.timers.push(setTimeout(() => {
            if (!mine()) return;
            opts.onLimit?.();
        }, opts.limitMs));
    }
}

/** The state of `key`'s switch (null: at rest). */
export function pendOf(key: string): PendView | null {
    const p = pends.get(key);
    return p ? { phase: p.phase, label: p.label } : null;
}

export function isPend(key: string): boolean {
    return pends.has(key);
}

/** Whether any switch whose key starts with `prefix` waits (the others of its group stay locked). */
export function anyPend(prefix: string): boolean {
    for (const k of pends.keys()) if (k.startsWith(prefix)) return true;
    return false;
}

/**
 * The answer came: the state ends, a refusal's sentence stays at the switch. Resolves when the switch may be
 * drawn at rest (a state once shown stays 300 ms at least); false when another write of the switch began meanwhile.
 */
export async function endPend(key: string, refusal?: PendRefusal): Promise<boolean> {
    const p = pends.get(key);
    if (p && p.phase !== 'lock') {
        const left = p.shownAt + BUSY_MIN_MS - Date.now();
        if (left > 0) await new Promise(resolve => setTimeout(resolve, left));
    }
    if (p && pends.get(key) !== p) return false;
    stop(p);
    pends.delete(key);
    if (refusal) setPendRefusal(key, refusal);
    return true;
}

/** The state of `key` goes at once (its switch went, the page was left). */
export function dropPend(key: string): void {
    stop(pends.get(key));
    pends.delete(key);
}

/** A refusal's sentence at the switch of `key` (it goes on the next try or a change of the data). */
export function setPendRefusal(key: string, refusal: PendRefusal): void {
    refusals.set(key, { ...refusal, said: false });
    listenRetry();
}

export function pendRefusalOf(key: string): PendRefusal | null {
    return refusals.get(key) ?? null;
}

export function clearPendRefusal(key: string): void {
    refusals.delete(key);
}

/** The sentences of every key starting with `prefix` go (the dialog opened again, the data changed). */
export function clearPendRefusals(prefix: string): void {
    for (const k of [...refusals.keys()]) if (k.startsWith(prefix)) refusals.delete(k);
}

/** The attributes of a switch while it writes (none at rest). */
export function pendAttrs(key: string): string {
    return pends.has(key) ? ' data-pend="1" aria-busy="true" aria-disabled="true"' : '';
}

/** The same on a switch built as DOM (taken off at rest). */
export function applyPend(el: HTMLElement, key: string): void {
    if (pends.has(key)) {
        el.dataset.pend = '1';
        el.setAttribute('aria-busy', 'true');
        el.setAttribute('aria-disabled', 'true');
    } else {
        delete el.dataset.pend;
        el.removeAttribute('aria-busy');
    }
}

/** The words under the switch's label once shown (empty before 120 ms and at rest). */
export function pendStatusHtml(key: string): string {
    const p = pends.get(key);
    if (!p || p.phase === 'lock') return '';
    return `<span class="busy-st pend-st">${busySpinHtml(12)}${esc(p.label)}</span>`;
}

export function pendStatusEl(key: string): HTMLElement | null {
    const html = pendStatusHtml(key);
    if (!html) return null;
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild as HTMLElement;
}

/** The refusal's sentence with "Try again" (`role=alert` only when first drawn: a redraw does not say it again). */
export function pendRefusalHtml(key: string): string {
    const r = refusals.get(key);
    if (!r) return '';
    const role = r.said ? '' : ' role="alert"';
    r.said = true;
    const retry = r.retry
        ? `<button type="button" class="link busy-msg__retry" data-pend-retry="${esc(key)}">${esc(strings.busy.retry)}</button>` : '';
    const alt = r.alt
        ? `<button type="button" class="link busy-msg__alt" data-pend-alt="${esc(key)}">${researchActionLabel(r.alt.label, r.alt.mark ?? 'none', { size: 12 })}</button>` : '';
    return `<div class="busy-msg is-err pend-msg" data-pend-msg="${esc(key)}"${role}><span class="busy-msg__text">${esc(r.text)}</span>${retry}${alt}</div>`;
}

export function pendRefusalEl(key: string): HTMLElement | null {
    const html = pendRefusalHtml(key);
    if (!html) return null;
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild as HTMLElement;
}

/** "Try again" of a refusal: one listener for every switch (the sentence is drawn anew with its switch). */
function listenRetry(): void {
    if (retryListening || typeof document === 'undefined') return;
    retryListening = true;
    document.addEventListener('click', (e) => {
        const b = (e.target as Element | null)?.closest?.<HTMLElement>('[data-pend-retry], [data-pend-alt]');
        if (!b) return;
        const key = b.dataset.pendRetry ?? b.dataset.pendAlt ?? '';
        const r = refusals.get(key);
        const run = b.dataset.pendRetry !== undefined ? r?.retry : r?.alt?.run;
        if (!run) return;
        e.preventDefault();
        e.stopPropagation();
        refusals.delete(key);
        b.closest('.pend-msg')?.remove();
        run();
    }, true);
}

/** Test hook: every switch at rest, no sentence. */
export function resetPends(): void {
    for (const p of pends.values()) stop(p);
    pends.clear();
    refusals.clear();
}
