/**
 * Lineage markers on the page (spec 112): <body> attributes, the tag's
 * letters and the screen reader's lineage words.
 */
import { describe, it, expect } from 'vitest';
import { applyBranchMarkerAttrs, branchAriaKind, branchAriaId } from '../branch-marker-attrs.js';
import { strings } from '../strings.js';

interface FakeEl {
    id: string; hidden: boolean; textContent: string | null;
    dataset: Record<string, string>; children: FakeEl[];
    style: { props: Map<string, string>; setProperty(k: string, v: string): void };
    appendChild(c: FakeEl): FakeEl;
}
function fakeDoc(): { doc: Document; body: FakeEl } {
    const all: FakeEl[] = [];
    const make = (): FakeEl => {
        const el: FakeEl = {
            id: '', hidden: false, textContent: null, dataset: {}, children: [],
            style: { props: new Map(), setProperty(k, v) { this.props.set(k, v); } },
            appendChild(c) { this.children.push(c); all.push(c); return c; },
        };
        return el;
    };
    const body = make();
    const doc = {
        body,
        createElement: () => make(),
        getElementById: (id: string) => all.find(e => e.id === id) ?? null,
    };
    return { doc: doc as unknown as Document, body };
}

describe('applyBranchMarkerAttrs', () => {
    it('puts the shape and the tint on <body>; no shape keeps the tint alone, or nothing', () => {
        const { doc, body } = fakeDoc();
        applyBranchMarkerAttrs('tag', true, doc);
        expect(body.dataset.branchMarker).toBe('tag');
        expect(body.dataset.branchTint).toBe('');
        applyBranchMarkerAttrs('arc', false, doc);
        expect(body.dataset.branchMarker).toBe('arc');
        expect('branchTint' in body.dataset).toBe(false);
        applyBranchMarkerAttrs('none', true, doc);
        expect('branchMarker' in body.dataset).toBe(false);
        expect(body.dataset.branchTint).toBe('');
        applyBranchMarkerAttrs('none', false, doc);
        expect('branchMarker' in body.dataset).toBe(false);
        expect('branchTint' in body.dataset).toBe(false);
    });

    it('sets the letters as quoted CSS strings from the strings', () => {
        const { doc, body } = fakeDoc();
        applyBranchMarkerAttrs('tag', false, doc);
        expect(body.style.props.get('--branch-letter-paternal')).toBe(JSON.stringify(strings.branchColors.letterPaternal));
        expect(body.style.props.get('--branch-letter-maternal')).toBe(JSON.stringify(strings.branchColors.letterMaternal));
        expect(body.style.props.get('--branch-letter-descendant')).toBe(JSON.stringify(strings.branchColors.letterDescendant));
    });

    it('keeps one hidden text per lineage kind, made once', () => {
        const { doc, body } = fakeDoc();
        applyBranchMarkerAttrs('arc', false, doc);
        applyBranchMarkerAttrs('stripe', false, doc);
        expect(body.children).toHaveLength(1);
        const host = body.children[0];
        expect(host.hidden).toBe(true);
        expect(host.children.map(c => c.id)).toEqual([
            'branch-aria-paternal', 'branch-aria-maternal', 'branch-aria-both', 'branch-aria-descendant',
            'branch-aria-slot1', 'branch-aria-slot2', 'branch-aria-slotBoth',
        ]);
        expect(doc.getElementById('branch-aria-both')?.textContent).toBe(strings.branchColors.ariaBoth);
    });
});

describe('branchAriaKind', () => {
    it('names the lines, both lines (R4) and the numbered lines (R5)', () => {
        expect(branchAriaKind(undefined, false)).toBeNull();
        expect(branchAriaKind({ paternal: true }, false)).toBe('paternal');
        expect(branchAriaKind({ maternal: true }, false)).toBe('maternal');
        expect(branchAriaKind({ paternal: true, maternal: true }, false)).toBe('both');
        expect(branchAriaKind({ descendant: true }, false)).toBe('descendant');
        expect(branchAriaKind({ paternal: true }, true)).toBe('slot1');
        expect(branchAriaKind({ maternal: true }, true)).toBe('slot2');
        expect(branchAriaKind({ paternal: true, maternal: true }, true)).toBe('slotBoth');
        expect(branchAriaKind({ descendant: true }, true)).toBe('descendant');
        expect(branchAriaId({ maternal: true }, true)).toBe('branch-aria-slot2');
    });
});
