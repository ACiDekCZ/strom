/**
 * "Give a family tree", step 2 (spec 093 §3): the preview of the cut drawn
 * from src/gift-preview-model.ts. Small cards, the lines between them, the
 * dashed stubs; the counts on top, − / percent / + / "Whole" at the bottom.
 * It moves by dragging and the wheel (Ctrl or ⌘ + wheel zooms), two fingers
 * zoom on a touch screen; a click on a card opens its menu. The view (scale
 * and where the recipient stands) lives with the caller, so a change of the
 * depth or a branch keeps it. The phone's small preview is static.
 */

import { GIFT_PREVIEW_CARD, type GiftPreviewModel, type GiftPreviewStub } from '../gift-preview-model.js';
import type { PersonId } from '../types.js';

export const GIFT_PREVIEW_MIN_SCALE = 0.15;
export const GIFT_PREVIEW_MAX_SCALE = 2;
/** The first view: the whole cut when it fits from this scale, else the recipient at this scale (the design's 70 %). */
const FIRST_MIN_SCALE = 0.7;
/** The phone's small still preview: the same at the design's 42 %. */
const STILL_MIN_SCALE = 0.42;
/** Pointer travel (px) below which a press is a click, above it a drag. */
const DRAG_FROM = 4;

/** Where the preview looks: its scale and the first recipient's card centre on the screen (px in the preview). */
export interface GiftPreviewView {
    scale: number;
    ax: number;
    ay: number;
}

export interface GiftPreviewCardInfo {
    name: string;
    years: string;
    initials: string;
    female: boolean;
}

export interface GiftPreviewMenuItem {
    label: string;
    run: () => void;
}

export interface GiftPreviewOptions {
    model: GiftPreviewModel;
    /** The counts on top (HTML, already escaped). */
    topHtml: string;
    label: string;
    /** No controls, no moving (the phone's small preview). */
    still?: boolean;
    view: GiftPreviewView | null;
    onView: (view: GiftPreviewView) => void;
    card: (id: PersonId) => GiftPreviewCardInfo;
    stubTitle?: (stub: GiftPreviewStub) => string;
    onStub: (stub: GiftPreviewStub) => void;
    /** A card's menu: its title and items (none = no menu). */
    menu?: (id: PersonId) => { title: string; items: GiftPreviewMenuItem[] } | null;
    /** The open menu's closer is handed over (Escape closes it before the window); null when it closes. */
    onMenu?: (close: (() => void) | null) => void;
    texts: { zoomIn: string; zoomOut: string; fit: string; fitLabel: string };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CW = GIFT_PREVIEW_CARD.w;
const CH = GIFT_PREVIEW_CARD.h;

function clampScale(s: number): number {
    return Math.min(GIFT_PREVIEW_MAX_SCALE, Math.max(GIFT_PREVIEW_MIN_SCALE, s));
}

/** The scale that shows the whole drawing in a box (with a small margin). */
export function giftPreviewFit(model: Pick<GiftPreviewModel, 'width' | 'height'>, boxW: number, boxH: number): number {
    if (!model.width || !model.height || boxW <= 0 || boxH <= 0) return 1;
    return clampScale(Math.min(boxW / model.width, boxH / model.height, 1));
}

/** The recipient's card centre in the drawing (the anchor of the view). */
function anchorOf(model: GiftPreviewModel): { x: number; y: number } {
    const me = model.cards.find(c => c.recipient) ?? model.cards[0];
    return me ? { x: me.x + CW / 2, y: me.y + CH / 2 } : { x: model.width / 2, y: model.height / 2 };
}

/** The view showing the whole drawing at `scale`, centred in the box. */
function centredView(model: GiftPreviewModel, scale: number, boxW: number, boxH: number): GiftPreviewView {
    const a = anchorOf(model);
    return {
        scale,
        ax: (boxW - model.width * scale) / 2 + a.x * scale,
        ay: (boxH - model.height * scale) / 2 + a.y * scale,
    };
}

/** The view at the same scale with a card in the middle of the box ("Centre the preview here"). */
export function giftPreviewCentreOn(model: GiftPreviewModel, view: GiftPreviewView, id: PersonId, boxW: number, boxH: number): GiftPreviewView {
    const c = model.cards.find(x => x.id === id);
    if (!c) return view;
    const a = anchorOf(model);
    return { scale: view.scale, ax: boxW / 2 - (c.x + CW / 2 - a.x) * view.scale, ay: boxH / 2 - (c.y + CH / 2 - a.y) * view.scale };
}

/** The first view: all of it when it fits at FIRST_MIN_SCALE or more, else that scale around the recipient. */
export function giftPreviewFirstView(model: GiftPreviewModel, boxW: number, boxH: number, still = false): GiftPreviewView {
    const fit = giftPreviewFit(model, boxW, boxH);
    const min = still ? STILL_MIN_SCALE : FIRST_MIN_SCALE;
    if (fit >= min) return centredView(model, fit, boxW, boxH);
    return { scale: min, ax: boxW / 2, ay: Math.round(boxH * 0.62) };
}

/** Draw the preview into `host` (emptied) and return a function that drops its window listeners. */
export function renderGiftPreview(host: HTMLElement, o: GiftPreviewOptions): () => void {
    const { model } = o;
    host.replaceChildren();
    host.classList.add('gift-prev');
    host.classList.toggle('is-still', !!o.still);

    const stage = document.createElement('div');
    stage.className = 'gift-prev-stage';
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', o.label);
    if (!o.still) stage.tabIndex = 0;
    const canvas = document.createElement('div');
    canvas.className = 'gift-prev-canvas';
    canvas.style.width = `${model.width}px`;
    canvas.style.height = `${model.height}px`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'gift-prev-lines');
    svg.setAttribute('width', String(model.width));
    svg.setAttribute('height', String(model.height));
    svg.setAttribute('aria-hidden', 'true');
    const d = model.lines.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
    if (d) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    canvas.appendChild(svg);

    for (const c of model.cards) {
        const info = o.card(c.id);
        const card = document.createElement('div');
        card.className = 'gift-mc' + (c.recipient ? ' is-me' : '');
        card.dataset.id = c.id;
        card.style.left = `${c.x}px`;
        card.style.top = `${c.y}px`;
        const av = document.createElement('span');
        av.className = 'gift-mc-a' + (info.female ? ' is-f' : '');
        av.textContent = info.initials;
        av.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'gift-mc-t';
        const nm = document.createElement('span');
        nm.className = 'gift-mc-n';
        nm.textContent = info.name;
        text.appendChild(nm);
        if (info.years) {
            const yr = document.createElement('span');
            yr.className = 'gift-mc-y';
            yr.textContent = info.years;
            text.appendChild(yr);
        }
        card.title = info.years ? `${info.name}, ${info.years}` : info.name;
        card.append(av, text);
        canvas.appendChild(card);
    }
    for (const s of model.stubs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `gift-stub is-${s.stub.kind}`;
        b.dataset.stub = s.stub.key;
        b.style.left = `${s.x}px`;
        b.style.top = `${s.y}px`;
        b.style.width = `${s.w}px`;
        b.textContent = s.label;
        const title = o.stubTitle?.(s.stub);
        if (title) b.setAttribute('aria-label', title);
        if (o.still) b.tabIndex = -1;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (moved) return;
            o.onStub(s.stub);
        });
        canvas.appendChild(b);
    }
    stage.appendChild(canvas);

    const top = document.createElement('div');
    top.className = 'gift-prev-top';
    top.innerHTML = o.topHtml;
    host.append(stage, top);

    // The view: from the caller, or the first one for this box.
    const boxW = (): number => stage.clientWidth || host.clientWidth || 560;
    const boxH = (): number => stage.clientHeight || host.clientHeight || 520;
    let view: GiftPreviewView = o.view ?? giftPreviewFirstView(model, boxW(), boxH(), o.still);
    const anchor = anchorOf(model);
    let label: HTMLElement | null = null;
    const apply = (): void => {
        const tx = view.ax - anchor.x * view.scale;
        const ty = view.ay - anchor.y * view.scale;
        canvas.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${view.scale})`;
        if (label) label.textContent = `${Math.round(view.scale * 100)} %`;
    };
    const set = (next: GiftPreviewView): void => {
        view = next;
        apply();
        o.onView(view);
    };
    /** Zoom by `k` around a point of the box. */
    const zoomAt = (k: number, px: number, py: number): void => {
        const scale = clampScale(view.scale * k);
        const f = scale / view.scale;
        set({ scale, ax: px + (view.ax - px) * f, ay: py + (view.ay - py) * f });
    };

    if (!o.still) {
        const zoom = document.createElement('div');
        zoom.className = 'gift-prev-zoom';
        const zb = (text: string, aria: string, cls: string, run: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = cls;
            b.textContent = text;
            b.setAttribute('aria-label', aria);
            b.addEventListener('click', run);
            return b;
        };
        label = document.createElement('span');
        label.className = 'gift-prev-pct';
        label.setAttribute('aria-live', 'polite');
        zoom.append(
            zb('−', o.texts.zoomOut, 'gift-prev-zb', () => zoomAt(1 / 1.25, boxW() / 2, boxH() / 2)),
            label,
            zb('+', o.texts.zoomIn, 'gift-prev-zb', () => zoomAt(1.25, boxW() / 2, boxH() / 2)),
            zb(o.texts.fit, o.texts.fitLabel, 'gift-prev-zb is-w', () => {
                set(centredView(model, giftPreviewFit(model, boxW(), boxH()), boxW(), boxH()));
            }),
        );
        host.appendChild(zoom);
    }
    apply();
    if (!o.view) o.onView(view);

    // Moving: one pointer drags, two pointers pinch; the wheel pans, with Ctrl/⌘ it zooms.
    let moved = false;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; view: GiftPreviewView } | null = null;
    let pinch: { dist: number; mx: number; my: number; view: GiftPreviewView } | null = null;
    const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
        const r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pinchOf = (): { dist: number; mx: number; my: number } => {
        const [a, b] = [...pointers.values()];
        return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    if (!o.still) {
        stage.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            pointers.set(e.pointerId, local(e));
            if (pointers.size === 1) { moved = false; start = { ...local(e), view }; pinch = null; }
            else if (pointers.size === 2) { moved = true; pinch = { ...pinchOf(), view }; start = null; }
        });
        stage.addEventListener('pointermove', (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, local(e));
            if (pinch && pointers.size >= 2) {
                const p = pinchOf();
                const scale = clampScale(pinch.view.scale * p.dist / pinch.dist);
                const f = scale / pinch.view.scale;
                set({ scale, ax: p.mx + (pinch.view.ax - pinch.mx) * f, ay: p.my + (pinch.view.ay - pinch.my) * f });
                return;
            }
            if (!start) return;
            const p = local(e);
            const dx = p.x - start.x, dy = p.y - start.y;
            if (!moved && Math.hypot(dx, dy) < DRAG_FROM) return;
            if (!moved) {
                moved = true;
                try { stage.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
                stage.classList.add('is-dragging');
            }
            set({ scale: start.view.scale, ax: start.view.ax + dx, ay: start.view.ay + dy });
        });
        const end = (e: PointerEvent): void => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinch = null;
            if (pointers.size === 0) { start = null; stage.classList.remove('is-dragging'); }
        };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', end);
        stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? boxH() : 1;
            if (e.ctrlKey || e.metaKey) {
                const p = local(e);
                zoomAt(Math.exp(-e.deltaY * unit * 0.0025), p.x, p.y);
            } else {
                set({ scale: view.scale, ax: view.ax - e.deltaX * unit, ay: view.ay - e.deltaY * unit });
            }
        }, { passive: false });
        stage.addEventListener('keydown', (e) => {
            if (e.target !== stage) return;
            const step = 40;
            const k: Record<string, [number, number]> = {
                ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
            };
            if (k[e.key]) {
                e.preventDefault();
                set({ scale: view.scale, ax: view.ax + k[e.key][0], ay: view.ay + k[e.key][1] });
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                zoomAt(1.25, boxW() / 2, boxH() / 2);
            } else if (e.key === '-') {
                e.preventDefault();
                zoomAt(1 / 1.25, boxW() / 2, boxH() / 2);
            }
        });
    }

    // A card's menu (a click, not the end of a drag).
    let closeMenu: (() => void) | null = null;
    if (o.menu && !o.still) {
        stage.addEventListener('click', (e) => {
            if (moved) { moved = false; return; }
            const card = (e.target as Element).closest<HTMLElement>('.gift-mc');
            if (!card?.dataset.id) return;
            const spec = o.menu!(card.dataset.id as PersonId);
            if (!spec || !spec.items.length) return;
            closeMenu?.();
            closeMenu = openMenu(spec.title, spec.items, { x: e.clientX, y: e.clientY }, card, (focusBack) => {
                closeMenu = null;
                o.onMenu?.(null);
                if (focusBack) stage.focus({ preventScroll: true });
            });
            o.onMenu?.(() => closeMenu?.());
        });
    }

    return () => { closeMenu?.(); };
}

/**
 * A small menu by the cursor (`.context-menu`): arrows move, Enter runs,
 * Escape or a press outside closes it. Returns its closer.
 */
function openMenu(
    title: string, items: GiftPreviewMenuItem[], at: { x: number; y: number }, card: HTMLElement,
    onClose: (focusBack: boolean) => void,
): () => void {
    const menu = document.createElement('div');
    menu.className = 'context-menu gift-cm';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', title);
    const head = document.createElement('div');
    head.className = 'context-menu-header gift-cm-h';
    head.setAttribute('role', 'presentation');
    head.textContent = title;
    menu.appendChild(head);
    const rows = items.map((it, i) => {
        const row = document.createElement('div');
        row.className = 'context-menu-item';
        row.setAttribute('role', 'menuitem');
        row.tabIndex = -1;
        row.dataset.i = String(i);
        row.textContent = it.label;
        menu.appendChild(row);
        return row;
    });
    // Inside the dialog's overlay (above its window), else the page.
    (card.closest('.modal-overlay') ?? document.body).appendChild(menu);
    const M = 8, w = menu.offsetWidth, h = menu.offsetHeight;
    const r = card.getBoundingClientRect();
    const px = at.x || r.left + r.width / 2, py = at.y || r.bottom;
    let x = px + 10, y = py + 10;
    if (x + w > window.innerWidth - M) x = Math.max(M, px - w - 10);
    if (y + h > window.innerHeight - M) y = Math.max(M, py - h - 10);
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;

    let open = true;
    const close = (focusBack: boolean): void => {
        if (!open) return;
        open = false;
        window.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('resize', onAway);
        window.removeEventListener('blur', onAway);
        menu.remove();
        onClose(focusBack);
    };
    const run = (row: HTMLElement): void => {
        const it = items[Number(row.dataset.i)];
        close(false);
        it.run();
    };
    menu.addEventListener('click', (e) => {
        const row = (e.target as Element).closest<HTMLElement>('[role="menuitem"]');
        if (row) run(row);
    });
    const onKey = (e: KeyboardEvent): void => {
        const i = rows.indexOf(document.activeElement as HTMLDivElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
        if (e.key === 'Tab') { e.preventDefault(); close(true); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
            e.preventDefault(); e.stopPropagation();
            const n = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
                : (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
            rows[n]?.focus();
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); e.stopPropagation(); run(rows[i]); }
    };
    const onDown = (e: PointerEvent): void => { if (!menu.contains(e.target as Node)) close(false); };
    const onAway = (): void => close(false);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    rows[0]?.focus({ preventScroll: true });
    return () => close(true);
}
