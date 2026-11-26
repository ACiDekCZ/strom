/**
 * The readings' surfaces (the research menu, the panel's strip) are redrawn
 * only when what they show of the readings changed: a research's first status
 * without any reading draws nothing anew (a redraw would replace the panel and
 * the overview under an open menu or a pointer), a reading that starts does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDocumentMethods } from '../ui/read-document-ui.js';

type Fake = {
    readRunningNow: () => unknown;
    readUnopenedNow: () => unknown;
    readDocumentAccepts: () => unknown;
    readOtherAgents: () => string;
    refreshResearchMenu: ReturnType<typeof vi.fn>;
    renderLivePanel: ReturnType<typeof vi.fn>;
};

function fake(running: unknown = null): Fake {
    return {
        readRunningNow: () => running,
        readUnopenedNow: () => null,
        readDocumentAccepts: () => null,
        readOtherAgents: () => '',
        refreshResearchMenu: vi.fn(),
        renderLivePanel: vi.fn(),
    };
}

const refresh = (ui: Fake): void =>
    (readDocumentMethods as unknown as { refreshReadSurfaces(this: Fake): void }).refreshReadSurfaces.call(ui);

describe('refreshReadSurfaces', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-26T10:30:00Z'));
        // The panel is drawn: its strip is redrawn with the menu.
        vi.stubGlobal('document', { getElementById: (id: string) => (id === 'live-panel' ? {} : null) });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('nothing of the readings to show: no redraw; a reading that starts: one', () => {
        const idle = fake();
        refresh(idle);
        vi.runAllTimers();
        expect(idle.refreshResearchMenu).not.toHaveBeenCalled();
        expect(idle.renderLivePanel).not.toHaveBeenCalled();

        const busy = fake({ id: 'rd-1', state: 'running', done: 0 });
        refresh(busy);
        vi.runAllTimers();
        expect(busy.refreshResearchMenu).toHaveBeenCalledTimes(1);
        expect(busy.renderLivePanel).toHaveBeenCalledTimes(1);
        // Asked once more with the same reading: nothing new.
        refresh(busy);
        vi.runAllTimers();
        expect(busy.refreshResearchMenu).toHaveBeenCalledTimes(1);
    });
});
