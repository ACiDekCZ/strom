import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A small stand-in for the DOM (the unit tests run without one): what the
 * section's search field uses — elements in a tree, classes, attributes,
 * events, focus and the caret.
 */
class FakeClassList {
    constructor(private readonly owner: FakeEl) {}
    private get set(): Set<string> { return new Set(this.owner.className.split(/\s+/).filter(Boolean)); }
    contains(c: string): boolean { return this.set.has(c); }
    add(c: string): void { const s = this.set; s.add(c); this.owner.className = [...s].join(' '); }
    remove(c: string): void { const s = this.set; s.delete(c); this.owner.className = [...s].join(' '); }
    toggle(c: string, on?: boolean): boolean {
        const want = on ?? !this.contains(c);
        if (want) this.add(c); else this.remove(c);
        return want;
    }
}

class FakeEl extends EventTarget {
    children: FakeEl[] = [];
    parentNode: FakeEl | null = null;
    className = '';
    readonly classList = new FakeClassList(this);
    readonly attrs = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    hidden = false;
    disabled = false;
    textContent = '';
    innerHTML = '';
    value = '';
    type = '';
    placeholder = '';
    autocomplete = '';
    spellcheck = true;
    maxLength = -1;
    title = '';
    tabIndex = 0;
    selectionStart: number | null = 0;
    selectionEnd: number | null = 0;
    selectionDirection: 'forward' | 'backward' | 'none' | null = 'none';
    constructor(readonly tagName: string, readonly doc: FakeDoc) { super(); }
    appendChild<T extends FakeEl>(c: T): T {
        c.remove();
        c.parentNode = this;
        this.children.push(c);
        return c;
    }
    replaceChildren(): void {
        for (const c of [...this.children]) c.remove();
    }
    remove(): void {
        const p = this.parentNode;
        if (!p) return;
        p.children = p.children.filter(c => c !== this);
        this.parentNode = null;
        // A focused element taken out of the page loses the focus.
        if (this.doc.activeElement && this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
    }
    contains(e: FakeEl): boolean {
        for (let n: FakeEl | null = e; n; n = n.parentNode) if (n === this) return true;
        return false;
    }
    get isConnected(): boolean { return this.doc.body.contains(this); }
    setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
    getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
    removeAttribute(k: string): void { this.attrs.delete(k); }
    hasAttribute(k: string): boolean { return this.attrs.has(k); }
    focus(): void { this.doc.activeElement = this; }
    setSelectionRange(start: number, end: number, dir?: 'forward' | 'backward' | 'none'): void {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = dir ?? 'none';
    }
    private matches(sel: string): boolean {
        if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
        const attr = /^\[([\w-]+)\]$/.exec(sel);
        if (attr) return this.attrs.has(attr[1]) || (attr[1].startsWith('data-') && attr[1].slice(5) in this.dataset);
        return false;
    }
    closest(sel: string): FakeEl | null {
        for (let n: FakeEl | null = this; n; n = n.parentNode) if (n.matches(sel)) return n;
        return null;
    }
    querySelector(sel: string): FakeEl | null {
        for (const c of this.children) {
            if (c.matches(sel)) return c;
            const d = c.querySelector(sel);
            if (d) return d;
        }
        return null;
    }
    find(cls: string): FakeEl {
        const f = this.querySelector(`.${cls}`);
        if (!f) throw new Error(`no .${cls}`);
        return f;
    }
}

class FakeDoc {
    readonly body: FakeEl;
    activeElement: FakeEl | null = null;
    constructor() {
        this.body = new FakeEl('BODY', this);
        this.activeElement = this.body;
    }
    createElement(tag: string): FakeEl { return new FakeEl(tag.toUpperCase(), this); }
}

const key = (k: string, composing = false): Event => Object.assign(new Event('keydown', { cancelable: true }), { key: k, isComposing: composing });
const inputEvent = (composing = false): Event => Object.assign(new Event('input'), { isComposing: composing });

let doc: FakeDoc;

beforeEach(() => {
    doc = new FakeDoc();
    vi.stubGlobal('document', doc);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const load = async () => import('../ui/section-search.js');

function section(): FakeEl {
    const body = doc.createElement('div');
    body.className = 'live-section__body';
    doc.body.appendChild(body);
    return body;
}

describe('SectionSearch', () => {
    it('builds a search field with its a11y attributes', async () => {
        const { SectionSearch } = await load();
        const s = new SectionSearch({
            section: 'waiting', mode: 'local', placeholder: 'Search people…', ariaLabel: 'Search Awaiting action',
            onInput: () => {}, onArrowDown: () => false,
        });
        const box = s.box as unknown as FakeEl;
        const input = s.input as unknown as FakeEl;
        expect(box.getAttribute('role')).toBe('search');
        expect(box.className).toBe('research-overview__section-search');
        expect(input.type).toBe('search');
        expect(input.autocomplete).toBe('off');
        expect(input.spellcheck).toBe(false);
        expect(input.getAttribute('aria-label')).toBe('Search Awaiting action');
        expect(input.placeholder).toBe('Search people…');
        expect((s.clearButton as unknown as FakeEl).hidden).toBe(true);
        expect((s.clearButton as unknown as FakeEl).getAttribute('aria-label')).toBe('Clear search');
        expect((s.live as unknown as FakeEl).getAttribute('aria-live')).toBe('polite');
        expect((s.status as unknown as FakeEl).getAttribute('aria-hidden')).toBe('true');
        expect((s.status as unknown as FakeEl).className).toBe('research-overview__search-status');
        // Local: no indicator.
        expect(s.spinner).toBeNull();
        s.setPending(true);
        expect(input.hasAttribute('aria-busy')).toBe(false);
    });

    it('the Queue keeps its own classes and has the indicator (remote)', async () => {
        const { SectionSearch } = await load();
        const s = new SectionSearch({
            section: 'queue', mode: 'remote', placeholder: 'p', ariaLabel: 'Search the queue', maxLength: 400,
            onInput: () => {}, onArrowDown: () => false,
        });
        const box = s.box as unknown as FakeEl;
        expect(box.className).toBe('research-overview__queue-search');
        expect(box.find('research-overview__queue-search-input')).toBe(s.input as unknown as FakeEl);
        expect((s.input as unknown as FakeEl).maxLength).toBe(400);
        const spin = s.spinner as unknown as FakeEl;
        expect(spin.hidden).toBe(true);
        s.setPending(true);
        expect(spin.hidden).toBe(false);
        expect((s.input as unknown as FakeEl).getAttribute('aria-busy')).toBe('true');
        expect(box.classList.contains('is-pending')).toBe(true);
        s.setPending(false);
        expect(spin.hidden).toBe(true);
        expect((s.input as unknown as FakeEl).hasAttribute('aria-busy')).toBe(false);
    });

    it('reports typing, not while an input method composes', async () => {
        const { SectionSearch } = await load();
        const seen: string[] = [];
        const s = new SectionSearch({ section: 'knows', mode: 'local', placeholder: '', ariaLabel: '', onInput: t => seen.push(t), onArrowDown: () => false });
        const input = s.input as unknown as FakeEl;
        input.value = 'hro';
        input.dispatchEvent(inputEvent(true));
        expect(seen).toEqual([]);
        input.dispatchEvent(new Event('compositionend'));
        expect(seen).toEqual(['hro']);
        expect(s.text).toBe('hro');
        expect((s.clearButton as unknown as FakeEl).hidden).toBe(false);
        input.value = 'hrot';
        input.dispatchEvent(inputEvent());
        expect(seen).toEqual(['hro', 'hrot']);
    });

    it('mount() moves the same field into each new drawing, its focus and caret back', async () => {
        const { SectionSearches } = await load();
        const reg = new SectionSearches();
        const opts = { section: 'waiting' as const, mode: 'local' as const, placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false };
        const s = reg.ensure(opts);
        const host1 = section();
        const input = s.mount(host1 as unknown as HTMLElement) as unknown as FakeEl;
        input.value = 'hrotek';
        input.focus();
        input.setSelectionRange(2, 4, 'backward');
        // A redraw: noted, the old drawing removed (the focus with it), the section drawn anew.
        reg.noteFocus();
        host1.remove();
        expect(doc.activeElement).toBe(doc.body);
        const again = reg.ensure(opts);
        expect(again).toBe(s);
        const host2 = section();
        expect(again.mount(host2 as unknown as HTMLElement)).toBe(input as unknown as HTMLInputElement);
        expect(host2.children).toContain(s.box as unknown as FakeEl);
        expect(doc.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 4, 'backward']);
        expect(input.value).toBe('hrotek');
    });

    it('mount() gives no focus to a field that did not have it', async () => {
        const { SectionSearches } = await load();
        const reg = new SectionSearches();
        const s = reg.ensure({ section: 'knows', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        const other = section();
        other.focus();
        reg.noteFocus();
        s.mount(section() as unknown as HTMLElement);
        expect(doc.activeElement).toBe(other);
    });

    it('mount() makes a field greyed in a frozen window usable again', async () => {
        const { SectionSearch } = await load();
        const s = new SectionSearch({ section: 'knows', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        const input = s.input as unknown as FakeEl;
        input.dataset.greyed = 'all';
        input.setAttribute('aria-disabled', 'true');
        input.disabled = true;
        s.mount(section() as unknown as HTMLElement);
        expect(input.disabled).toBe(false);
        expect(input.hasAttribute('aria-disabled')).toBe(false);
        expect('greyed' in input.dataset).toBe(false);
    });

    it('Escape in a field with text clears it and stops; in an empty field it goes on', async () => {
        const { SectionSearch } = await load();
        const seen: string[] = [];
        const s = new SectionSearch({ section: 'waiting', mode: 'local', placeholder: '', ariaLabel: '', onInput: t => seen.push(t), onArrowDown: () => false });
        s.mount(section() as unknown as HTMLElement);
        const input = s.input as unknown as FakeEl;
        input.value = 'olsinky';
        const e1 = key('Escape');
        const stop = vi.spyOn(e1, 'stopPropagation');
        input.dispatchEvent(e1);
        expect(stop).toHaveBeenCalled();
        expect(e1.defaultPrevented).toBe(true);
        expect(input.value).toBe('');
        expect(seen).toEqual(['']);
        expect(doc.activeElement).toBe(input);
        expect((s.clearButton as unknown as FakeEl).hidden).toBe(true);
        const e2 = key('Escape');
        const stop2 = vi.spyOn(e2, 'stopPropagation');
        input.dispatchEvent(e2);
        expect(stop2).not.toHaveBeenCalled();
        expect(e2.defaultPrevented).toBe(false);
        // Composing: the input method's own Escape.
        input.value = 'x';
        const e3 = key('Escape', true);
        input.dispatchEvent(e3);
        expect(input.value).toBe('x');
    });

    it('× clears; onCleared stands in for onInput(\'\')', async () => {
        const { SectionSearch } = await load();
        const seen: string[] = [];
        let cleared = 0;
        const s = new SectionSearch({
            section: 'queue', mode: 'remote', placeholder: '', ariaLabel: '',
            onInput: t => seen.push(t), onArrowDown: () => false, onCleared: () => cleared++,
        });
        s.mount(section() as unknown as HTMLElement);
        (s.input as unknown as FakeEl).value = 'T815';
        (s.clearButton as unknown as FakeEl).dispatchEvent(new Event('click'));
        expect(s.text).toBe('');
        expect(cleared).toBe(1);
        expect(seen).toEqual([]);
        expect(doc.activeElement).toBe(s.input as unknown as FakeEl);
    });

    it('↓ hands the focus to the section\'s first row', async () => {
        const { SectionSearch, focusFirstSectionRow } = await load();
        let s: InstanceType<typeof SectionSearch> | null = null;
        s = new SectionSearch({ section: 'knows', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => focusFirstSectionRow(s!) });
        const body = section();
        s.mount(body as unknown as HTMLElement);
        const input = s.input as unknown as FakeEl;
        const none = key('ArrowDown');
        input.dispatchEvent(none);
        expect(none.defaultPrevented).toBe(false);
        const list = body.appendChild(doc.createElement('ul'));
        const row = list.appendChild(doc.createElement('li'));
        row.dataset.row = '1';
        const down = key('ArrowDown');
        input.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(doc.activeElement).toBe(row);
        expect(row.tabIndex).toBe(-1);
    });

    it('announce(): local shows at once, tells a screen reader after a pause of 500 ms', async () => {
        vi.useFakeTimers();
        const { SectionSearch, SECTION_SEARCH_ANNOUNCE_MS } = await load();
        expect(SECTION_SEARCH_ANNOUNCE_MS).toBe(500);
        const s = new SectionSearch({ section: 'waiting', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        s.announce('Nalezeno 9 z 106');
        vi.advanceTimersByTime(300);
        s.announce('Nalezeno 7 ze 106');
        expect(s.status.textContent).toBe('Nalezeno 7 ze 106');
        expect(s.live.textContent).toBe('');
        vi.advanceTimersByTime(499);
        expect(s.live.textContent).toBe('');
        vi.advanceTimersByTime(1);
        expect(s.live.textContent).toBe('Nalezeno 7 ze 106');
        // Cleared before the pause ends: nothing said.
        s.announce('Nalezeno 1 z 106');
        s.clear(false);
        vi.advanceTimersByTime(1000);
        expect(s.live.textContent).toBe('');
        expect(s.status.textContent).toBe('');
    });

    it('announce(): remote tells at once (the search was read after its own pause)', async () => {
        const { SectionSearch } = await load();
        const s = new SectionSearch({ section: 'queue', mode: 'remote', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        s.announce('3 tasks found');
        expect(s.live.textContent).toBe('3 tasks found');
        expect(s.status.textContent).toBe('');
    });
});

describe('SectionSearches (the overview\'s registry)', () => {
    it('one field per section, each with its own text; all gone when the overview closes', async () => {
        const { SectionSearches } = await load();
        const reg = new SectionSearches();
        let destroyed = 0;
        const make = (section: 'queue' | 'waiting' | 'knows') => reg.ensure({
            section, mode: section === 'queue' ? 'remote' : 'local', placeholder: '', ariaLabel: '',
            onInput: () => {}, onArrowDown: () => false, onDestroy: () => destroyed++,
        });
        const w = make('waiting');
        const k = make('knows');
        expect(w).not.toBe(k);
        w.mount(section() as unknown as HTMLElement);
        (w.input as unknown as FakeEl).value = 'hrotek';
        expect(reg.text('waiting')).toBe('hrotek');
        expect(reg.text('knows')).toBe('');
        expect(reg.get('queue')).toBeNull();
        reg.reset();
        expect(destroyed).toBe(2);
        expect(w.destroyed).toBe(true);
        expect((w.box as unknown as FakeEl).isConnected).toBe(false);
        expect(reg.get('waiting')).toBeNull();
        expect(reg.text('waiting')).toBe('');
        // Opened again: a new, empty field.
        const w2 = make('waiting');
        expect(w2).not.toBe(w);
        expect(w2.text).toBe('');
    });

    it('drop() ends one section\'s field only', async () => {
        const { SectionSearches } = await load();
        const reg = new SectionSearches();
        const opts = (section: 'queue' | 'knows') => ({ section, mode: 'local' as const, placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        const q = reg.ensure(opts('queue'));
        const k = reg.ensure(opts('knows'));
        reg.drop('queue');
        expect(q.destroyed).toBe(true);
        expect(reg.get('knows')).toBe(k);
    });

    it('the phases and groups folded during a search are forgotten when it is cleared or emptied', async () => {
        const { SectionSearch } = await load();
        const s = new SectionSearch({ section: 'waiting', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        const input = s.input as unknown as FakeEl;
        input.value = 'hrotek';
        input.dispatchEvent(inputEvent());
        s.searchOpen.set('group:todo:a', false);
        // Another word: what was folded during the search stays.
        input.value = 'hrotek p';
        input.dispatchEvent(inputEvent());
        expect(s.searchOpen.get('group:todo:a')).toBe(false);
        // The field emptied by hand.
        input.value = '';
        input.dispatchEvent(inputEvent());
        expect(s.searchOpen.size).toBe(0);
        // Clear search (×, Escape).
        input.value = 'hrotek';
        input.dispatchEvent(inputEvent());
        s.searchOpen.set('phase:sent', false);
        s.clear(false);
        expect(s.searchOpen.size).toBe(0);
    });

    it('the focus given back after a redraw is told apart from one moved there', async () => {
        const { SectionSearches } = await load();
        const reg = new SectionSearches();
        const s = reg.ensure({ section: 'waiting', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        const input = s.mount(section() as unknown as HTMLElement) as unknown as FakeEl & { focus(): void };
        const during: boolean[] = [];
        const plain = input.focus.bind(input);
        input.focus = () => { during.push(s.restoring); plain(); };
        input.focus();
        reg.noteFocus();
        (s.box as unknown as FakeEl).remove();
        s.mount(section() as unknown as HTMLElement);
        expect(during).toEqual([false, true]);
        expect(s.restoring).toBe(false);
    });

    it('announce(): nothing found stands in its own frame (the line empty); the same words are not said again', async () => {
        vi.useFakeTimers();
        const { SectionSearch } = await load();
        const s = new SectionSearch({ section: 'waiting', mode: 'local', placeholder: '', ariaLabel: '', onInput: () => {}, onArrowDown: () => false });
        s.announce('Nic nenalezeno.', false);
        expect(s.status.textContent).toBe('');
        vi.advanceTimersByTime(500);
        expect(s.live.textContent).toBe('Nic nenalezeno.');
        // A redraw with the same result (new data, nothing changed for the search): not said once more.
        (s.live as unknown as FakeEl).textContent = 'read';
        s.announce('Nic nenalezeno.', false);
        vi.advanceTimersByTime(500);
        expect(s.live.textContent).toBe('read');
        // Cleared: the next search is said again.
        s.clear(false);
        s.announce('Nic nenalezeno.', false);
        vi.advanceTimersByTime(500);
        expect(s.live.textContent).toBe('Nic nenalezeno.');
    });

    it('ensure() hands the latest drawing\'s callbacks to the kept field', async () => {
        const { SectionSearches } = await load();
        const reg = new SectionSearches();
        const seen: string[] = [];
        const base = { section: 'knows' as const, mode: 'local' as const, placeholder: '', ariaLabel: '', onArrowDown: () => false };
        const s = reg.ensure({ ...base, onInput: () => seen.push('old') });
        reg.ensure({ ...base, onInput: () => seen.push('new') });
        (s.input as unknown as FakeEl).value = 'x';
        (s.input as unknown as FakeEl).dispatchEvent(inputEvent());
        expect(seen).toEqual(['new']);
    });
});
