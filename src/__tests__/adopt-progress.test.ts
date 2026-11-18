/**
 * Waiting buttons part 3: the steps of handing a tree to the research (A175, screens 2a–2c) – the list in the
 * dialog (done ✓, running spinner, to come ·, failed !), the time of the running step, "taking longer", and
 * the same steps in the background toast (k of 4); and the quiet limit of a link the research cannot prove
 * (`new?app=`, A173/A94), after which the caller waits for the research to come back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom } from './helpers/mini-dom.js';

const toasts: Array<{ opts: Record<string, unknown>; steps: unknown[]; closed: boolean; done?: string }> = [];
vi.mock('../ui/toast.js', () => ({
    showToast: () => ({ el: null, update: () => undefined, close: () => undefined }),
    showProgressToast: (opts: Record<string, unknown>, first: unknown) => {
        const t = { opts, steps: [first] as unknown[], closed: false, done: undefined as string | undefined };
        toasts.push(t);
        return {
            el: { dataset: {}, classList: { add: () => undefined } },
            update: (s: unknown) => { t.steps.push(s); },
            done: (summary?: string) => { t.done = summary; },
            fail: () => undefined,
            close: () => { t.closed = true; },
        };
    },
}));

const { AdoptProgress, ADOPT_STEPS } = await import('../ui/adopt-progress.js');
const { setLanguage, strings } = await import('../strings.js');
const { openResearchBusy } = await import('../ui/research-open-busy.js');

let dom: ReturnType<typeof installMiniDom>;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:15:00Z'));
    dom = installMiniDom();
    toasts.length = 0;
    setLanguage('en');
});

afterEach(() => {
    dom.uninstall();
    vi.useRealTimers();
});

type El = { className: string; textContent: string; dataset: Record<string, string | undefined>; querySelector(s: string): El | null; querySelectorAll(s: string): El[]; getAttribute(k: string): string | null };

function host(): El {
    const h = document.createElement('div');
    document.body.appendChild(h);
    return h as unknown as El;
}

function rows(h: El): Array<{ step: string; state: string; glyph: string; label: string; meta: string }> {
    return h.querySelectorAll('ul.steps > li').map(li => ({
        step: li.dataset.step ?? '',
        state: li.className,
        glyph: li.querySelector('.g')?.querySelector('.busy-spin') ? 'spin' : li.querySelector('.g')?.textContent ?? '',
        label: li.querySelector('.steps-label')?.textContent ?? '',
        meta: li.querySelector('.meta')?.textContent ?? '',
    }));
}

describe('the steps of a hand-over in its dialog', () => {
    it('lists four steps in order, the running one with a spinner and an ellipsis, the done ones with ✓', () => {
        const h = host();
        const p = new AdoptProgress({ onShow: () => undefined });
        p.attach(h as unknown as HTMLElement);
        const list = h.querySelector('ul.steps')!;
        expect(list.getAttribute('role')).toBe('status');
        expect(list.getAttribute('aria-live')).toBe('polite');
        expect(rows(h).map(r => [r.step, r.state, r.glyph])).toEqual([
            ['backup', 'todo', '·'], ['gedcom', 'todo', '·'], ['taking', 'todo', '·'], ['loading', 'todo', '·'],
        ]);
        p.phase({ step: 'backup' });
        p.phase({ step: 'gedcom', meta: '2,400 people' });
        p.phase({ step: 'taking' });
        const now = rows(h);
        expect(now.map(r => [r.state, r.glyph])).toEqual([['done', '✓'], ['done', '✓'], ['run', 'spin'], ['todo', '·']]);
        expect(now[1]).toMatchObject({ label: 'Creating GEDCOM', meta: '2,400 people' });
        expect(now[2].label).toBe('The research takes over the tree…');
        // The loading step's own text ends with an ellipsis: said once.
        p.phase({ step: 'loading' });
        expect(rows(h)[3].label).toBe('Loading the tree from the research…');
        p.meta('loading', '3.2 MB');
        p.finish();
        expect(rows(h).map(r => r.glyph)).toEqual(['✓', '✓', '✓', '✓']);
        expect(rows(h)[3]).toMatchObject({ label: 'Loading the tree from the research', meta: '3.2 MB' });
        expect(p.ended).toBe(true);
    });

    it('a failed step is marked ! and the steps after it stay to come', () => {
        const h = host();
        const p = new AdoptProgress({ onShow: () => undefined });
        p.attach(h as unknown as HTMLElement);
        p.phase({ step: 'taking' });
        p.fail();
        expect(rows(h).map(r => [r.state, r.glyph])).toEqual([['done', '✓'], ['done', '✓'], ['fail', '!'], ['todo', '·']]);
        expect(ADOPT_STEPS.map(s => p.stateOf(s))).toEqual(['done', 'done', 'fail', 'todo']);
    });

    it('the running step shows its time from 10 s, and from 20 s it says it takes longer and why', () => {
        const h = host();
        const p = new AdoptProgress({ onShow: () => undefined });
        p.attach(h as unknown as HTMLElement);
        p.phase({ step: 'taking' });
        vi.advanceTimersByTime(9_000);
        expect(rows(h)[2].meta).toBe('');
        vi.advanceTimersByTime(5_000);
        expect(rows(h)[2].meta).toBe('· 14 s');
        expect(h.querySelector('.adopt-long')).toBeNull();
        vi.advanceTimersByTime(7_000);
        expect(h.querySelector('.adopt-long')?.textContent).toBe(`${strings.busy.takingLong} ${strings.busy.adoptLongNote}`);
        p.finish();
        expect(h.querySelector('.adopt-long')).toBeNull();
        expect(rows(h)[2].meta).toBe('');
    });
});

describe('the hand-over folded into the background', () => {
    it('a progress toast with Show and the step k of 4; attaching again closes it', () => {
        const h = host();
        const shown = vi.fn();
        const p = new AdoptProgress({ onShow: shown });
        p.attach(h as unknown as HTMLElement);
        p.phase({ step: 'gedcom', meta: '12 people' });
        p.phase({ step: 'taking' });
        p.background();
        expect(toasts).toHaveLength(1);
        expect(toasts[0].opts.title).toBe('Handing the tree to the research…');
        expect(toasts[0].opts.cancel).toBeUndefined();
        expect(toasts[0].steps[0]).toEqual({ step: 'The research takes over the tree', k: 3, n: 4 });
        (toasts[0].opts.show as () => void)();
        expect(shown).toHaveBeenCalledOnce();
        p.phase({ step: 'loading', meta: '1.4 MB' });
        expect(toasts[0].steps[toasts[0].steps.length - 1]).toEqual({ step: 'Loading the tree from the research', k: 4, n: 4, size: '1.4 MB' });
        // Folding twice keeps one toast.
        p.background();
        expect(toasts).toHaveLength(1);
        p.attach(h as unknown as HTMLElement);
        expect(toasts[0].closed).toBe(true);
    });
});

describe('a link the research cannot prove, with a quiet limit (new?app=)', () => {
    const deps = { handOver: vi.fn(), ask: async () => null, statusNow: () => null, bridgeDown: () => false };

    it('ends at its limit without the sentence; the caller says what follows', async () => {
        const el = document.createElement('button') as unknown as HTMLElement;
        document.body.appendChild(el as unknown as Node);
        const done = openResearchBusy(el, 'strom-research://new?app=chrome&token=t1', { quietLimit: true }, deps);
        await vi.advanceTimersByTimeAsync(10_500);
        expect(await done).toBe('limit');
        expect(deps.handOver).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(document.querySelector('.busy-msg')).toBeNull();
    });

    it('without it the same link ends in the neutral sentence', async () => {
        const el = document.createElement('button') as unknown as HTMLElement;
        document.body.appendChild(el as unknown as Node);
        const done = openResearchBusy(el, 'strom-research://new?app=chrome&token=t2', {}, deps);
        await vi.advanceTimersByTimeAsync(10_500);
        await done;
        expect(document.querySelector('.busy-msg')?.textContent).toContain(strings.busy.notOpened);
    });

    it('its signal ends the wait at once, quietly', async () => {
        const el = document.createElement('button') as unknown as HTMLElement;
        document.body.appendChild(el as unknown as Node);
        const stop = new AbortController();
        let settled = false;
        const done = openResearchBusy(el, 'strom-research://new?app=chrome&token=t3', { signal: stop.signal }, deps).then(r => { settled = true; return r; });
        await vi.advanceTimersByTimeAsync(2_000);
        stop.abort();
        await vi.advanceTimersByTimeAsync(400);
        expect(settled).toBe(true);
        await done;
        await vi.advanceTimersByTimeAsync(3_000);
        expect(document.querySelector('.busy-msg')).toBeNull();
    });
});
