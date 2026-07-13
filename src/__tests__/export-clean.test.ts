/**
 * cleanDynamicState must clean dynamic UI state in MARKUP but never touch
 * <script> contents — the inlined bundle can contain the same class names
 * inside string literals (regression: minified menu templates were rewritten,
 * corrupting the exported app — SyntaxError on open).
 */

import { describe, it, expect } from 'vitest';
import { cleanDynamicState } from '../export.js';

describe('cleanDynamicState', () => {
    it('drops active from modal overlays and hides the context menu in markup', () => {
        const html = '<div class="modal-overlay active" id="m"></div>'
            + '<div class="context-menu" id="c"></div>';
        const out = cleanDynamicState(html);
        expect(out).not.toContain('modal-overlay active');
        expect(out).toContain('class="context-menu" style="display:none"');
    });

    it('never rewrites script contents even when they contain the same class strings', () => {
        const script = '<script>const t=`<div class="context-menu-item${x?" danger":""}">`;'
            + 'const o="modal-overlay active";</script>';
        const html = '<div class="modal-overlay active"></div>' + script + '<div class="context-menu"></div>';
        const out = cleanDynamicState(html);
        // Script block is byte-identical.
        expect(out).toContain(script);
        // Markup around it is still cleaned.
        expect(out).not.toContain('<div class="modal-overlay active">');
        expect(out).toContain('class="context-menu" style="display:none"');
    });
});
