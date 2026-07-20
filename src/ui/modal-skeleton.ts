/**
 * Unified modal skeleton (redesign round 13).
 *
 * Every dialog shares one structure: a fixed header, a scrolling body, and a
 * fixed action row — modelled on the person modal's pm-header / pm-footer.
 * Historically each `.modal` scrolled as a whole with sticky hacks (negative
 * top offsets, footers sticky only in some breakpoints) and inner lists carried
 * their own `max-height`, which produced double scrollbars.
 *
 * Rather than hand-edit ~50 dialog templates, this module normalizes the DOM at
 * runtime: for any `.modal` it locates the header and the action row and wraps
 * everything in between into a single `.modal-content` scroll container. The
 * flex column skeleton (see index.html, scoped to `.modal:has(> .modal-content)`)
 * then keeps header and actions pinned while only the body scrolls.
 *
 * All existing ids/classes inside the dialog are preserved — nodes are moved,
 * never recreated — so behaviour and e2e selectors are untouched.
 */

// Header = the first direct child that is a header block, or a leading <h2>
// (form-modal / menu-modal use a bare heading instead of a .modal-header div).
const HEADER_SELECTOR = '.modal-header, .pm-header';

// Action row = the last direct child matching any known footer class.
const FOOTER_SELECTOR =
    '.buttons, .modal-buttons, .export-buttons, .pm-footer, .tree-manager-footer, .wiz-actions';

/**
 * Wrap a single `.modal` body into a `.modal-content` scroll container.
 * Idempotent: marks the modal via a data attribute and skips on repeat.
 */
export function normalizeModal(modal: HTMLElement): void {
    if (modal.dataset.skeleton) return;
    if (modal.querySelector(':scope > .modal-content')) {
        modal.dataset.skeleton = 'done';
        return;
    }

    const kids = Array.from(modal.children) as HTMLElement[];

    let header: HTMLElement | undefined = kids.find((k) => k.matches(HEADER_SELECTOR));
    if (!header && kids[0] && kids[0].tagName === 'H2') {
        header = kids[0];
    }

    let footer: HTMLElement | undefined;
    for (let i = kids.length - 1; i >= 0; i--) {
        if (kids[i].matches(FOOTER_SELECTOR)) {
            footer = kids[i];
            break;
        }
    }

    // Dialogs without a recognizable header AND footer (e.g. the centered
    // about box) keep their legacy layout untouched.
    if (!header && !footer) {
        modal.dataset.skeleton = 'skip';
        return;
    }

    const startIdx = header ? kids.indexOf(header) + 1 : 0;
    const endIdx = footer ? kids.indexOf(footer) : kids.length;
    const middle = kids.slice(startIdx, endIdx);

    if (middle.length === 0) {
        modal.dataset.skeleton = 'done';
        return;
    }

    const content = document.createElement('div');
    content.className = 'modal-content';
    // Reserve the slot before moving nodes so document order is preserved.
    modal.insertBefore(content, middle[0]);
    for (const el of middle) {
        content.appendChild(el);
    }

    modal.dataset.skeleton = 'done';
    attachScrollHint(content);
}

/**
 * Toggle an `is-scrollable` class on a `.modal-content` while more content
 * lies below the fold, driving the bottom fade hint (CSS `::after`).
 */
function attachScrollHint(content: HTMLElement): void {
    const update = (): void => {
        const scrollable = content.scrollHeight - content.clientHeight > 1;
        const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
        content.classList.toggle('is-scrollable', scrollable && !atBottom);
    };
    content.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(update);
        ro.observe(content);
    }
    // Initial pass once layout settles (modal may be display:none at wrap time).
    requestAnimationFrame(update);
}

/**
 * Normalize every existing modal and watch for dynamically inserted ones.
 * Safe to call once at startup.
 */
export function initModalSkeleton(): void {
    document.querySelectorAll<HTMLElement>('.modal').forEach(normalizeModal);

    const observer = new MutationObserver((records) => {
        for (const rec of records) {
            for (const node of Array.from(rec.addedNodes)) {
                if (!(node instanceof HTMLElement)) continue;
                if (node.classList.contains('modal')) {
                    normalizeModal(node);
                }
                node.querySelectorAll?.<HTMLElement>('.modal').forEach(normalizeModal);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
