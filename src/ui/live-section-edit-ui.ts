/**
 * Customize panel: the ⋯ of the small panel and of the overview, the popover
 * (a bottom sheet on a phone) with a three-way choice per section, a section's
 * own menu on its heading (right click, a long press, the Menu key or
 * Shift+F10) and the "Following research" group in Settings. All three make
 * the same lasting choice (live-section-prefs.ts); what they show is in
 * live-section-edit.ts.
 */

import { strings } from '../strings.js';
import { isMobile, isPhoneBar } from '../breakpoints.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { PersonPicker } from '../person-picker.js';
import { shownNameFull } from '../person-name.js';
import {
    FAN_CENTER_SETTINGS, FOLLOW_VIEWS, FanCenterSetting, FollowView, fanPersonOtherTree, getFanCenterSetting, getFanPerson,
    getFollowTrail, getFollowView, hasFollowPrefs, setFanCenterSetting, setFanPerson, setFollowTrail, setFollowView,
    getLiveMotion, setLiveMotion,
} from '../live-follow-prefs.js';
import { PersonId, TreeId } from '../types.js';
import { uiModule } from './module.js';
import type { UIClass } from './index.js';
import { el, livePanelSectionState } from './research-ui.js';
import { overviewSectionState } from './research-overview-ui.js';
import {
    PANEL_PREF_KEYS, PrefKey, SectionPref, hasSectionPrefs, movedOrder, overviewKeyOf, sectionOrder, sectionPrefs,
    setSectionOrder, setSectionPref, setTopPref, setTopTile, topPrefs,
} from './live-section-prefs.js';
import {
    EditSurface, SECTION_STATES, SectionEditRow, SectionNow, droppedOrder, movedNote, sectionDefaultNote, sectionEditRows,
    sectionMenuHead, sectionMoves, sectionStateLabel, sectionTitle, segmentArrowTarget, topEditRows,
} from './live-section-edit.js';

type Surface = 'panel' | 'overview';
type At = { x: number; y: number } | null;

/** A press this long on a heading (touch, pen) opens its menu. */
const LONG_PRESS_MS = 500;
/** A finger moving further than this is a scroll, not a long press. */
const MOVE_CANCEL_PX = 8;
/** A bottom sheet dragged down this far closes. */
const SWIPE_CLOSE_PX = 80;

interface OpenLayer {
    surface: Surface;
    /** What is appended to the body (the popover itself, or the sheet's backdrop). */
    root: HTMLElement;
    /** The dialog or the menu. */
    box: HTMLElement;
    sheet: boolean;
    cleanup: () => void;
}
interface Editor extends OpenLayer { anchor: HTMLElement; body: HTMLElement }
interface Menu extends OpenLayer { key: PrefKey; head: HTMLElement; at: At }

let editor: Editor | null = null;
let menu: Menu | null = null;
let syncQueued = false;

/** The release (and the click) of a long press that opened a menu does not fold the section too. */
let swallowClickUntil = 0;

/** Whether this click on a heading ends a long press (taken: asked once per click). */
export function sectionClickSwallowed(): boolean {
    if (swallowClickUntil === 0) return false;
    const on = Date.now() <= swallowClickUntil;
    swallowClickUntil = 0;
    return on;
}

/**
 * A section heading opens its menu: right click at the pointer, a long press
 * (not a mouse; cancelled by a release, a move, leaving) at the finger, the
 * Menu key or Shift+F10 under the heading.
 */
export function bindSectionMenu(head: HTMLElement, open: (head: HTMLElement, at: At) => void): void {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let fired = false;
    let keyOpenedAt = 0;
    const cancel = (): void => {
        if (timer) clearTimeout(timer);
        timer = 0;
        start = null;
    };
    const fire = (at: { x: number; y: number }): void => {
        cancel();
        fired = true;
        swallowClickUntil = Number.POSITIVE_INFINITY;
        open(head, at);
    };
    head.addEventListener('pointerdown', (e) => {
        fired = false;
        cancel();
        if (e.pointerType === 'mouse' || e.button !== 0) return;
        const at = { x: e.clientX, y: e.clientY };
        start = at;
        timer = window.setTimeout(() => fire(at), LONG_PRESS_MS);
    });
    head.addEventListener('pointermove', (e) => {
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_CANCEL_PX) cancel();
    });
    const end = (): void => {
        cancel();
        if (fired) swallowClickUntil = Date.now() + 700;
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('pointerleave', end);
    head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // A touch browser's own long press: the same menu, once.
        if (timer && start) {
            fire(start);
            return;
        }
        if (fired || Date.now() - keyOpenedAt < 400) return;
        // From the keyboard a browser reports no pointer: under the heading.
        const pointer = e.clientX !== 0 || e.clientY !== 0;
        open(head, pointer ? { x: e.clientX, y: e.clientY } : null);
    });
    head.addEventListener('keydown', (e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            e.stopPropagation();
            keyOpenedAt = Date.now();
            open(head, null);
        }
    });
}

/** How a section shows now on a surface (the two the overview alone has: as there). */
function nowOf(surface: Surface): (key: PrefKey) => SectionNow {
    return (key) => {
        if (surface === 'panel' && (PANEL_PREF_KEYS as readonly string[]).includes(key)) {
            return livePanelSectionState(key as 'working' | 'waiting' | 'changes' | 'queue');
        }
        return { current: overviewSectionState(overviewKeyOf(key)), autoFolded: false };
    };
}

function surfaceRoot(surface: Surface): HTMLElement | null {
    return document.getElementById(surface === 'panel' ? 'live-panel' : 'research-overview');
}

/** The ⋯ of a surface (a redraw makes a new one). */
function findMore(surface: Surface): HTMLElement | null {
    return surfaceRoot(surface)?.querySelector<HTMLElement>('.live-sec-more') ?? null;
}

/** A section's heading on a surface, if it is drawn. */
function findHead(surface: Surface, key: PrefKey): HTMLElement | null {
    const id = surface === 'panel' ? `live-sec-${key}` : `ov-sec-${overviewKeyOf(key)}`;
    return surfaceRoot(surface)?.querySelector<HTMLElement>(`[aria-controls="${id}"]`) ?? null;
}

function focusables(box: HTMLElement): HTMLElement[] {
    return [...box.querySelectorAll<HTMLElement>('button, [tabindex="0"], [tabindex="-1"][role="menuitemradio"], [role="menuitem"]')]
        .filter(x => x.tabIndex >= 0 && !x.hidden && x.offsetParent !== null);
}

/** Tab stays inside an open dialog. */
function trapTab(box: HTMLElement, e: KeyboardEvent): void {
    const list = focusables(box);
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
    list[next].focus();
}

/** Where the focus was in a container (section and state), to find it again after a redraw. */
function focusMark(host: HTMLElement): { key?: string; value?: string; reset: boolean } | null {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !host.contains(a)) return null;
    return {
        key: a.closest<HTMLElement>('[data-key]')?.dataset.key,
        value: a.dataset.value,
        reset: a.classList.contains('live-sec-reset'),
    };
}

/** Focus found again; a move button at the end of the list (now unusable) hands it to the other one. */
function refocus(host: HTMLElement, mark: ReturnType<typeof focusMark>): void {
    if (!mark) return;
    let target = mark.reset
        ? host.querySelector<HTMLElement>('.live-sec-reset')
        : host.querySelector<HTMLElement>(`[data-key="${mark.key}"] [data-value="${mark.value}"]`);
    if (target?.classList.contains('live-sec-edit__move') && target.getAttribute('aria-disabled') === 'true') {
        const other = target.parentElement?.querySelector<HTMLElement>('.live-sec-edit__move[aria-disabled="false"]');
        if (other) target = other;
    }
    target?.focus({ preventScroll: true });
}

/**
 * One section's three-way segment: radios with a roving tab stop, the stored
 * choice checked, a section without one shows its present state dashed.
 * An arrow moves and chooses at once (with Alt: the row moves instead).
 */
function segment(row: SectionEditRow, labelId: string, cls: string): HTMLElement {
    const seg = el('div', `live-sec-seg ${cls}`);
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-labelledby', labelId);
    const stop = row.chosen ?? row.current ?? 'expanded';
    const pick = (v: SectionPref): void => {
        if (sectionPrefs()[row.key] !== v) setSectionPref(row.key, v);
    };
    SECTION_STATES.forEach((v, i) => {
        const b = el('button', 'live-sec-seg__opt', sectionStateLabel(v));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(row.chosen === v));
        b.tabIndex = v === stop ? 0 : -1;
        b.dataset.value = v;
        if (!row.chosen && row.current === v) b.classList.add('is-current');
        b.onclick = () => pick(v);
        b.onkeydown = (e) => {
            if (e.altKey) return;
            const t = segmentArrowTarget(e.key, i, SECTION_STATES.length);
            if (t === null) return;
            e.preventDefault();
            // Focus first: the redraw that follows keeps it on the same state.
            (seg.children[t] as HTMLElement).focus();
            pick(SECTION_STATES[t]);
        };
        seg.appendChild(b);
    });
    return seg;
}

/** Where the choices are drawn: the popover, a phone's bottom sheet, Settings (all on one line). */
type EditMode = 'popover' | 'sheet' | 'settings';

/** How long a moved section stays lit in the panel and the overview. */
const MOVED_MS = 1500;
let moved: { key: PrefKey; until: number } | null = null;
let movedTimer = 0;

/** A section was moved: lit where it is drawn for a while (the redraw that follows asks `sectionMovedNow`). */
function noteSectionMoved(key: PrefKey): void {
    moved = { key, until: Date.now() + MOVED_MS };
    if (movedTimer) clearTimeout(movedTimer);
    movedTimer = window.setTimeout(() => {
        moved = null;
        movedTimer = 0;
        document.querySelectorAll('.live-section__head.is-moved, .live-section__body.is-moved').forEach(n => n.classList.remove('is-moved'));
    }, MOVED_MS);
}

/** Whether the section drawn with this body id has just moved (the panel's `live-sec-*`, the overview's `ov-sec-*`). */
export function sectionMovedNow(id: string): boolean {
    if (!moved || Date.now() > moved.until) return false;
    return id === `live-sec-${moved.key}` || id === `ov-sec-${overviewKeyOf(moved.key)}`;
}

/** The polite region of a container (the popover, Settings' group): created once, kept across redraws. */
function srRegion(host: HTMLElement): HTMLElement {
    let r = host.querySelector<HTMLElement>(':scope > .live-sec-edit__sr');
    if (!r) {
        r = el('div', 'live-sec-edit__sr');
        r.setAttribute('aria-live', 'polite');
        r.setAttribute('role', 'status');
        host.appendChild(r);
    }
    return r;
}

/** Keep a new order (lit in the open panel and overview); a move in the editor or Settings is said to a screen reader. */
function moveSectionTo(order: readonly PrefKey[], key: PrefKey, surface: EditSurface, from: HTMLElement | null): void {
    const before = sectionOrder();
    if (order.length === before.length && order.every((k, i) => k === before[i])) return;
    // Found before the redraw: the row is drawn again (Settings draws its whole group again).
    const host = from?.closest<HTMLElement>('.live-sec-edit, #settings-group-research-follow') ?? null;
    noteSectionMoved(key);
    setSectionOrder(order);
    if (!host?.isConnected) return;
    const region = srRegion(host);
    const text = movedNote(surface, sectionOrder(), key);
    region.textContent = '';
    setTimeout(() => { region.textContent = text; }, 30);
}

/** A drag of a row by its grip is on: the list is not drawn again under it. */
let dragging = false;

/**
 * Drag a row by its grip (mouse, finger, pen): the row lifts, a line shows
 * where it lands, the release keeps the new order; Escape cancels.
 */
function bindDrag(grip: HTMLElement, line: HTMLElement, surface: EditSurface): void {
    grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || dragging) return;
        const list = line.parentElement;
        if (!list) return;
        e.preventDefault();
        const rows = [...list.querySelectorAll<HTMLElement>(':scope > .live-sec-edit__row')];
        const from = rows.indexOf(line);
        const key = line.dataset.key as PrefKey;
        const others = rows.filter(r => r !== line);
        const mids = others.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
        const startY = e.clientY;
        let at = from;
        dragging = true;
        try { grip.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
        line.classList.add('is-dragging');
        const mark = (): void => {
            others.forEach(r => r.classList.remove('is-drop-before', 'is-drop-after'));
            if (at === from) return;
            if (at < others.length) others[at].classList.add('is-drop-before');
            else others[others.length - 1]?.classList.add('is-drop-after');
        };
        const move = (ev: PointerEvent): void => {
            line.style.transform = `translateY(${Math.round(ev.clientY - startY)}px)`;
            at = mids.filter(m => ev.clientY > m).length;
            mark();
        };
        const end = (keep: boolean): void => {
            if (!dragging) return;
            dragging = false;
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', up);
            grip.removeEventListener('pointercancel', cancel);
            grip.removeEventListener('lostpointercapture', cancel);
            window.removeEventListener('keydown', onKey, true);
            line.classList.remove('is-dragging');
            line.style.transform = '';
            at = keep ? at : from;
            mark();
            if (keep && at !== from) moveSectionTo(droppedOrder(sectionOrder(), key, at), key, surface, line);
        };
        const up = (): void => end(true);
        const cancel = (): void => end(false);
        // Escape ends the drag only (before the popover's own Escape).
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            end(false);
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', cancel);
        grip.addEventListener('lostpointercapture', cancel);
        window.addEventListener('keydown', onKey, true);
    });
}

/**
 * A section's row: the grip (not on a phone), its name (with "hidden" when
 * hidden) and note, ↑ ↓, and the segment; in the popover and the sheet the
 * segment goes under the name, in Settings all on one line.
 */
function sectionRow(row: SectionEditRow, i: number, count: number, surface: EditSurface, mode: EditMode): HTMLElement {
    const L = strings.live;
    const hidden = row.chosen === 'hidden';
    const line = el('div', `live-sec-edit__row${hidden ? ' is-hidden' : ''}`);
    line.setAttribute('role', 'listitem');
    line.dataset.key = row.key;
    if (mode !== 'sheet') {
        const grip = el('span', 'live-sec-edit__grip', '⠿');
        grip.setAttribute('aria-hidden', 'true');
        bindDrag(grip, line, surface);
        line.appendChild(grip);
    }
    const text = el('div', 'live-sec-edit__text');
    const name = el('span', 'live-sec-edit__name');
    const label = el('span', 'live-sec-edit__label', row.label);
    label.id = `live-sec-${mode}-l-${row.key}`;
    name.appendChild(label);
    if (hidden) name.appendChild(el('span', 'live-sec-edit__tag', L.hiddenTag));
    text.appendChild(name);
    if (row.note) text.appendChild(el('span', 'live-sec-edit__note', row.note));
    const moves = el('div', 'live-sec-edit__moves');
    const go = (dir: -1 | 1): void => moveSectionTo(movedOrder(sectionOrder(), row.key, dir, 'settings'), row.key, surface, line);
    for (const dir of [-1, 1] as const) {
        const edge = dir < 0 ? i === 0 : i === count - 1;
        const b = el('button', 'live-sec-edit__move', dir < 0 ? '↑' : '↓');
        b.type = 'button';
        b.dataset.value = dir < 0 ? 'up' : 'down';
        b.title = dir < 0 ? L.moveUp : L.moveDown;
        b.setAttribute('aria-label', (dir < 0 ? L.moveUpAria : L.moveDownAria)(row.label));
        b.setAttribute('aria-disabled', String(edge));
        b.onclick = () => { if (!edge) go(dir); };
        moves.appendChild(b);
    }
    const seg = segment(row, label.id, mode === 'settings' ? 'live-sec-seg--settings' : 'live-sec-seg--edit');
    // The order of the focus follows what is seen; in Settings the segment and ↑ ↓ keep together (beside the name, or under it when short of room).
    if (mode === 'settings') {
        const ctl = el('div', 'live-sec-edit__ctl');
        ctl.append(seg, moves);
        line.append(text, ctl);
    } else {
        line.append(text, moves, seg);
    }
    // Alt+↑ / Alt+↓ anywhere in the row moves it; the focus stays where it was.
    line.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (dir < 0 ? i > 0 : i < count - 1) go(dir);
    });
    return line;
}

/** The card "Sections and order": every section in the sections' order, in one list. */
function sectionsCard(surface: EditSurface, mode: EditMode, now: (key: PrefKey) => SectionNow): HTMLElement {
    const L = strings.live;
    const card = el('div', 'live-sec-card live-sec-card--sections');
    const title = el('div', 'live-sec-card__title', L.groupSections);
    title.id = `live-sec-${mode}-sections`;
    const list = el('div', 'live-sec-edit__list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-labelledby', title.id);
    const rows = sectionEditRows(surface, sectionPrefs(), now);
    rows.forEach((row, i) => list.appendChild(sectionRow(row, i, rows.length, surface, mode)));
    card.append(title, list);
    return card;
}

/** This month is not shown in the overview's phone sheet (nor on a phone at all): its row says so there. */
function monthOffHere(surface: EditSurface): boolean {
    if (surface === 'overview') return isPhoneBar();
    return surface === 'settings' && isMobile();
}

/**
 * The card "At the top": the state (always shown), Last 24 h and This month
 * with a switch and their parts, "Follow in".
 */
function topCard(surface: EditSurface, mode: EditMode): HTMLElement {
    const L = strings.live;
    const card = el('div', 'live-sec-card live-sec-card--top');
    const title = el('div', 'live-sec-card__title', L.groupTop);
    title.id = `live-sec-${mode}-top`;
    card.appendChild(title);
    for (const t of topEditRows(topPrefs(), { phone: monthOffHere(surface), long: mode === 'settings' })) {
        const line = el('div', `live-sec-top__row${t.disabled ? ' is-disabled' : ''}`);
        line.dataset.key = `top-${t.key}`;
        const main = el('div', 'live-sec-top__main');
        const text = el('span', 'live-sec-top__text');
        const label = el('span', 'live-sec-top__label', t.label);
        label.id = `live-sec-${mode}-t-${t.key}`;
        text.appendChild(label);
        let helpId: string | null = null;
        if (t.help) {
            const help = el('span', 'live-sec-top__help', t.help);
            helpId = `live-sec-${mode}-th-${t.key}`;
            help.id = helpId;
            text.appendChild(help);
        }
        main.appendChild(text);
        if (t.locked) {
            main.appendChild(el('span', 'live-sec-top__lock', L.alwaysShown));
        } else {
            const sw = el('button', 'live-sec-switch');
            sw.type = 'button';
            sw.setAttribute('role', 'switch');
            sw.setAttribute('aria-checked', String(t.on));
            sw.setAttribute('aria-labelledby', label.id);
            if (helpId) sw.setAttribute('aria-describedby', helpId);
            sw.setAttribute('aria-disabled', String(t.disabled));
            sw.dataset.value = 'switch';
            sw.appendChild(el('span', 'live-sec-switch__knob'));
            sw.onclick = () => {
                if (t.disabled) return;
                if (t.key === 'followIn') setTopPref('followIn', !t.on);
                else if (t.key === 'day' || t.key === 'month') setTopTile(t.key, !t.on);
            };
            main.appendChild(sw);
        }
        line.appendChild(main);
        if (t.parts.length > 0) {
            const parts = el('div', 'live-sec-top__parts');
            parts.setAttribute('role', 'group');
            parts.setAttribute('aria-labelledby', label.id);
            for (const p of t.parts) {
                const chip = el('button', 'live-sec-chip');
                chip.type = 'button';
                chip.setAttribute('role', 'checkbox');
                chip.setAttribute('aria-checked', String(p.on));
                chip.setAttribute('aria-disabled', String(p.disabled));
                chip.dataset.value = p.key;
                const box = el('span', 'live-sec-chip__box', p.on ? '✓' : '');
                box.setAttribute('aria-hidden', 'true');
                chip.append(box, el('span', 'live-sec-chip__label', p.label));
                chip.onclick = () => { if (!p.disabled) setTopPref(p.key, !p.on); };
                parts.appendChild(chip);
            }
            line.appendChild(parts);
        }
        card.appendChild(line);
    }
    return card;
}

/** The editor's body (popover and sheet): both cards, then Restore defaults and the way to Settings. */
function fillEditorBody(body: HTMLElement, surface: Surface, sheet: boolean, foot: HTMLElement): void {
    if (dragging) return;
    const mark = focusMark(body);
    const mode: EditMode = sheet ? 'sheet' : 'popover';
    body.replaceChildren(sectionsCard(surface, mode, nowOf(surface)), topCard(surface, mode), foot);
    refocus(body, mark);
}

/** `withFollow`: Settings, whose Restore defaults also takes the choices of following (view, fan centre, trail). */
function syncReset(reset: HTMLElement, withFollow = false): void {
    reset.setAttribute('aria-disabled', String(!(hasSectionPrefs() || (withFollow && hasFollowPrefs()))));
}

/** The picker of Settings' chosen fan centre (one at a time; gone with the next drawing). */
let fanPersonPicker: PersonPicker | null = null;
/** The settings follow the system's reduced motion (one listener). */
let motionMediaWatched = false;

/**
 * A choice of Settings › Following research as a segment: radios with a
 * roving tab stop, an arrow moves and chooses at once.
 */
function choiceSegment<T extends string>(labelId: string, options: ReadonlyArray<{ value: T; label: string }>, chosen: T, pick: (v: T) => void, wide = false): HTMLElement {
    const seg = el('div', `live-sec-seg live-sec-seg--settings${wide ? ' live-sec-seg--wide' : ''}`);
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-labelledby', labelId);
    options.forEach((o, i) => {
        const b = el('button', 'live-sec-seg__opt', o.label);
        b.type = 'button';
        b.title = o.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.value === chosen));
        b.tabIndex = o.value === chosen ? 0 : -1;
        b.dataset.value = o.value;
        b.onclick = () => { if (o.value !== chosen) pick(o.value); };
        b.onkeydown = (e) => {
            const t = segmentArrowTarget(e.key, i, options.length);
            if (t === null) return;
            e.preventDefault();
            (seg.children[t] as HTMLElement).focus();
            if (options[t].value !== chosen) pick(options[t].value);
        };
        seg.appendChild(b);
    });
    return seg;
}

/** A row of the group: the name and a hint on the left, the control on the right. */
function settingsLine(key: string, name: string, desc: string | null, control: HTMLElement | null): { line: HTMLElement; labelId: string } {
    const line = el('div', 'settings-row live-sec-set__row');
    line.dataset.key = key;
    const text = el('span', 'settings-text');
    const label = el('span', 'settings-name', name);
    label.id = `live-sec-set-l-${key}`;
    text.appendChild(label);
    if (desc) text.appendChild(el('span', 'settings-desc', desc));
    line.appendChild(text);
    if (control) line.appendChild(control);
    return { line, labelId: label.id };
}

/** A sheet's handle and title row (× or Done closes); dragging either down closes it. */
function sheetHead(box: HTMLElement, title: string, close: () => void, done?: string): HTMLElement {
    const handle = el('span', 'live-sec-sheet__handle');
    handle.setAttribute('aria-hidden', 'true');
    const head = el('div', 'live-sec-sheet__head');
    head.appendChild(el('span', 'live-sec-sheet__title', title));
    if (done) {
        const b = el('button', 'live-sec-sheet__done', done);
        b.type = 'button';
        b.onclick = close;
        head.appendChild(b);
    } else {
        const x = el('button', 'live-sec-sheet__close', '×');
        x.type = 'button';
        x.setAttribute('aria-label', strings.research.close);
        x.title = strings.research.close;
        x.onclick = close;
        head.appendChild(x);
    }
    box.append(handle, head);
    let from: number | null = null;
    let dy = 0;
    const down = (e: PointerEvent): void => {
        if ((e.target as HTMLElement).closest('button')) return;
        from = e.clientY;
        dy = 0;
        box.style.transition = 'none';
    };
    const move = (e: PointerEvent): void => {
        if (from === null) return;
        dy = Math.max(0, e.clientY - from);
        box.style.transform = dy ? `translateY(${dy}px)` : '';
    };
    const up = (): void => {
        if (from === null) return;
        from = null;
        box.style.transition = '';
        if (dy > SWIPE_CLOSE_PX) close();
        else box.style.transform = '';
    };
    for (const part of [handle, head]) {
        part.addEventListener('pointerdown', down);
        part.addEventListener('pointermove', move);
        part.addEventListener('pointerup', up);
        part.addEventListener('pointercancel', up);
    }
    // A drag on the head is the sheet's, not the page's scroll.
    handle.style.touchAction = 'none';
    head.style.touchAction = 'none';
    return head;
}

/** A backdrop holding a bottom sheet; a tap on it closes. */
function sheetOverlay(box: HTMLElement, close: () => void): HTMLElement {
    const overlay = el('div', 'live-sec-sheet-overlay');
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    return overlay;
}

/** The popover under its ⋯: right edges aligned, 6px below, at least 8px from the window's edge. */
function placePopover(box: HTMLElement, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(320, vw - 16);
    box.style.width = `${w}px`;
    box.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, vw - w - 8)))}px`;
    // At most the window less 96px; the head stays, the rest scrolls.
    const most = Math.max(120, vh - 96);
    const below = vh - r.bottom - 6 - 12;
    if (below >= 220 || below >= r.top - 18) {
        box.style.top = `${Math.round(r.bottom + 6)}px`;
        box.style.bottom = '';
        box.style.maxHeight = `${Math.min(most, Math.max(120, Math.round(below)))}px`;
    } else {
        // An anchor low in the window (the way back under "All sections are hidden"): above it.
        box.style.top = '';
        box.style.bottom = `${Math.round(vh - r.top + 6)}px`;
        box.style.maxHeight = `${Math.min(most, Math.max(120, Math.round(r.top - 6 - 12)))}px`;
    }
}

/** A section menu at the pointer, or under its heading from the keyboard; kept inside the window. */
function placeMenu(box: HTMLElement, head: HTMLElement, at: At): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let x: number;
    let y: number;
    if (at) {
        x = at.x;
        y = at.y;
        if (y + h > vh - 8) y = Math.max(8, at.y - h);
    } else {
        const r = head.getBoundingClientRect();
        x = r.left + 8;
        y = r.bottom + 4;
        if (y + h > vh - 8) y = Math.max(8, r.top - h - 4);
    }
    box.style.left = `${Math.round(Math.max(8, Math.min(x, vw - w - 8)))}px`;
    box.style.top = `${Math.round(Math.max(8, y))}px`;
}

function syncMoreExpanded(): void {
    document.querySelectorAll<HTMLElement>('.live-sec-more').forEach((b) => {
        b.setAttribute('aria-expanded', String(!!editor && editor.surface === b.dataset.surface));
    });
}

/** Closes when Escape is pressed (focus back) or a press lands outside; Tab stays inside a dialog. */
function guard(layer: () => OpenLayer | null, close: (focusBack: boolean) => void, opts: { trap: boolean; ignore?: (t: HTMLElement) => boolean }): () => void {
    const onKey = (e: KeyboardEvent): void => {
        const l = layer();
        if (!l) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close(true);
        } else if (e.key === 'Tab' && opts.trap && l.box.contains(document.activeElement)) {
            trapTab(l.box, e);
        }
    };
    const onDown = (e: Event): void => {
        const l = layer();
        const t = e.target as HTMLElement;
        if (!l || l.root.contains(t) || opts.ignore?.(t)) return;
        close(true);
    };
    document.addEventListener('keydown', onKey, true);
    // Armed after the press that opened it.
    const arm = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    const onResize = (): void => {
        const l = layer();
        if (!l) return;
        // Across the phone's line the other form fits: closed, opened again by ⋯.
        if (l.sheet !== isPhoneBar()) close(false);
        else if (!l.sheet && editor && l === editor) placePopover(editor.box, editor.anchor);
    };
    window.addEventListener('resize', onResize);
    return () => {
        clearTimeout(arm);
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('resize', onResize);
    };
}

function syncMenuItems(m: Menu): void {
    const chosen = sectionPrefs()[m.key];
    m.box.querySelectorAll<HTMLElement>('[role="menuitemradio"]').forEach((item) => {
        const on = item.dataset.value === chosen;
        item.setAttribute('aria-checked', String(on));
        const check = item.querySelector('.live-sec-menu__check');
        if (check) check.textContent = on ? '✓' : '';
    });
    const st = nowOf(m.surface)(m.key);
    const headText = m.box.querySelector('.live-sec-menu__head');
    if (headText) headText.textContent = sectionMenuHead(sectionTitle(m.surface, m.key), chosen, st.autoFolded);
    const note = m.box.querySelector<HTMLElement>('.live-sec-menu__note');
    if (note) {
        note.textContent = sectionDefaultNote(chosen, st.autoFolded);
        note.hidden = !note.textContent;
    }
}

/** After a redraw (of the panel, the overview, the choices): the open editor and menu follow. */
function syncNow(ui: UIClass): void {
    const e = editor;
    if (e) {
        if (!e.anchor.isConnected) {
            const more = findMore(e.surface);
            if (more) e.anchor = more;
        }
        if (!e.anchor.isConnected || !surfaceRoot(e.surface)) {
            ui.closeLiveSectionEditor(false);
        } else {
            const foot = e.body.querySelector<HTMLElement>('.live-sec-edit__foot');
            if (foot) {
                fillEditorBody(e.body, e.surface, e.sheet, foot);
                const reset = foot.querySelector<HTMLElement>('.live-sec-reset');
                if (reset) syncReset(reset);
            }
        }
    }
    syncMoreExpanded();
    const m = menu;
    if (m) {
        if (!m.head.isConnected) {
            const head = findHead(m.surface, m.key);
            if (head) {
                m.head = head;
            }
        }
        if (!m.head.isConnected) {
            ui.closeLiveSectionMenu(false);
        } else {
            m.head.classList.add('is-menu-open');
            syncMenuItems(m);
        }
    }
}

export const liveSectionEditMethods = uiModule({
    /** The ⋯ that opens Customize panel (the small panel's head, the overview's). */
    liveSectionMoreButton(cls: string, surface: Surface): HTMLElement {
        const L = strings.live;
        const b = el('button', `${cls} live-sec-more`, '⋯');
        b.type = 'button';
        b.dataset.surface = surface;
        b.setAttribute('aria-label', L.editPanel);
        b.title = L.editPanel;
        b.setAttribute('aria-haspopup', 'dialog');
        b.setAttribute('aria-expanded', String(!!editor && editor.surface === surface));
        b.onclick = () => {
            if (editor && editor.surface === surface) this.closeLiveSectionEditor(true);
            else this.openLiveSectionEditor(b, surface);
        };
        return b;
    },

    /**
     * Customize panel: every section with its three states, Restore defaults
     * at the foot. A popover under ⋯; a bottom sheet on a phone.
     */
    openLiveSectionEditor(anchor: HTMLElement, surface: Surface): void {
        this.closeLiveSectionMenu(false);
        this.closeLiveSectionEditor(false);
        const L = strings.live;
        const sheet = isPhoneBar();
        const box = el('div', sheet ? 'live-sec-edit live-sec-edit--sheet live-sec-sheet' : 'live-sec-edit');
        box.id = 'live-sec-edit';
        box.dataset.surface = surface;
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', L.editPanel);
        const close = (): void => this.closeLiveSectionEditor(true);
        if (sheet) {
            sheetHead(box, L.editPanel, close, L.done);
        } else {
            const head = el('div', 'live-sec-edit__head');
            head.appendChild(el('span', 'live-sec-edit__title', L.editPanel));
            const x = el('button', 'live-sec-edit__close', '×');
            x.type = 'button';
            x.setAttribute('aria-label', strings.research.close);
            x.title = strings.research.close;
            x.onclick = close;
            head.appendChild(x);
            box.appendChild(head);
        }
        const body = el('div', 'live-sec-edit__body');
        const foot = el('div', 'live-sec-edit__foot');
        const reset = el('button', 'live-sec-reset live-sec-edit__reset', L.resetDefaults);
        reset.type = 'button';
        reset.onclick = () => {
            if (!hasSectionPrefs()) return;
            // The redraw first: focus goes back to the new ⋯.
            this.resetLiveSections();
            this.closeLiveSectionEditor(true);
        };
        const all = el('button', 'link-button live-sec-edit__all', L.allFollowSettings);
        all.type = 'button';
        all.onclick = () => {
            this.closeLiveSectionEditor(false);
            this.openResearchFollowSettings();
        };
        foot.append(reset, all);
        box.appendChild(body);
        fillEditorBody(body, surface, sheet, foot);
        srRegion(box);
        syncReset(reset);
        const root = sheet ? sheetOverlay(box, close) : box;
        document.body.appendChild(root);
        if (!sheet) placePopover(box, anchor);
        const layer: Editor = { surface, root, box, sheet, anchor, body, cleanup: () => {} };
        editor = layer;
        layer.cleanup = guard(() => (editor === layer ? layer : null), (back) => this.closeLiveSectionEditor(back), {
            trap: true,
            // The ⋯ toggles it itself.
            ignore: (t) => !!t.closest('.live-sec-more'),
        });
        syncMoreExpanded();
        body.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus({ preventScroll: true });
    },

    /** Settings opened at Following research (from Customize panel); the overview's phone sheet closes first (it lies over Settings). */
    openResearchFollowSettings(): void {
        if (document.querySelector('.research-overview--sheet')) this.closeResearchOverview();
        this.showSettingsDialog();
        const group = document.getElementById('settings-group-research-follow');
        if (!group || group.hidden) return;
        group.scrollIntoView({ block: 'start' });
        const title = group.querySelector<HTMLElement>('.settings-group-title');
        if (title) {
            title.tabIndex = -1;
            title.focus({ preventScroll: true });
        }
    },

    closeLiveSectionEditor(focusBack: boolean): void {
        const e = editor;
        if (!e) return;
        editor = null;
        e.cleanup();
        e.root.remove();
        syncMoreExpanded();
        if (focusBack) {
            const back = e.anchor.isConnected ? e.anchor : findMore(e.surface);
            back?.focus({ preventScroll: true });
        }
    },

    /** Coalesced: the panel draws the overview first, then itself (a fresh ⋯ is found then). */
    syncLiveSectionEditor(): void {
        if (syncQueued || (!editor && !menu)) return;
        syncQueued = true;
        queueMicrotask(() => {
            syncQueued = false;
            syncNow(this);
        });
    },

    /**
     * A section's menu: its three states (✓ on the stored choice) and
     * Customize panel…; a bottom sheet on a phone. Hiding from here says so,
     * with Undo.
     */
    openLiveSectionMenu(head: HTMLElement, key: PrefKey, surface: Surface, at: At): void {
        if (menu && menu.key === key && menu.surface === surface) return;
        this.closeLiveSectionMenu(false);
        this.closeLiveSectionEditor(false);
        const L = strings.live;
        const sheet = isPhoneBar();
        const title = sectionTitle(surface, key);
        const box = el('div', sheet ? 'live-sec-menu live-sec-menu--sheet live-sec-sheet' : 'live-sec-menu');
        box.id = 'live-sec-menu';
        box.dataset.key = key;
        box.dataset.surface = surface;
        box.setAttribute('role', 'menu');
        box.setAttribute('aria-label', L.sectionMenuAria(title));
        const close = (): void => this.closeLiveSectionMenu(true);
        if (sheet) {
            sheetHead(box, title, close);
            const note = el('div', 'live-sec-menu__note');
            box.appendChild(note);
        } else {
            box.appendChild(el('div', 'live-sec-menu__head'));
        }
        const items = el('div', 'live-sec-menu__items');
        box.appendChild(items);
        const back = (): void => {
            // After the redraw: the section's heading, else ⋯.
            setTimeout(() => (findHead(surface, key) ?? findMore(surface))?.focus({ preventScroll: true }), 0);
        };
        for (const v of SECTION_STATES) {
            const item = el('div', 'live-sec-menu__item');
            item.setAttribute('role', 'menuitemradio');
            item.tabIndex = -1;
            item.dataset.value = v;
            const check = el('span', 'live-sec-menu__check');
            check.setAttribute('aria-hidden', 'true');
            item.append(check, el('span', 'live-sec-menu__label', sectionStateLabel(v)));
            const go = (): void => {
                this.closeLiveSectionMenu(false);
                if (sectionPrefs()[key] !== v) {
                    if (v === 'hidden') this.hideLiveSection(key);
                    else setSectionPref(key, v);
                }
                back();
            };
            item.onclick = go;
            items.appendChild(item);
        }
        const separator = (): void => {
            const sep = el('div', 'live-sec-menu__sep');
            sep.setAttribute('role', 'separator');
            items.appendChild(sep);
        };
        // Move up / Move down where the section stands in this place's order (none past an end).
        const can = sectionMoves(sectionOrder(), key, surface);
        if (can.up || can.down) {
            separator();
            for (const dir of [-1, 1] as const) {
                if (dir < 0 ? !can.up : !can.down) continue;
                const item = el('div', 'live-sec-menu__item live-sec-menu__move');
                item.setAttribute('role', 'menuitem');
                item.tabIndex = -1;
                item.dataset.move = dir < 0 ? 'up' : 'down';
                const pad = el('span', 'live-sec-menu__check');
                pad.setAttribute('aria-hidden', 'true');
                item.append(pad, el('span', 'live-sec-menu__label', dir < 0 ? L.moveUp : L.moveDown));
                item.onclick = () => {
                    this.closeLiveSectionMenu(false);
                    moveSectionTo(movedOrder(sectionOrder(), key, dir, surface), key, surface, null);
                    back();
                };
                items.appendChild(item);
            }
        }
        separator();
        const edit = el('div', 'live-sec-menu__item live-sec-menu__edit');
        edit.setAttribute('role', 'menuitem');
        edit.tabIndex = -1;
        const pad = el('span', 'live-sec-menu__check');
        pad.setAttribute('aria-hidden', 'true');
        edit.append(pad, el('span', 'live-sec-menu__label', L.editPanelMenu));
        edit.onclick = () => {
            this.closeLiveSectionMenu(false);
            const a = findMore(surface) ?? (head.isConnected ? head : null);
            if (a) this.openLiveSectionEditor(a, surface);
        };
        items.appendChild(edit);
        box.addEventListener('keydown', (e) => {
            const list = [...items.querySelectorAll<HTMLElement>('.live-sec-menu__item')];
            const i = list.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
            } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
                e.preventDefault();
                list[i].click();
            } else if (e.key === 'Tab' && !sheet) {
                e.preventDefault();
                this.closeLiveSectionMenu(true);
            }
        });
        const root = sheet ? sheetOverlay(box, close) : box;
        document.body.appendChild(root);
        const layer: Menu = { surface, root, box, sheet, key, head, at, cleanup: () => {} };
        menu = layer;
        syncMenuItems(layer);
        if (!sheet) placeMenu(box, head, at);
        head.classList.add('is-menu-open');
        layer.cleanup = guard(() => (menu === layer ? layer : null), (b) => this.closeLiveSectionMenu(b), { trap: sheet });
        const first = items.querySelector<HTMLElement>('[aria-checked="true"]') ?? items.querySelector<HTMLElement>('.live-sec-menu__item');
        first?.focus({ preventScroll: true });
    },

    closeLiveSectionMenu(focusBack: boolean): void {
        const m = menu;
        if (!m) return;
        menu = null;
        m.cleanup();
        m.root.remove();
        document.querySelectorAll('.live-section__head.is-menu-open').forEach(h => h.classList.remove('is-menu-open'));
        if (focusBack && m.head.isConnected) m.head.focus({ preventScroll: true });
    },

    /**
     * Settings › Following research: the same choices for all trees on this
     * device, shown only when some tree has research or a choice was made.
     */
    renderResearchFollowSettings(): void {
        const group = document.getElementById('settings-group-research-follow');
        const body = group?.querySelector<HTMLElement>('.settings-group-body');
        if (!group || !body) return;
        const show = hasSectionPrefs() || hasFollowPrefs() || TreeManager.getTrees().some(t => !!t.research?.id);
        group.hidden = !show;
        if (!show) {
            body.replaceChildren();
            return;
        }
        // A drag of a row is on: drawn again after it.
        if (dragging) return;
        const mark = focusMark(body);
        fanPersonPicker?.destroy();
        fanPersonPicker = null;
        body.replaceChildren();
        // The two cards of Customize panel, each row on one line (spec 057 §5), then following (spec 043).
        const cards = el('div', 'live-sec-cards live-sec-cards--settings');
        cards.append(
            sectionsCard('settings', 'settings', () => ({ current: 'expanded', autoFolded: false })),
            topCard('settings', 'settings'),
        );
        body.appendChild(cards);
        srRegion(group);
        // Following an agent: never offered while every research tree is an archive (no agent to follow).
        const agentTree = TreeManager.getTrees().some(t => !!t.research?.id && t.research.mode !== 'archive');
        if (agentTree || hasFollowPrefs()) this.appendFollowPrefRows(body);
        const foot = el('div', 'settings-row live-sec-set__reset');
        const reset = el('button', 'live-sec-reset', strings.live.resetDefaults);
        reset.type = 'button';
        reset.onclick = () => this.resetLiveSections(true);
        syncReset(reset, true);
        foot.appendChild(reset);
        body.appendChild(foot);
        refocus(body, mark);
    },

    /**
     * Settings › Following research, after the sections (spec 043 §7): the
     * view following starts in, the fan's centre while following (a chosen
     * person per tree), the session trail.
     */
    appendFollowPrefRows(body: HTMLElement): void {
        const S = strings.settings;
        const V = strings.viewModeSwitch;
        const redraw = (): void => this.renderResearchFollowSettings();

        const view = settingsLine('follow-view', S.followView, S.followViewHelp, null);
        view.line.appendChild(choiceSegment<FollowView>(view.labelId, FOLLOW_VIEWS.map(v => ({ value: v, label: V[v] })), getFollowView(), (v) => {
            setFollowView(v);
            redraw();
        }));
        body.appendChild(view.line);

        const setting = getFanCenterSetting();
        const centreLabels: Record<FanCenterSetting, string> = {
            focus: S.followFanCenterFocus, root: S.followFanCenterRoot, person: S.followFanCenterPerson,
        };
        const centre = settingsLine('follow-fan-center', S.followFanCenter, setting === 'focus' ? S.followFanCenterFocusHelp : null, null);
        centre.line.appendChild(choiceSegment<FanCenterSetting>(centre.labelId, FAN_CENTER_SETTINGS.map(v => ({ value: v, label: centreLabels[v] })), setting, (v) => {
            setFanCenterSetting(v);
            redraw();
        }, true));
        body.appendChild(centre.line);

        // The chosen person: for the tree open now (none open: no row).
        const treeId = DataManager.getCurrentTreeId();
        if (setting === 'person' && treeId) body.appendChild(this.followFanPersonRow(treeId));

        const trail = el('label', 'settings-checkbox settings-row live-sec-set__trail');
        trail.dataset.key = 'follow-trail';
        const box = el('input');
        box.type = 'checkbox';
        box.checked = getFollowTrail();
        box.dataset.value = 'trail';
        box.onchange = () => {
            setFollowTrail(box.checked);
            TreeRenderer.refreshCardTrail();
            redraw();
        };
        const text = el('span', 'settings-text');
        text.append(el('span', 'settings-name', S.followTrail), el('span', 'settings-desc', S.followTrailHelp));
        trail.append(box, text);
        body.appendChild(trail);
        body.appendChild(this.liveMotionRow());
    },

    /**
     * Motion when changes load (spec 055 §4): off, a live load shows the new
     * tree at once with a short highlight. Reduced motion in the system: off
     * whatever is stored (the row says why and cannot be changed).
     */
    liveMotionRow(): HTMLElement {
        const S = strings.settings;
        const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (media && !motionMediaWatched) {
            motionMediaWatched = true;
            media.addEventListener?.('change', () => this.renderResearchFollowSettings());
        }
        const reduced = media?.matches === true;
        const row = el('label', 'settings-checkbox settings-row live-sec-set__motion');
        row.dataset.key = 'live-motion';
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !reduced && getLiveMotion();
        box.dataset.value = 'motion';
        if (reduced) {
            box.disabled = true;
            box.setAttribute('aria-disabled', 'true');
            row.classList.add('is-disabled');
        }
        box.onchange = () => {
            setLiveMotion(box.checked);
            this.renderResearchFollowSettings();
        };
        const text = el('span', 'settings-text');
        text.append(el('span', 'settings-name', S.liveMotion), el('span', 'settings-desc', S.liveMotionHelp));
        if (reduced) {
            const note = el('span', 'live-sec-set__motion-note', S.liveMotionReduced);
            note.setAttribute('role', 'note');
            text.appendChild(note);
        }
        row.append(box, text);
        return row;
    },

    /** "Name · for the tree …  Change", or none chosen for this tree (another tree's choice said) and "Choose person". */
    followFanPersonRow(treeId: string): HTMLElement {
        const S = strings.settings;
        const treeName = (id: string): string => TreeManager.getTreeMetadata(id as TreeId)?.name ?? '';
        const chosen = getFanPerson(treeId);
        const person = chosen ? DataManager.getPerson(chosen) : null;
        const other = person ? null : fanPersonOtherTree(treeId);
        const desc = person ? S.followFanPersonThisTree(treeName(treeId)) : other ? S.followFanPersonOther(treeName(other)) : null;
        const row = settingsLine('follow-fan-person', person ? shownNameFull(person) : S.followFanPersonNone, desc, null);
        row.line.classList.add('live-follow-person');
        const btn = el('button', 'live-follow-person__btn', person ? S.followFanPersonChange : S.followFanPersonPick);
        btn.type = 'button';
        btn.dataset.value = 'pick';
        btn.setAttribute('aria-describedby', row.labelId);
        btn.setAttribute('aria-expanded', 'false');
        const host = el('div', 'live-follow-person__picker');
        host.id = 'live-follow-person-picker';
        host.hidden = true;
        btn.onclick = () => {
            if (!host.hidden) {
                fanPersonPicker?.destroy();
                fanPersonPicker = null;
                host.hidden = true;
                host.replaceChildren();
                btn.setAttribute('aria-expanded', 'false');
                return;
            }
            host.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            fanPersonPicker?.destroy();
            fanPersonPicker = new PersonPicker({
                containerId: host.id,
                onSelect: (id: PersonId) => {
                    setFanPerson(treeId, id);
                    this.renderResearchFollowSettings();
                    document.querySelector<HTMLElement>('#settings-group-research-follow [data-key="follow-fan-person"] .live-follow-person__btn')?.focus({ preventScroll: true });
                },
            });
            host.querySelector<HTMLInputElement>('input')?.focus();
        };
        row.line.append(btn, host);
        return row.line;
    },
});
