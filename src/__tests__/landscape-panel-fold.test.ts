import { describe, it, expect } from 'vitest';
import { landscapePanelFolds } from '../ui/landscape-panel-fold.js';

describe('landscapePanelFolds (spec 116, a phone held sideways)', () => {
    it('folds an unfolded panel for the photos indicator and for a message, sideways only', () => {
        expect(landscapePanelFolds({ landscape: true, panelOpen: true, cause: 'images' })).toBe(true);
        expect(landscapePanelFolds({ landscape: true, panelOpen: true, cause: 'toast', toastKind: 'message' })).toBe(true);
    });
    it('leaves it on a computer, a tablet or a phone upright, and a panel already folded', () => {
        expect(landscapePanelFolds({ landscape: false, panelOpen: true, cause: 'images' })).toBe(false);
        expect(landscapePanelFolds({ landscape: false, panelOpen: true, cause: 'toast', toastKind: 'message' })).toBe(false);
        expect(landscapePanelFolds({ landscape: true, panelOpen: false, cause: 'images' })).toBe(false);
    });
    it('the undo pill and the focus confirmation do not fold it', () => {
        expect(landscapePanelFolds({ landscape: true, panelOpen: true, cause: 'toast', toastKind: 'other' })).toBe(false);
    });
});
