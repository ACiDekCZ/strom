/**
 * The search field of a section of the Research overview (spec 083 §3): the
 * Queue's (spec 052, searched by the research through its bridge: `remote`),
 * Awaiting action's and What the research knows' (searched here: `local`).
 *
 * Each section has its own field and text, kept by the overview's registry
 * from its opening to its closing; nothing of it is stored. The overview is
 * drawn anew at any moment, so the field is one element moved into each new
 * drawing: its text, caret, focus and an input method's composition stay.
 */

import { strings } from '../strings.js';

export type SearchSection = 'queue' | 'waiting' | 'knows';
export type SectionSearchMode = 'remote' | 'local';

export interface SectionSearchOpts {
    /** The section, the key of its field in the registry. */
    section: SearchSection;
    /** `remote`: the indicator, `aria-busy` and the section dimmed while read (the Queue); `local`: none of it. */
    mode: SectionSearchMode;
    placeholder: string;
    ariaLabel: string;
    /** The × button's name (default: "Clear search"). */
    clearLabel?: string;
    maxLength?: number;
    /** The text changed (typed, composed, emptied): `local` filters at once, `remote` waits for a pause of typing. */
    onInput(text: string): void;
    /** ↓ in the field: the focus on the section's first row; false: none there (the key does what it does). */
    onArrowDown(): boolean;
    /** The field was cleared (×, Escape, Clear search): in place of `onInput('')`. */
    onCleared?(): void;
    /** The field is gone (the overview closed). */
    onDestroy?(): void;
}

/** The pause after the last change before a screen reader is told what was found (`local`). */
export const SECTION_SEARCH_ANNOUNCE_MS = 500;

const PREFIX: Record<SearchSection, string> = {
    queue: 'research-overview__queue-search',
    waiting: 'research-overview__section-search',
    knows: 'research-overview__section-search',
};

const GLASS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
    + '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

type Caret = { start: number | null; end: number | null; dir: 'forward' | 'backward' | 'none' | null };

export class SectionSearch {
    readonly section: SearchSection;
    readonly mode: SectionSearchMode;
    /** `role="search"`: the magnifier, the field, the indicator (remote), × and the screen reader's live region. */
    readonly box: HTMLElement;
    readonly input: HTMLInputElement;
    readonly clearButton: HTMLButtonElement;
    /** The 14 px indicator in the field (remote only). */
    readonly spinner: HTMLElement | null;
    /** What a screen reader is told (polite live region, visually hidden). */
    readonly live: HTMLElement;
    /** The visible line "Found n of m" (`local`; `aria-hidden`, the live region says it), placed by the section. */
    readonly status: HTMLElement;
    destroyed = false;
    /**
     * The phases and groups folded or unfolded during the search (`local`):
     * empty when it starts, emptied when it is cleared, so what was folded by
     * hand before it comes back.
     */
    readonly searchOpen = new Map<string, boolean>();
    /** The focus goes back to the field after a redraw (no one moved it there). */
    restoring = false;
    private opts: SectionSearchOpts;
    /** What was said last (`local`): the same words at the next drawing are not said again. */
    private said = '';
    private announceTimer: ReturnType<typeof setTimeout> | null = null;
    private caret: Caret | null = null;

    constructor(opts: SectionSearchOpts) {
        this.opts = opts;
        this.section = opts.section;
        this.mode = opts.mode;
        const p = PREFIX[opts.section];
        const box = this.box = make('div', p);
        box.setAttribute('role', 'search');
        box.dataset.search = opts.section;
        const glass = box.appendChild(make('span', `${p}-icon`));
        glass.setAttribute('aria-hidden', 'true');
        glass.innerHTML = GLASS;
        const input = this.input = box.appendChild(make('input', `${p}-input`));
        input.type = 'search';
        input.setAttribute('aria-label', opts.ariaLabel);
        input.placeholder = opts.placeholder;
        input.autocomplete = 'off';
        input.spellcheck = false;
        if (opts.maxLength) input.maxLength = opts.maxLength;
        const tail = box.appendChild(make('span', `${p}-tail`));
        if (opts.mode === 'remote') {
            const spin = this.spinner = tail.appendChild(make('span', `live-panel-spinner ${p}-spin`));
            spin.setAttribute('aria-hidden', 'true');
            spin.hidden = true;
        } else this.spinner = null;
        const clear = this.clearButton = tail.appendChild(make('button', `${p}-clear`, '×'));
        clear.type = 'button';
        const clearLabel = opts.clearLabel ?? strings.live.queueSearchClear;
        clear.setAttribute('aria-label', clearLabel);
        clear.title = clearLabel;
        clear.hidden = true;
        const live = this.live = box.appendChild(make('span', `${p}-live`));
        live.setAttribute('aria-live', 'polite');
        const status = this.status = make('div', 'research-overview__search-status');
        status.setAttribute('aria-hidden', 'true');

        const changed = (): void => {
            if (this.destroyed) return;
            clear.hidden = input.value === '';
            if (input.value === '') this.searchOpen.clear();
            this.opts.onInput(input.value);
        };
        input.addEventListener('input', (e) => {
            // Composed characters (an input method) count once composed.
            if ((e as InputEvent).isComposing) return;
            changed();
        });
        input.addEventListener('compositionend', changed);
        input.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Escape') {
                // A search ends first (the overview stays); an empty field lets Escape close the overview.
                if (input.value === '') return;
                e.preventDefault();
                e.stopPropagation();
                this.clear();
            } else if (e.key === 'ArrowDown') {
                if (this.opts.onArrowDown()) e.preventDefault();
            }
        });
        clear.addEventListener('click', () => this.clear());
    }

    /** The text in the field ('' = no search). */
    get text(): string {
        return this.input.value;
    }

    /** The callbacks of the latest drawing (the field itself stays). */
    update(opts: Partial<Omit<SectionSearchOpts, 'section' | 'mode'>>): void {
        this.opts = { ...this.opts, ...opts };
        if (opts.placeholder !== undefined) this.input.placeholder = opts.placeholder;
        if (opts.ariaLabel !== undefined) this.input.setAttribute('aria-label', opts.ariaLabel);
    }

    /**
     * Put the field into `host` (the section's new drawing): always the same
     * element, so its text and caret stay; the focus it had before the redraw
     * (`noteFocus`) goes back to it.
     */
    mount(host: HTMLElement): HTMLInputElement {
        // Greyed while the overview's own window had no main window: usable again until greyed anew.
        for (const c of [this.input, this.clearButton]) {
            if (!c.dataset.greyed) continue;
            delete c.dataset.greyed;
            c.removeAttribute('aria-disabled');
            c.disabled = false;
        }
        host.appendChild(this.box);
        this.restoreFocus();
        return this.input;
    }

    /** Put the visible "Found n of m" line into `host` (the same element each drawing). */
    mountStatus(host: HTMLElement): HTMLElement {
        host.appendChild(this.status);
        return this.status;
    }

    /** Clear the search (×, Escape, Clear search): the section whole again, the caret in the empty field. */
    clear(focus = true): void {
        if (this.destroyed) return;
        this.input.value = '';
        this.clearButton.hidden = true;
        this.searchOpen.clear();
        this.silence();
        if (this.opts.onCleared) this.opts.onCleared();
        else this.opts.onInput('');
        if (focus && !this.destroyed && this.input.isConnected) this.input.focus({ preventScroll: true });
    }

    /**
     * Say what was found. `remote`: told a screen reader at once (the search
     * was read after a pause already). `local`: shown at once, told a screen
     * reader once the typing paused for `SECTION_SEARCH_ANNOUNCE_MS`.
     */
    announce(msg: string, show = true): void {
        if (this.destroyed) return;
        if (this.mode === 'remote') {
            this.live.textContent = msg;
            return;
        }
        // "Nothing found" stands in its own frame: the line stays empty then.
        this.status.textContent = show ? msg : '';
        if (msg === this.said) return;
        this.said = msg;
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = setTimeout(() => {
            this.announceTimer = null;
            if (!this.destroyed) this.live.textContent = msg;
        }, SECTION_SEARCH_ANNOUNCE_MS);
    }

    /** Nothing said or shown of a search (it was cleared). */
    silence(): void {
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = null;
        this.said = '';
        this.live.textContent = '';
        this.status.textContent = '';
    }

    /** `remote`: the search is typed or read — the indicator, `aria-busy` on the field. */
    setPending(on: boolean): void {
        if (!this.spinner) return;
        this.spinner.hidden = !on;
        if (on) this.input.setAttribute('aria-busy', 'true');
        else this.input.removeAttribute('aria-busy');
        this.box.classList.toggle('is-pending', on);
    }

    /** A redraw begins: whether the field has the focus (and where its caret is). */
    noteFocus(): void {
        const input = this.input;
        this.caret = document.activeElement === input
            ? { start: input.selectionStart, end: input.selectionEnd, dir: input.selectionDirection } : null;
    }

    /** The field is drawn again: the focus it had goes back to it, its caret where it was. */
    restoreFocus(): void {
        const was = this.caret;
        this.caret = null;
        const input = this.input;
        if (!was || !input.isConnected || document.activeElement === input) return;
        this.restoring = true;
        try {
            input.focus({ preventScroll: true });
        } finally {
            this.restoring = false;
        }
        if (was.start !== null && was.end !== null) {
            try { input.setSelectionRange(was.start, was.end, was.dir ?? undefined); } catch { /* not a text field */ }
        }
    }

    /** The overview closed: the field and its text are gone. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = null;
        this.caret = null;
        this.box.remove();
        this.status.remove();
        this.opts.onDestroy?.();
    }
}

/**
 * The search fields of one Research overview, one per section: made when a
 * section first draws its field, all destroyed when the overview closes.
 */
export class SectionSearches {
    private readonly map = new Map<SearchSection, SectionSearch>();

    /** The section's field (null: none made since the overview opened). */
    get(section: SearchSection): SectionSearch | null {
        const s = this.map.get(section);
        return s && !s.destroyed ? s : null;
    }

    /** The section's text ('' = none). */
    text(section: SearchSection): string {
        return this.get(section)?.text ?? '';
    }

    /** The section's field, made on first use; later the same one with the drawing's callbacks. */
    ensure(opts: SectionSearchOpts): SectionSearch {
        const had = this.get(opts.section);
        if (had && had.mode === opts.mode) {
            had.update(opts);
            return had;
        }
        had?.destroy();
        const s = new SectionSearch(opts);
        this.map.set(opts.section, s);
        return s;
    }

    /** One section's field ends (the Queue of another tree). */
    drop(section: SearchSection): void {
        this.map.get(section)?.destroy();
        this.map.delete(section);
    }

    /** The overview closed: every field ends, nothing of them stays. */
    reset(): void {
        for (const s of this.map.values()) s.destroy();
        this.map.clear();
    }

    /** A redraw of the overview begins: each field notes whether it has the focus. */
    noteFocus(): void {
        for (const s of this.map.values()) if (!s.destroyed) s.noteFocus();
    }
}

/** The fields of the Research overview drawn in this window. */
export const overviewSearches = new SectionSearches();

/**
 * ↓ of a `local` field: the focus on the first row (`[data-row]`) of the
 * section the field is in; false when it has none.
 */
export function focusFirstSectionRow(s: SectionSearch): boolean {
    const body = sectionBodyOf(s.box);
    const row = body?.querySelector<HTMLElement>('[data-row]') ?? null;
    if (!row) return false;
    if (!row.hasAttribute('tabindex')) row.tabIndex = -1;
    row.focus();
    return true;
}

/**
 * The section's body around a part of it: the field and chips stand in it,
 * or in its sticky head over it in a column of the overview's own window
 * (spec 083 §4).
 */
export function sectionBodyOf(part: Element): HTMLElement | null {
    return part.closest<HTMLElement>('.live-section__body')
        ?? part.closest<HTMLElement>('.research-overview__sec')?.querySelector<HTMLElement>(':scope > .live-section__body') ?? null;
}
