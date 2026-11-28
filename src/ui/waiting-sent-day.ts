/**
 * The day a request went out (spec 149 K2.1): a small popover under "Sent"
 * (or "Change the day it was sent") with a day field, today by default (the
 * day it was sent, when changed), never a day still to come. Enter records,
 * Escape and a click outside close it. It opens in the anchor's own document
 * (the overview may be a window of its own). Styles: `.sent-day-pop*` in index.html.
 */

import { MQ_MOBILE } from '../breakpoints.js';
import { sentDayAllowed, localDayOf } from '../research-waiting-write.js';

export interface SentDayPopoverOptions {
    /** The button it opens from (its document, the position, focus back on Escape). */
    anchor: HTMLElement;
    /** The day in the field at first ("2026-11-24"). */
    day: string;
    /** Now (ms): today is the latest day it takes. */
    now: number;
    labels: { title: string; note?: string; save: string; cancel: string; future: string };
    onSave: (day: string) => void;
    onClose?: () => void;
}

let closeOpen: (() => void) | null = null;

/** Close the popover of the day, when one is open. */
export function closeSentDayPopover(): void {
    closeOpen?.();
}

/** Open the popover of the day under its button; returns its close function. */
export function openSentDayPopover(o: SentDayPopoverOptions): () => void {
    closeOpen?.();
    const doc = o.anchor.ownerDocument;
    const win = doc.defaultView ?? window;
    const today = localDayOf(o.now);
    const pop = doc.createElement('div');
    pop.className = 'sent-day-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', o.labels.title);
    const label = doc.createElement('label');
    label.className = 'sent-day-pop__label';
    const title = doc.createElement('span');
    title.className = 'sent-day-pop__title';
    title.textContent = o.labels.title;
    const input = doc.createElement('input');
    input.type = 'date';
    input.className = 'sent-day-pop__input';
    input.max = today;
    input.value = o.day;
    input.required = true;
    label.append(title, input);
    pop.appendChild(label);
    if (o.labels.note) {
        const note = doc.createElement('p');
        note.className = 'sent-day-pop__note';
        note.textContent = o.labels.note;
        pop.appendChild(note);
    }
    const error = doc.createElement('p');
    error.className = 'sent-day-pop__error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const buttons = doc.createElement('div');
    buttons.className = 'sent-day-pop__buttons';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary sent-day-pop__cancel';
    cancel.textContent = o.labels.cancel;
    const save = doc.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary sent-day-pop__save';
    save.textContent = o.labels.save;
    buttons.append(cancel, save);
    pop.append(error, buttons);
    doc.body.appendChild(pop);

    const place = (): void => {
        const r = o.anchor.getBoundingClientRect();
        if (win.matchMedia(MQ_MOBILE).matches) {
            pop.style.left = '16px';
            pop.style.right = '16px';
            pop.style.width = 'auto';
        } else {
            const w = pop.offsetWidth || 280;
            pop.style.left = `${Math.max(8, Math.min(r.left, win.innerWidth - w - 8))}px`;
        }
        const h = pop.offsetHeight || 150;
        // Under the button; where there is no room under it, above it.
        const top = r.bottom + 6 + h > win.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6;
        pop.style.top = `${Math.max(8, Math.min(top, win.innerHeight - h - 8))}px`;
    };
    place();

    let closed = false;
    const onDown = (e: Event): void => {
        if (!pop.contains(e.target as Node) && !o.anchor.contains(e.target as Node)) close();
    };
    const close = (): void => {
        if (closed) return;
        closed = true;
        if (closeOpen === close) closeOpen = null;
        pop.remove();
        doc.removeEventListener('pointerdown', onDown, true);
        win.removeEventListener('resize', place);
        o.onClose?.();
    };
    const take = (): void => {
        const day = input.value;
        if (!sentDayAllowed(day, Date.now())) {
            error.textContent = o.labels.future;
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        close();
        o.onSave(day);
    };
    doc.addEventListener('pointerdown', onDown, true);
    win.addEventListener('resize', place);
    input.addEventListener('input', () => {
        error.hidden = true;
        input.removeAttribute('aria-invalid');
    });
    cancel.addEventListener('click', () => {
        close();
        o.anchor.focus();
    });
    save.addEventListener('click', take);
    pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            o.anchor.focus();
        } else if (e.key === 'Enter' && e.target === input) {
            e.preventDefault();
            take();
        }
    });
    closeOpen = close;
    input.focus();
    return close;
}
