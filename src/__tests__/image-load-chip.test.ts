/**
 * The indicator "Photos k / n" and the notice of photos that did not load
 * (spec 116 §6, §7, §9.2): its words from the queue's snapshot, shown only
 * after CHIP_SHOW_MS, ✓ for BUSY_DONE_MS, gone at once with one notice when
 * some failed, why in the order offline → timeout → missing, held back by an
 * output's progress toast, gone for another tree. Fake timers, no DOM.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    CHIP_SHOW_MS, ImageLoadChipModel, chipWords, failedReasonText, type ChipDeps, type ChipView,
} from '../ui/image-load-chip.js';
import { BUSY_DONE_MS } from '../ui/busy.js';
import { IMAGE_ANSWER_MS } from '../research-image-refs.js';
import { getStringsForLang, setLanguage, strings } from '../strings.js';
import type { ImageLoadSnapshot } from '../image-loads.js';

const snap = (o: Partial<ImageLoadSnapshot> = {}): ImageLoadSnapshot => ({
    treeId: 'tree-a', seq: 1, phase: 'running', done: 0, total: 860, failed: 0, left: 860, reasons: [], ...o,
});

function harness(tree = 'tree-a') {
    const shown: (ChipView | null)[] = [];
    const failed: ImageLoadSnapshot[] = [];
    const said: string[] = [];
    let closed = 0;
    const st = { tree };
    const deps: ChipDeps = {
        currentTreeId: () => st.tree,
        render: v => { shown.push(v); },
        showFailed: s => { failed.push(s); },
        closeFailed: () => { closed++; },
        announce: t => { said.push(t); },
    };
    const model = new ImageLoadChipModel(deps);
    return { model, shown, failed, said, st, closed: () => closed, visible: () => model.shown() };
}

describe('the indicator\'s words', () => {
    afterEach(() => setLanguage('en'));

    it('counts the whole tree, with those not loaded beside, and says it in full for the reader', () => {
        setLanguage('en');
        expect(chipWords({ kind: 'run', done: 120, total: 860, failed: 0, left: 740 }))
            .toEqual({ label: 'Photos', count: '120 / 860', main: '120 / 860', failed: '', aria: 'Loading photos: 120 of 860', share: 120 / 860 });
        expect(chipWords({ kind: 'run', done: 846, total: 860, failed: 3, left: 11 }).count).toBe('846 / 860 · 3 not loaded');
        // The failed part its own piece (a phone wraps it whole).
        expect(chipWords({ kind: 'run', done: 846, total: 860, failed: 3, left: 11 })).toMatchObject({ main: '846 / 860', failed: '· 3 not loaded' });
        expect(chipWords({ kind: 'run', done: 846, total: 860, failed: 0, left: 14 })).toMatchObject({ main: '846 / 860', failed: '' });
        expect(chipWords({ kind: 'ok', total: 860 })).toMatchObject({ count: '860 / 860', share: null });
    });

    it('in every language (cs, de, pl)', () => {
        setLanguage('cs');
        expect(chipWords({ kind: 'run', done: 846, total: 860, failed: 3, left: 11 })).toMatchObject({ label: 'Fotky', count: '846 / 860 · 3 nenačteno', aria: 'Načítají se fotky: 846 z 860' });
        expect(strings.photos.detailLeft(740, 0)).toBe('Zbývá 740 · nenačteno 0');
        expect(strings.photos.someFailed(12)).toBe('Některé fotky se nenačetly (12).');
        expect(getStringsForLang('de').photos.chipLabel).toBe('Fotos');
        expect(getStringsForLang('pl').photos.chipLabel).toBe('Zdjęcia');
        expect(getStringsForLang('pl').photos.chipFailed(3)).toBe('· nie wczytano: 3');
    });
});

describe('why the photos did not load', () => {
    it('the first in the order offline → timeout → missing', () => {
        expect(failedReasonText(['offline'])).toBe(strings.busy.errOffline);
        expect(failedReasonText(['timeout'])).toBe(strings.busy.errTimeout(Math.round(IMAGE_ANSWER_MS / 1000)));
        expect(failedReasonText(['missing'])).toBe(strings.photos.whyMissing);
        expect(failedReasonText(['missing', 'timeout'])).toBe(strings.busy.errTimeout(Math.round(IMAGE_ANSWER_MS / 1000)));
        expect(failedReasonText(['missing', 'offline', 'timeout'])).toBe(strings.busy.errOffline);
        expect(failedReasonText([])).toBe(strings.busy.errOffline);
    });
});

describe('when the indicator shows', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('only once photos have been on their way 400 ms: a quick few never blink', () => {
        const h = harness();
        h.model.update(snap({ total: 3, left: 3 }));
        vi.advanceTimersByTime(CHIP_SHOW_MS - 10);
        h.model.update(snap({ total: 3, left: 0, done: 3, phase: 'done' }));
        vi.advanceTimersByTime(BUSY_DONE_MS + CHIP_SHOW_MS);
        expect(h.shown).toEqual([]);
        expect(h.said).toEqual([]);
        expect(h.failed).toEqual([]);
    });

    it('after 400 ms it counts; the numbers follow; all came: ✓ for 2 s (said once), then gone', () => {
        const h = harness();
        h.model.update(snap());
        expect(h.visible()).toBeNull();
        vi.advanceTimersByTime(CHIP_SHOW_MS);
        expect(h.visible()).toEqual({ kind: 'run', done: 0, total: 860, failed: 0, left: 860 });
        h.model.update(snap({ done: 120, left: 740 }));
        expect(h.visible()).toMatchObject({ kind: 'run', done: 120 });
        h.model.update(snap({ phase: 'done', done: 860, left: 0 }));
        expect(h.visible()).toEqual({ kind: 'ok', total: 860 });
        expect(h.said).toEqual(['✓ Photos 860 / 860']);
        vi.advanceTimersByTime(BUSY_DONE_MS - 1);
        expect(h.visible()).toEqual({ kind: 'ok', total: 860 });
        vi.advanceTimersByTime(1);
        expect(h.visible()).toBeNull();
        expect(h.failed).toEqual([]);
    });

    it('some did not load: gone at once, one notice for the round; a repeated end says nothing new', () => {
        const h = harness();
        h.model.update(snap());
        vi.advanceTimersByTime(CHIP_SHOW_MS);
        h.model.update(snap({ done: 846, failed: 3, left: 11, reasons: ['missing'] }));
        expect(h.visible()).toMatchObject({ failed: 3 });
        const end = snap({ phase: 'done', done: 848, failed: 12, left: 0, reasons: ['offline', 'missing'] });
        h.model.update(end);
        expect(h.visible()).toBeNull();
        expect(h.failed).toEqual([end]);
        // A drop after the end tells the state again: still one notice.
        h.model.update({ ...end, total: 859, failed: 11 });
        expect(h.failed).toHaveLength(1);
        vi.advanceTimersByTime(BUSY_DONE_MS);
        expect(h.visible()).toBeNull();
        expect(h.said).toEqual([]);
    });

    it('Try again: the notice goes, the indicator counts the whole tree again; all came: ✓', () => {
        const h = harness();
        h.model.update(snap());
        h.model.update(snap({ phase: 'done', done: 851, failed: 9, left: 0, reasons: ['offline'] }));
        expect(h.failed).toHaveLength(1);
        h.model.update(snap({ done: 851, failed: 0, left: 9 }));
        expect(h.closed()).toBe(1);
        vi.advanceTimersByTime(CHIP_SHOW_MS);
        expect(h.visible()).toMatchObject({ kind: 'run', done: 851, total: 860 });
        h.model.update(snap({ phase: 'done', done: 860, left: 0 }));
        expect(h.visible()).toEqual({ kind: 'ok', total: 860 });
        expect(h.failed).toHaveLength(1);
    });

    it('failed again after Try again: a new notice (the one before closed)', () => {
        const h = harness();
        h.model.update(snap());
        h.model.update(snap({ phase: 'done', done: 848, failed: 12, left: 0, reasons: ['offline'] }));
        h.model.update(snap({ done: 848, left: 12 }));
        h.model.update(snap({ phase: 'done', done: 851, failed: 9, left: 0, reasons: ['offline'] }));
        expect(h.failed.map(s => s.failed)).toEqual([12, 9]);
        expect(h.closed()).toBe(1);
    });

    it('another tree open: gone at once, no ✓, no notice; a snapshot of another tree is never shown', () => {
        const h = harness();
        h.model.update(snap());
        vi.advanceTimersByTime(CHIP_SHOW_MS);
        expect(h.visible()).not.toBeNull();
        h.st.tree = 'tree-b';
        h.model.treeSwitched();
        expect(h.visible()).toBeNull();
        // The load let go tells it is idle; its last state of the old tree changes nothing.
        h.model.update(snap({ phase: 'done', done: 860, left: 0 }));
        h.model.update({ ...snap(), treeId: null, phase: 'idle', total: 0, left: 0 });
        vi.advanceTimersByTime(BUSY_DONE_MS + CHIP_SHOW_MS);
        expect(h.visible()).toBeNull();
        expect(h.failed).toEqual([]);
        expect(h.said).toEqual([]);
    });

    it('a switch before the 400 ms: it never shows', () => {
        const h = harness();
        h.model.update(snap());
        h.st.tree = 'tree-b';
        h.model.update({ ...snap(), treeId: null, phase: 'idle', total: 0, left: 0 });
        vi.advanceTimersByTime(CHIP_SHOW_MS * 2);
        expect(h.shown).toEqual([]);
    });

    it('the notice of a load goes when another load begins', () => {
        const h = harness();
        h.model.update(snap());
        h.model.update(snap({ phase: 'done', done: 850, failed: 10, left: 0, reasons: ['missing'] }));
        h.model.update({ ...snap(), treeId: null, seq: 1, phase: 'idle', total: 0, left: 0 });
        expect(h.closed()).toBe(1);
        h.model.update(snap({ seq: 2 }));
        expect(h.failed).toHaveLength(1);
    });

    it('held back by an output\'s progress toast: hidden meanwhile, back with the count of now', () => {
        const h = harness();
        h.model.update(snap());
        vi.advanceTimersByTime(CHIP_SHOW_MS);
        const release = h.model.suspend();
        expect(h.visible()).toBeNull();
        expect(h.shown[h.shown.length - 1]).toBeNull();
        h.model.update(snap({ done: 400, left: 460 }));
        expect(h.visible()).toBeNull();
        release();
        release();
        expect(h.visible()).toMatchObject({ kind: 'run', done: 400 });
        expect(h.shown[h.shown.length - 1]).toMatchObject({ done: 400 });
    });

    it('held back by an output\'s wait: some did not load, no notice of its own (the output asks, §8)', () => {
        const h = harness();
        h.model.update(snap());
        const release = h.model.suspend();
        h.model.update(snap({ phase: 'done', done: 848, failed: 12, left: 0, reasons: ['offline'] }));
        expect(h.failed).toEqual([]);
        release();
        expect(h.failed).toEqual([]);
        expect(h.visible()).toBeNull();
        // A notice shown before the output began goes: the output's alert asks instead.
        const g = harness();
        g.model.update(snap());
        g.model.update(snap({ phase: 'done', done: 848, failed: 12, left: 0, reasons: ['offline'] }));
        expect(g.failed).toHaveLength(1);
        g.model.suspend()();
        expect(g.closed()).toBe(1);
        expect(g.failed).toHaveLength(1);
    });
});
