/**
 * Lineage markers on the page (spec 112): the chosen shape and tint as
 * attributes of <body> (the stylesheet draws the markers from them), the
 * letters of the tag from the strings, and the hidden texts a marked card
 * names as its description for screen readers (pseudo-elements are not read).
 */

import { BranchSet } from './branch-colors.js';
import { BranchMarker } from './types.js';
import { strings } from './strings.js';

/** The words a card's lineage is described with (shared hidden elements, one per kind). */
export type BranchAriaKind = 'paternal' | 'maternal' | 'both' | 'descendant' | 'slot1' | 'slot2' | 'slotBoth';

const ARIA_HOST_ID = 'branch-aria-texts';
const ariaId = (kind: BranchAriaKind): string => `branch-aria-${kind}`;

function ariaText(kind: BranchAriaKind): string {
    const s = strings.branchColors;
    switch (kind) {
        case 'paternal': return s.ariaPaternal;
        case 'maternal': return s.ariaMaternal;
        case 'both': return s.ariaBoth;
        case 'descendant': return s.ariaDescendant;
        case 'slot1': return s.ariaSlot1;
        case 'slot2': return s.ariaSlot2;
        case 'slotBoth': return s.ariaSlotBoth;
    }
}

const ARIA_KINDS: readonly BranchAriaKind[] = ['paternal', 'maternal', 'both', 'descendant', 'slot1', 'slot2', 'slotBoth'];

/** Which words describe a card's lineage; `numbered` = R5 (two same-gender parents). */
export function branchAriaKind(set: BranchSet | undefined, numbered: boolean): BranchAriaKind | null {
    if (!set) return null;
    if (set.paternal && set.maternal) return numbered ? 'slotBoth' : 'both';
    if (set.paternal) return numbered ? 'slot1' : 'paternal';
    if (set.maternal) return numbered ? 'slot2' : 'maternal';
    if (set.descendant) return 'descendant';
    return null;
}

/** A person's lineage in words ("paternal line", R5 "first parent's line"); '' without a line. */
export function branchLineText(set: BranchSet | undefined, numbered: boolean): string {
    const kind = branchAriaKind(set, numbered);
    return kind ? ariaText(kind) : '';
}

/** The id a card's `aria-describedby` points to for its lineage. */
export function branchAriaId(set: BranchSet | undefined, numbered: boolean): string | null {
    const kind = branchAriaKind(set, numbered);
    return kind ? ariaId(kind) : null;
}

/**
 * Put the marker's state on <body>: `data-branch-marker` (absent when 'none'),
 * `data-branch-tint` (while the tint is chosen, with any shape or alone), the
 * tag's letters as `--branch-letter-*` (quoted CSS strings), and the hidden
 * lineage texts in the current language.
 */
export function applyBranchMarkerAttrs(marker: BranchMarker, tint: boolean, doc: Document = document): void {
    const body = doc.body;
    if (!body) return;
    if (marker === 'none') delete body.dataset.branchMarker;
    else body.dataset.branchMarker = marker;
    if (tint) body.dataset.branchTint = '';
    else delete body.dataset.branchTint;
    const s = strings.branchColors;
    body.style.setProperty('--branch-letter-paternal', JSON.stringify(s.letterPaternal));
    body.style.setProperty('--branch-letter-maternal', JSON.stringify(s.letterMaternal));
    body.style.setProperty('--branch-letter-descendant', JSON.stringify(s.letterDescendant));

    let host = doc.getElementById(ARIA_HOST_ID);
    if (!host) {
        host = doc.createElement('div');
        host.id = ARIA_HOST_ID;
        host.hidden = true;
        body.appendChild(host);
    }
    for (const kind of ARIA_KINDS) {
        let el = doc.getElementById(ariaId(kind));
        if (!el) {
            el = doc.createElement('span');
            el.id = ariaId(kind);
            host.appendChild(el);
        }
        const text = ariaText(kind);
        if (el.textContent !== text) el.textContent = text;
    }
}
