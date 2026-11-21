/**
 * The open detail of a line in the overview of an older research (no
 * directions written from the app): "Work on it" starts the agent on the
 * line, so it is offered for an active line only, as in the managed
 * overview; a paused or done line keeps its detail without it. Invented data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installMiniDom } from './helpers/mini-dom.js';
import { researchDirectionsMethods } from '../ui/research-directions-ui.js';
import type { LiveDirection } from '../research-link.js';

let uninstall: () => void = () => {};
beforeAll(() => { uninstall = installMiniDom().uninstall; });
afterAll(() => uninstall());

const ui = {
    activeResearchNoAgent: () => false,
    activeResearchLink: (_kind: string, params: Record<string, string>) => `strom://chat?research=${params.research}`,
    launchResearchLink: () => {},
    showDirectionInTree: () => {},
};

const line = (state: LiveDirection['state']): LiveDirection => ({
    id: 'G0004', name: 'Předci Vendelína Klikvy', state, direction: 'ancestors', last: { at: '2026-11-02T10:00:00Z', text: 'Matrika N Smrkov 1820–1840' },
});
const detail = (d: LiveDirection) => researchDirectionsMethods.directionDetail.call(ui as never, d, 'docked') as unknown as {
    querySelector(sel: string): unknown;
};

describe('Work on it in an older research\'s overview', () => {
    it('an active line offers it', () => {
        expect(detail(line('active')).querySelector('[data-do="work"]')).not.toBeNull();
    });

    it('a paused or done line does not', () => {
        expect(detail(line('paused')).querySelector('[data-do="work"]')).toBeNull();
        expect(detail(line('done')).querySelector('[data-do="work"]')).toBeNull();
    });
});
