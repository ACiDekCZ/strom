/**
 * The progress of a computation in parts inside its dialog (waiting buttons §8, 8b): above the footer, the
 * step's words with "k/n" and a bar ("Creating tree 2 of 3: Horáks…   2/3"), `role=status`. At the end the
 * same place says the result as a quiet sentence ("3 trees created."). The button keeps its own short words
 * ("Creating…") meanwhile.
 */

export interface BusyProg {
    readonly el: HTMLElement;
    /** The step now: its words and, with `n`, "k/n" and the bar's share (the step k half done). */
    set(text: string, k?: number, n?: number): void;
    /** The end: the sentence in its place (quiet, `role=status`). */
    done(text: string): void;
    clear(): void;
}

/** A progress block inserted in `parent` before `before` (the dialog's footer). */
export function busyProg(parent: HTMLElement, before: Element | null): BusyProg {
    const el = document.createElement('div');
    el.className = 'busy-prog';
    el.setAttribute('role', 'status');
    const line = document.createElement('div');
    line.className = 'busy-prog__line';
    const text = document.createElement('span');
    text.className = 'busy-prog__text';
    const count = document.createElement('span');
    count.className = 'busy-prog__k';
    line.append(text, count);
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    bar.appendChild(fill);
    el.append(line, bar);
    parent.insertBefore(el, before);
    return {
        el,
        set(words, k, n) {
            text.textContent = words;
            if (k !== undefined && n !== undefined && n > 0) {
                count.textContent = `${k}/${n}`;
                fill.style.width = `${Math.round(Math.min(1, Math.max(0, (k - 0.5) / n)) * 100)}%`;
                bar.hidden = false;
            } else {
                count.textContent = '';
                bar.hidden = true;
            }
        },
        done(words) {
            el.className = 'busy-msg busy-prog-done';
            const span = document.createElement('span');
            span.className = 'busy-msg__text';
            span.textContent = words;
            el.replaceChildren(span);
        },
        clear() {
            el.remove();
        },
    };
}
