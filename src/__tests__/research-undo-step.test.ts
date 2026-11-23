/**
 * The research's step that takes a send back (research-undo-step.ts), one
 * for the dialogs that say it (a copy taken off a shared research, the undo
 * of a merge already sent, 134 V-N3): `strom sync undo <input>` with the
 * terminal's mark; "I…" and where the number is while the input is not known;
 * the action that opens it in the research's terminal only with the input.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { researchUndoStep, researchUndoStepHtml } from '../ui/research-undo-step.js';
import { setLanguage } from '../strings.js';

const TREE = '0b9e1c2a-4f3d-4c5e-8a7b-1d2e3f4a5b6c';

afterEach(() => setLanguage('en'));

describe('the research step of taking a send back', () => {
    it('with the send\'s input known and links going here: its command and the action in the terminal', () => {
        const step = researchUndoStep(TREE, 'I0042', true);
        expect(step).toEqual({ input: 'I0042', command: 'strom sync undo I0042', url: `strom-research://sync-undo?tree=${TREE}&intake=I0042` });
        const html = researchUndoStepHtml(step, { lead: 'Lead:', cmdClass: 'merge-undo-cmd' });
        expect(html).toContain('<code class="install-line research-undo-cmd merge-undo-cmd" tabindex="0">strom sync undo I0042</code>');
        // The step's words and the action carry the terminal's mark, never ↗ or ◆.
        expect(html.match(/class="research-open-mark"/g)).toHaveLength(2);
        expect(html).toContain('data-act="undo-run"');
        expect(html.replace(/<[^>]*>/g, '')).toContain('Take back in the research');
        expect(html).not.toContain('strom input list');
        expect(html).not.toMatch(/↗|◆/);
    });

    it('without the input: "I…", where its number is, no action', () => {
        for (const input of [null, undefined, '', 'R0007', 'I0042; rm -rf']) {
            const step = researchUndoStep(TREE, input, true);
            expect(step).toEqual({ input: null, command: 'strom sync undo I…', url: null });
            const html = researchUndoStepHtml(step, { lead: 'Lead:' });
            expect(html).toContain('strom input list');
            expect(html).not.toContain('data-act="undo-run"');
            expect(html.match(/class="research-open-mark"/g)).toHaveLength(1);
        }
    });

    it('the input known, the research\'s links not going here: the command alone', () => {
        const step = researchUndoStep(TREE, 'I0042', false);
        expect(step.url).toBeNull();
        expect(researchUndoStepHtml(step, { lead: 'Lead:' })).not.toContain('data-act="undo-run"');
    });

    it('in every language, its words without addressing anyone', () => {
        for (const lang of ['cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const html = researchUndoStepHtml(researchUndoStep(TREE, null, false), { lead: 'x' });
            expect(html).toContain('strom input list');
        }
    });
});
