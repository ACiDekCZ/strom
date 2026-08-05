/**
 * Text areas that grow with what is written in them.
 *
 * Research notes are not two lines long. A register note carries the reading of
 * a record, the doubts about it and what was checked when — the kind of text
 * you scroll a 40px box through three lines at a time, unable to see the
 * sentence you just wrote against the one above it. Growing the box means the
 * note is readable as a whole, which is the only way to notice it contradicts
 * itself.
 *
 * It stops growing at a share of the window: past that the note would push the
 * fields around it off the dialog, and scrolling a tall box is a fair trade.
 * The cap is measured, not hard-coded per breakpoint, so a phone in landscape
 * and a desktop both get a box proportional to the room they have.
 */

/** Fraction of the window height a growing field may claim. */
const MAX_SHARE = 0.4;

/** Never cap below this: a box smaller than this is not worth the scroll. */
const MIN_CAP = 120;

function fit(el: HTMLTextAreaElement, attempt = 0): void {
    // A field inside a dialog that has not been shown yet measures as nothing.
    // Fitting it then would collapse the box to zero and leave it that way
    // until the first keystroke, so wait for a layout — the same few-frame
    // retry the card name fitting uses.
    if (el.scrollHeight === 0) {
        if (attempt < 5) requestAnimationFrame(() => fit(el, attempt + 1));
        return;
    }

    const cap = Math.max(MIN_CAP, Math.round(window.innerHeight * MAX_SHARE));
    // Collapse first: scrollHeight only reports the content's real height when
    // the box is not already taller than it.
    el.style.height = 'auto';
    const style = getComputedStyle(el);

    // scrollHeight counts content plus padding. `height` means something else
    // depending on box-sizing, and these fields are border-box: setting it to
    // scrollHeight leaves the box short by its own border, which clips the last
    // line by a hair — invisible, but the field is scrolled rather than whole.
    const wanted = style.boxSizing === 'border-box'
        ? el.scrollHeight
            + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : el.scrollHeight
            - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

    el.style.height = `${Math.min(wanted, cap)}px`;
    el.style.overflowY = wanted > cap ? 'auto' : 'hidden';
}

/**
 * Make a textarea follow its content. Safe to call again on the same element
 * (dialogs re-render) and while it is still hidden.
 */
export function autoGrow(el: HTMLTextAreaElement): void {
    if (!el.dataset.autogrow) {
        el.dataset.autogrow = '1';
        el.addEventListener('input', () => fit(el));
    }
    fit(el);
}

/** Apply to every textarea matching `selector` inside `root`. */
export function autoGrowAll(root: ParentNode, selector: string): void {
    root.querySelectorAll<HTMLTextAreaElement>(selector).forEach(autoGrow);
}
