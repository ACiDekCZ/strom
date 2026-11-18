/**
 * A small DOM for unit tests of UI helpers (the test suite has no browser DOM): elements, text, attributes,
 * `dataset`, `classList`, events (Node's own EventTarget) and the selectors the helpers use (tag, .class,
 * [attr="v"], `:scope >`, `>` and descendant combinators, comma lists). `installMiniDom()` puts `document`,
 * `window`, `Element`, `HTMLElement` and `KeyboardEvent` on globalThis; the returned function takes them away.
 */

class MiniNode extends EventTarget {
    parentNode: MiniElement | MiniDocument | null = null;
    get parentElement(): MiniElement | null { return this.parentNode instanceof MiniElement ? this.parentNode : null; }
    get nextSibling(): MiniNode | null {
        const p = this.parentNode;
        if (!p) return null;
        const i = p.childNodes.indexOf(this);
        return p.childNodes[i + 1] ?? null;
    }
    get isConnected(): boolean {
        let n: MiniNode | MiniDocument | null = this;
        while (n && !(n instanceof MiniDocument)) n = (n as MiniNode).parentNode;
        return n instanceof MiniDocument;
    }
    remove(): void {
        const p = this.parentNode;
        if (!p) return;
        p.childNodes.splice(p.childNodes.indexOf(this), 1);
        this.parentNode = null;
    }
    after(...nodes: Array<MiniNode | string>): void {
        const p = this.parentNode;
        if (!(p instanceof MiniElement)) return;
        const ref = this.nextSibling;
        for (const n of nodes) p.insertBefore(toNode(n), ref);
    }
    get textContent(): string { return ''; }
    set textContent(_v: string) { /* only elements and text */ }
}

class MiniText extends MiniNode {
    constructor(public data: string) { super(); }
    override get textContent(): string { return this.data; }
    override set textContent(v: string) { this.data = v; }
}

function toNode(n: MiniNode | string): MiniNode {
    return typeof n === 'string' ? new MiniText(n) : n;
}

function camelToData(k: string): string {
    return 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

class MiniElement extends MiniNode {
    childNodes: MiniNode[] = [];
    attrs = new Map<string, string>();
    style: Record<string, string> = {};
    onclick: ((e: Event) => void) | null = null;
    readonly tagName: string;
    readonly dataset: Record<string, string | undefined>;
    constructor(tag: string) {
        super();
        this.tagName = tag.toUpperCase();
        const self = this;
        this.dataset = new Proxy({} as Record<string, string | undefined>, {
            get: (_t, k) => typeof k === 'string' ? self.attrs.get(camelToData(k)) : undefined,
            set: (_t, k, v) => { if (typeof k === 'string') self.attrs.set(camelToData(k), String(v)); return true; },
            deleteProperty: (_t, k) => { if (typeof k === 'string') self.attrs.delete(camelToData(k)); return true; },
            has: (_t, k) => typeof k === 'string' && self.attrs.has(camelToData(k)),
        });
        this.addEventListener('click', (e) => { this.onclick?.(e); });
    }
    get children(): MiniElement[] { return this.childNodes.filter((n): n is MiniElement => n instanceof MiniElement); }
    get childElementCount(): number { return this.children.length; }
    get firstElementChild(): MiniElement | null { return this.children[0] ?? null; }
    get lastElementChild(): MiniElement | null { const c = this.children; return c[c.length - 1] ?? null; }
    get id(): string { return this.attrs.get('id') ?? ''; }
    set id(v: string) { this.attrs.set('id', v); }
    get className(): string { return this.attrs.get('class') ?? ''; }
    set className(v: string) { this.attrs.set('class', v); }
    get type(): string { return this.attrs.get('type') ?? ''; }
    set type(v: string) { this.attrs.set('type', v); }
    get hidden(): boolean { return this.attrs.has('hidden'); }
    set hidden(v: boolean) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
    get classList() {
        const get = (): string[] => this.className.split(/\s+/).filter(Boolean);
        const put = (l: string[]): void => { this.className = [...new Set(l)].join(' '); };
        return {
            add: (...c: string[]) => put([...get(), ...c]),
            remove: (...c: string[]) => put(get().filter(x => !c.includes(x))),
            toggle: (c: string, on?: boolean) => {
                const has = get().includes(c);
                const want = on ?? !has;
                if (want) put([...get(), c]); else put(get().filter(x => x !== c));
                return want;
            },
            contains: (c: string) => get().includes(c),
        };
    }
    getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
    setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); }
    removeAttribute(k: string): void { this.attrs.delete(k); }
    hasAttribute(k: string): boolean { return this.attrs.has(k); }
    override get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
    override set textContent(v: string) { this.replaceChildren(...(v ? [new MiniText(v)] : [])); }
    insertBefore(n: MiniNode, ref: MiniNode | null): MiniNode {
        n.remove();
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
        n.parentNode = this;
        return n;
    }
    appendChild(n: MiniNode): MiniNode { return this.insertBefore(n, null); }
    append(...nodes: Array<MiniNode | string>): void { for (const n of nodes) this.appendChild(toNode(n)); }
    replaceChildren(...nodes: Array<MiniNode | string>): void {
        const keep = nodes.map(toNode);
        for (const c of [...this.childNodes]) if (!keep.includes(c)) c.remove();
        for (const n of keep) n.remove();
        for (const n of keep) this.appendChild(n);
    }
    matches(sel: string): boolean { return parseList(sel).some(chain => matchChain(this, chain, null)); }
    closest(sel: string): MiniElement | null {
        for (let e: MiniElement | null = this; e; e = e.parentElement) if (e.matches(sel)) return e;
        return null;
    }
    querySelectorAll(sel: string): MiniElement[] {
        const chains = parseList(sel);
        const out: MiniElement[] = [];
        const walk = (e: MiniElement): void => {
            for (const c of e.children) {
                if (chains.some(ch => matchChain(c, ch, this))) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(sel: string): MiniElement | null { return this.querySelectorAll(sel)[0] ?? null; }
}

class MiniDocument extends EventTarget {
    childNodes: MiniNode[] = [];
    readonly documentElement: MiniElement;
    readonly body: MiniElement;
    constructor() {
        super();
        this.documentElement = new MiniElement('html');
        this.documentElement.parentNode = this;
        this.childNodes.push(this.documentElement);
        this.body = new MiniElement('body');
        this.documentElement.appendChild(this.body);
    }
    createElement(tag: string): MiniElement { return new MiniElement(tag); }
    createTextNode(text: string): MiniText { return new MiniText(text); }
    getElementById(id: string): MiniElement | null {
        return this.documentElement.querySelectorAll(`[id="${id}"]`)[0] ?? null;
    }
    querySelector(sel: string): MiniElement | null { return this.documentElement.querySelector(sel); }
    querySelectorAll(sel: string): MiniElement[] { return this.documentElement.querySelectorAll(sel); }
}

interface Compound { scope: boolean; tag: string | null; classes: string[]; attrs: Array<[string, string | null]> }
type Chain = Array<{ comb: ' ' | '>' | null; c: Compound }>;

function parseCompound(s: string): Compound {
    const c: Compound = { scope: false, tag: null, classes: [], attrs: [] };
    const re = /(:scope)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|([\w-]+)|(\*)/gy;
    let m: RegExpExecArray | null;
    let pos = 0;
    while ((m = re.exec(s))) {
        pos = re.lastIndex;
        if (m[1]) c.scope = true;
        else if (m[2]) c.classes.push(m[2]);
        else if (m[3]) c.attrs.push([m[3], m[4] ?? null]);
        else if (m[5]) c.tag = m[5].toUpperCase();
    }
    if (pos !== s.length) throw new Error(`mini-dom: selector part not understood: ${s}`);
    return c;
}

function parseList(sel: string): Chain[] {
    return sel.split(',').map(part => {
        const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
        const chain: Chain = [];
        let comb: ' ' | '>' | null = null;
        for (const t of tokens) {
            if (t === '>') { comb = '>'; continue; }
            chain.push({ comb: chain.length ? (comb ?? ' ') : null, c: parseCompound(t) });
            comb = null;
        }
        return chain;
    });
}

function matchCompound(e: MiniElement, c: Compound, scope: MiniElement | null): boolean {
    if (c.scope && e !== scope) return false;
    if (c.tag && e.tagName !== c.tag) return false;
    if (c.classes.some(x => !e.classList.contains(x))) return false;
    return c.attrs.every(([k, v]) => v === null ? e.hasAttribute(k) : e.getAttribute(k) === v);
}

function matchChain(e: MiniElement, chain: Chain, scope: MiniElement | null): boolean {
    const at = (el: MiniElement | null, i: number): boolean => {
        if (!el) return false;
        const { comb, c } = chain[i];
        if (!matchCompound(el, c, scope)) return false;
        if (i === 0) return !scope || c.scope || isInside(el, scope);
        if (comb === '>') return at(el.parentElement, i - 1);
        for (let p = el.parentElement; p; p = p.parentElement) if (at(p, i - 1)) return true;
        return false;
    };
    return at(e, chain.length - 1);
}

function isInside(e: MiniElement, scope: MiniElement): boolean {
    for (let p = e.parentElement; p; p = p.parentElement) if (p === scope) return true;
    return false;
}

class MiniKeyboardEvent extends Event {
    readonly key: string;
    constructor(type: string, init: EventInit & { key?: string } = {}) {
        super(type, init);
        this.key = init.key ?? '';
    }
}

export type { MiniElement };

export function installMiniDom(): { document: MiniDocument; uninstall: () => void } {
    const g = globalThis as Record<string, unknown>;
    const names = ['document', 'window', 'Element', 'HTMLElement', 'KeyboardEvent'] as const;
    const before = names.map(n => [n, g[n]] as const);
    const doc = new MiniDocument();
    g.document = doc;
    g.window = { matchMedia: (q: string) => ({ matches: (g.__miniReducedMotion === true) && q.includes('reduce') }) };
    g.Element = MiniElement;
    g.HTMLElement = MiniElement;
    g.KeyboardEvent = MiniKeyboardEvent;
    return {
        document: doc,
        uninstall: () => { for (const [n, v] of before) { if (v === undefined) delete g[n]; else g[n] = v; } },
    };
}
