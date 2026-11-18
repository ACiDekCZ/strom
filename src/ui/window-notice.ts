/**
 * The notice at the bottom of the main window's tree about another window's
 * choice (spec 110 §3–§7, src/windows/window-focus.ts): "Centre chosen in
 * another window" with "↶ {the centre before}" and ×; the agent followed
 * (the choice only marked); a person hidden here or no longer in the tree;
 * a person marked but not drawn in this view, with "Go to" and ×.
 *
 * One notice at a time, in the static `#window-notice` (bottom middle of the
 * tree, the focus confirmation's place). Its words are read out by the
 * static status line `#window-notice-status` (not seen) only when
 * `announce` says so (once per run), not at
 * every centre of a run. The notices without × go by themselves after
 * PLAIN_NOTICE_MS.
 */

import { strings } from '../strings.js';
import { DataManager } from '../data.js';
import { shownNameFull } from '../person-name.js';
import { hideFocusToast } from '../focus-toast.js';
import type { PersonId } from '../types.js';
import type { WindowNotice } from '../windows/window-focus.js';
import type { WindowNoticeActions } from '../windows/window-selection.js';

/** How long a notice without × stays (agent, hidden, deleted). */
export const PLAIN_NOTICE_MS = 6000;

const SVG_NS = 'http://www.w3.org/2000/svg';

let timer: ReturnType<typeof setTimeout> | null = null;

function container(): HTMLElement | null {
    return document.getElementById('window-notice');
}

/** A 16 px stroke icon of the design (paths and circles). */
function icon(shapes: Array<['path', string] | ['circle', number, number, number]>, cls = 'wn-icon'): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    for (const s of shapes) {
        const el = document.createElementNS(SVG_NS, s[0]);
        if (s[0] === 'path') el.setAttribute('d', s[1]);
        else {
            el.setAttribute('cx', String(s[1]));
            el.setAttribute('cy', String(s[2]));
            el.setAttribute('r', String(s[3]));
        }
        svg.appendChild(el);
    }
    return svg;
}

const TARGET = () => icon([['circle', 8, 8, 5.5], ['circle', 8, 8, 1.8]]);
const EYE = () => icon([['path', 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z'], ['circle', 8, 8, 2]]);
const INFO = () => icon([['circle', 8, 8, 6], ['path', 'M8 7.5V11'], ['path', 'M8 5h.01']]);

function nameOf(id: PersonId | null): string {
    const p = id ? DataManager.getPerson(id) : null;
    return p ? shownNameFull(p, '?') : '?';
}

function text(cls: string, value: string): HTMLSpanElement {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = value;
    return s;
}

function closeButton(onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wn-close';
    b.setAttribute('aria-label', strings.mainNotice.close);
    b.title = strings.mainNotice.close;
    b.appendChild(icon([['path', 'M4.5 4.5l7 7'], ['path', 'M11.5 4.5l-7 7']]));
    b.addEventListener('click', onClick);
    return b;
}

/** The notice's box and the words a screen reader hears. */
function build(n: WindowNotice, actions: WindowNoticeActions): { box: HTMLElement; said: string } {
    const S = strings.mainNotice;
    const box = document.createElement('div');
    box.className = 'wn-box';
    box.dataset.kind = n.kind;
    switch (n.kind) {
        case 'focus': {
            const prev = nameOf(n.previous);
            box.append(TARGET(), text('wn-msg', S.focusFromWindow));
            if (n.previous) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'wn-restore';
                b.setAttribute('aria-label', S.restoreAria(prev));
                b.title = S.restoreAria(prev);
                b.append(icon([['path', 'M5.5 4l-3 3 3 3'], ['path', 'M2.5 7H9a3.5 3.5 0 0 1 0 7H6']], 'wn-icon wn-restore-icon'), text('wn-name', prev));
                b.addEventListener('click', () => actions.restore());
                box.appendChild(b);
            }
            box.appendChild(closeButton(() => actions.close()));
            return { box, said: S.focusFromWindow };
        }
        case 'not-in-view': {
            const name = nameOf(n.personId);
            const whole = S.notInView(name);
            const at = whole.indexOf(name);
            const msg = document.createElement('span');
            msg.className = 'wn-msg';
            msg.title = whole;
            if (at >= 0) msg.append(whole.slice(0, at), text('wn-name', name), whole.slice(at + name.length));
            else msg.textContent = whole;
            const go = document.createElement('button');
            go.type = 'button';
            go.className = 'wn-go';
            go.textContent = S.goTo;
            go.addEventListener('click', () => actions.goTo(n.personId));
            box.append(INFO(), msg, go, closeButton(() => actions.close()));
            return { box, said: whole };
        }
        case 'agent':
            box.classList.add('wn-plain');
            box.append(EYE(), text('wn-msg', S.agent));
            return { box, said: S.agent };
        case 'hidden':
            box.classList.add('wn-plain');
            box.append(INFO(), text('wn-msg', S.hidden));
            return { box, said: S.hidden };
        case 'deleted':
            box.classList.add('wn-plain');
            box.append(INFO(), text('wn-msg', S.deleted));
            return { box, said: S.deleted };
    }
}

/** Show the notice in place of the one shown (`announce`: its words read out now). */
export function showWindowNotice(n: WindowNotice, announce: boolean, actions: WindowNoticeActions): void {
    const root = container();
    if (!root) return;
    if (timer) clearTimeout(timer);
    timer = null;
    // One notice at the bottom of the tree: the focus confirmation goes.
    hideFocusToast();
    const { box, said } = build(n, actions);
    const old = root.querySelector('.wn-box');
    if (old) old.replaceWith(box);
    else root.prepend(box);
    // The appearance (not again when one notice takes the place of another).
    if (!old) requestAnimationFrame(() => box.classList.add('show'));
    else box.classList.add('show');
    const status = document.getElementById('window-notice-status');
    if (status && announce) {
        status.textContent = '';
        // A new text in the live region is read; the same one set again would not be.
        setTimeout(() => { status.textContent = said; }, 50);
    }
    if (box.classList.contains('wn-plain')) {
        timer = setTimeout(() => {
            timer = null;
            actions.expired();
        }, PLAIN_NOTICE_MS);
    }
}

export function hideWindowNotice(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const root = container();
    if (!root) return;
    root.querySelector('.wn-box')?.remove();
    const status = document.getElementById('window-notice-status');
    if (status) status.textContent = '';
}
