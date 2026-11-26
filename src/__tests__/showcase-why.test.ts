/**
 * The showcase's view-only research (spec 143 K4.1): a main action greyed by
 * one helper (seen, focusable, `aria-disabled`, described by the bubble, its
 * mark kept), a click or Enter on it running nothing and showing the bubble
 * (why, `strom demo` with Copy, the action with its mark in words, How to ↗);
 * the research's second guard showing the same bubble; the quiet row under the
 * overview's head; an item's actions reduced to the greyed answer; the
 * research's "now" at the showcase's time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom } from './helpers/mini-dom.js';
import { setLanguage } from '../strings.js';
import { setInShowcaseLookup, setShowcaseAsOfLookup, researchNow, showcaseWhy, showcaseOff } from '../research-link.js';
import {
    markShowcaseOff, showcaseOffEvent, sampleNoteEl, showcaseItemActions, showcaseWhatText, researchLastWork,
    hideShowcaseWhy, showcaseQueueActions, SAMPLE_WHY_ID, SHOWCASE_DEMO_COMMAND, SHOWCASE_HOW_TO_URL,
} from '../ui/sample-why.js';
import { queueWorkMethods } from '../ui/queue-work-dialog.js';

const AS_OF = Date.parse('2026-11-01T09:30:00Z');

let dom: ReturnType<typeof installMiniDom>;
let restoreRect: () => void;

function fakeEvent(type: string, target: unknown, key = ''): Event & { prevented: boolean; stopped: boolean } {
    const e = {
        type, target, key, prevented: false, stopped: false,
        preventDefault() { e.prevented = true; },
        stopImmediatePropagation() { e.stopped = true; },
        stopPropagation() { e.stopped = true; },
    };
    return e as unknown as Event & { prevented: boolean; stopped: boolean };
}

/** "Continue the research" with its AI badge and terminal mark (as setResearchActionLabel draws them). */
function continueButton(): HTMLElement {
    const btn = document.createElement('button');
    const sr = document.createElement('span');
    sr.className = 'research-open-sr';
    sr.textContent = ', AI, opens in the research';
    const ai = document.createElement('span');
    ai.className = 'research-ai-badge';
    ai.textContent = 'AI';
    const mark = document.createElement('span');
    mark.className = 'research-open-mark';
    btn.append('Continue the research', sr, ai, mark);
    let ran = 0;
    btn.onclick = () => { ran++; };
    (btn as unknown as { ran: () => number }).ran = () => ran;
    document.body.appendChild(btn);
    return btn;
}

function bubble(): HTMLElement | null {
    return document.getElementById(SAMPLE_WHY_ID);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
    setLanguage('en');
    dom = installMiniDom();
    const w = globalThis.window as unknown as Record<string, unknown>;
    w.addEventListener = () => {};
    w.innerWidth = 1440;
    w.innerHeight = 900;
    const proto = Object.getPrototypeOf(dom.document.body) as Record<string, unknown>;
    const had = proto.getBoundingClientRect;
    proto.getBoundingClientRect = () => ({ left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 });
    restoreRect = () => { proto.getBoundingClientRect = had; };
    setInShowcaseLookup(() => true);
    setShowcaseAsOfLookup(() => AS_OF);
});

afterEach(() => {
    hideShowcaseWhy();
    restoreRect();
    dom.uninstall();
    setInShowcaseLookup(null);
    setShowcaseAsOfLookup(null);
    vi.useRealTimers();
    setLanguage('en');
});

describe('markShowcaseOff', () => {
    it('greys a main action: seen, focusable, aria-disabled, described by the bubble, its mark kept', () => {
        const btn = continueButton();
        (btn as unknown as { disabled: boolean }).disabled = true;
        btn.setAttribute('aria-haspopup', 'dialog');
        markShowcaseOff(btn, 'agent');
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        expect(btn.getAttribute('aria-describedby')).toBe(SAMPLE_WHY_ID);
        expect((btn as unknown as { disabled: boolean }).disabled).toBe(false);
        expect(btn.hasAttribute('aria-haspopup')).toBe(false);
        expect(btn.dataset.showcaseOff).toBe('agent');
        // The label without the mark's hidden words; the mark itself stays drawn.
        expect(btn.dataset.showcaseLabel).toBe('Continue the research');
        expect(btn.querySelector('.research-open-mark')).not.toBeNull();
        expect(btn.querySelector('.research-ai-badge')).not.toBeNull();
    });
});

describe('a click or Enter on a greyed action', () => {
    it('runs nothing and shows why, with strom demo, the action and its mark, and How to', () => {
        const btn = markShowcaseOff(continueButton(), 'agent');
        const inner = btn.querySelector('.research-open-mark')!;
        const e = fakeEvent('click', inner);
        expect(showcaseOffEvent(e)).toBe(true);
        expect(e.prevented && e.stopped).toBe(true);
        expect((btn as unknown as { ran: () => number }).ran()).toBe(0);
        const b = bubble()!;
        expect(b).not.toBeNull();
        expect(b.getAttribute('role')).toBe('tooltip');
        expect(b.querySelector('b')!.textContent).toBe('View only in the sample');
        expect(b.querySelector('code')!.textContent).toBe(SHOWCASE_DEMO_COMMAND);
        expect(b.querySelector('.sample-copy')!.textContent).toBe('Copy');
        expect(b.querySelector('.what')!.textContent).toBe('In full research: Continue the research · AI + terminal');
        const how = b.querySelector('.sample-howto') as HTMLAnchorElement;
        expect(how.href).toBe(SHOWCASE_HOW_TO_URL);
        expect(how.target).toBe('_blank');
    });

    it('Enter and Space say why; another key or a control not greyed is left alone', () => {
        const btn = markShowcaseOff(continueButton(), 'terminal', 'New line');
        expect(showcaseOffEvent(fakeEvent('keydown', btn, 'Tab'))).toBe(false);
        expect(bubble()).toBeNull();
        expect(showcaseOffEvent(fakeEvent('keydown', btn, 'Enter'))).toBe(true);
        expect(bubble()!.querySelector('.what')!.textContent).toBe('In full research: New line · terminal');
        hideShowcaseWhy();
        expect(showcaseOffEvent(fakeEvent('keydown', btn, ' '))).toBe(true);
        expect(bubble()).not.toBeNull();
        const plain = document.createElement('button');
        document.body.appendChild(plain);
        const e = fakeEvent('click', plain);
        expect(showcaseOffEvent(e)).toBe(false);
        expect(e.prevented || e.stopped).toBe(false);
    });

    it('an action through the bridge says no mark', () => {
        expect(showcaseWhatText('Answer', 'none')).toBe('In full research: Answer');
        expect(showcaseWhatText('Work on the queue…', 'agent')).toBe('In full research: Work on the queue · AI + terminal');
    });
});

describe('the second guard', () => {
    it('an action asked without its control shows the same bubble', () => {
        showcaseWhy(null, 'send');
        const b = bubble()!;
        expect(b).not.toBeNull();
        expect(b.querySelector('.what')!.textContent).toBe('In full research: Send to research · terminal');
    });
});

describe('the quiet row under the overview head', () => {
    it('says as of when, view only, strom demo with Copy and How to', () => {
        const row = sampleNoteEl({ asOf: true });
        expect(row.className).toBe('sample-note');
        expect(row.querySelector('.sample-note__asof')!.textContent).toBe('Sample as of 11/1/2026');
        expect(row.querySelector('.sample-note__text')!.textContent).toBe('View only in the sample – full research:');
        expect(row.querySelector('code')!.textContent).toBe('strom demo');
        expect((row.querySelector('.sample-howto') as HTMLAnchorElement).href).toBe(SHOWCASE_HOW_TO_URL);
    });

    it('in Czech', () => {
        setLanguage('cs');
        const row = sampleNoteEl({ asOf: true });
        expect(row.querySelector('.sample-note__asof')!.textContent).toBe('Stav ukázky k 1. 11. 2026');
        expect(row.querySelector('.sample-copy')!.textContent).toBe('Kopírovat');
    });
});

describe("an item's actions in the showcase", () => {
    it('keeps the answer greyed and the website, drops every other write and link', () => {
        const list: Array<{ key: string; label: string; href?: string; write?: boolean; off?: boolean; disabled?: boolean }> = [
            { key: 'all-images', label: 'All images added' },
            { key: 'answer', label: 'Answer', write: true },
            { key: 'web', label: 'Open website', href: 'https://example.org' },
            { key: 'sent', label: 'Sent', write: true },
            { key: 'chat', label: 'Discuss' },
            { key: 'retry', label: 'Back to the agent', write: true },
        ];
        showcaseItemActions(list, ['answer', 'all-images'], showcaseOff('waiting-answer'));
        expect(list.map(a => a.key)).toEqual(['all-images', 'answer', 'web']);
        expect(list.filter(a => a.off).map(a => a.key)).toEqual(['all-images', 'answer']);
        expect(list.find(a => a.key === 'answer')!.write).toBe(false);
    });
});

describe("the showcase's Queue", () => {
    it("says its order and Process now greyed, each with its mark, and why on a click", () => {
        const row = showcaseQueueActions();
        document.body.appendChild(row);
        const [order, now] = Array.from(row.querySelectorAll('button')) as HTMLElement[];
        expect(order.dataset.showcaseOff).toBe('none');
        expect(order.dataset.showcaseLabel).toBe("Change the queue's order");
        // The label drawn with its group's mark (setResearchActionLabel): none through the bridge, AI + terminal for the agent.
        expect(order.innerHTML).not.toContain('research-open-mark');
        expect(now.dataset.showcaseOff).toBe('agent');
        expect(now.dataset.showcaseLabel).toBe('Process now');
        expect(now.innerHTML).toContain('research-ai-badge');
        expect(now.innerHTML).toContain('research-open-mark');
        expect(now.getAttribute('aria-disabled')).toBe('true');
        expect(showcaseOffEvent(fakeEvent('click', now))).toBe(true);
        expect(bubble()!.querySelector('.what')!.textContent).toBe('In full research: Process now · AI + terminal');
    });

    it('"Work on the queue…" is never offered there (Now has Continue the research greyed)', () => {
        const ui = { researchLinkAvailable: () => true, activeResearchLink: () => 'strom-research://work' };
        expect(queueWorkMethods.queueWorkLinkAvailable.call(ui as never)).toBe(false);
        setInShowcaseLookup(() => false);
        expect(queueWorkMethods.queueWorkLinkAvailable.call(ui as never)).toBe(true);
    });
});

describe("the showcase's lines", () => {
    const s = {
        caps: { directionsWrite: true, directionsOrder: true }, lostSince: null, bridge: { base: 'https://showcase.invalid/__showcase/r1' },
        researches: [
            { id: 'G0001', name: 'Předci Anny Horákové', state: 'active', last: { at: '2026-10-31T16:00:00Z' } },
            { id: 'G0002', name: 'Rod Novák z Hrabětic', state: 'active' },
        ],
        working: [], queue: [], features: [],
    };

    it('are shown only: no write, no order, and no note of an archive', async () => {
        const { researchDirectionsMethods: m } = await import('../ui/research-directions-ui.js');
        const ui = { activeResearchNoAgent: () => false };
        const view = m.directionsView.call(ui as never, s as never);
        expect(view).toMatchObject({ readOnly: true, canWrite: false, ordered: false, canOrder: false });
        setInShowcaseLookup(() => false);
        expect(m.directionsView.call(ui as never, s as never)).toMatchObject({ readOnly: false, canWrite: true, canOrder: true });
    });

    it('"+ New line" stays in sight greyed and says why, with the terminal mark in words', async () => {
        const { researchDirectionsMethods: m } = await import('../ui/research-directions-ui.js');
        const body = document.createElement('div');
        document.body.appendChild(body);
        const ui = {
            ...m, activeResearchNoAgent: () => false, renderResearchOverview: () => {},
            openDirectionForm: () => { throw new Error('the form opened'); },
            managedDirectionRow: () => document.createElement('div'),
            appendOffLineSection: () => false, outsideDirectionRow: () => document.createElement('div'),
            wireDirectionDrop: () => {},
        };
        const view = m.directionsView.call(ui as never, s as never);
        m.appendManagedDirections.call(ui as never, body, s as never, { collapsed: false } as never, 'panel' as never, view);
        const add = body.querySelector('.research-directions__new') as HTMLElement;
        expect(add).not.toBeNull();
        expect(add.getAttribute('aria-disabled')).toBe('true');
        expect(body.querySelector('.research-directions__note')).toBeNull();
        expect(showcaseOffEvent(fakeEvent('click', add))).toBe(true);
        expect(bubble()!.querySelector('.what')!.textContent).toBe('In full research: New direction · terminal');
    });
});

describe('time in the showcase', () => {
    it("the research's now is the showcase's as-of time; outside it the clock", () => {
        expect(researchNow()).toBe(AS_OF);
        setInShowcaseLookup(() => false);
        expect(researchNow()).toBe(Date.parse('2026-11-26T10:00:00Z'));
    });

    it("the last work is the last run, else (a showcase) the newest line's", () => {
        const researches = [
            { id: 'G0001', last: { at: '2026-10-31T16:00:00Z' } },
            { id: 'G0002', last: { at: '2026-10-29T08:00:00Z' } },
        ];
        expect(researchLastWork({ runsEnded: [], researches }, true)).toEqual({ at: Date.parse('2026-10-31T16:00:00Z'), research: 'G0001' });
        expect(researchLastWork({ runsEnded: [], researches }, false)).toBeNull();
        expect(researchLastWork({ runsEnded: [{ ended: '2026-10-30T10:00:00Z', research: null }], researches }, true))
            .toEqual({ at: Date.parse('2026-10-30T10:00:00Z') });
    });
});
