/**
 * The showcase's "What the research knows" (spec 143 K4.1): its quiet row first in the dialog's body; a
 * conflict's "Decide in the research" and "Leave it to the agent", a hypothesis's Choose / No version holds /
 * Leave open / Reopen and its way into the research drawn greyed with their marks (never `disabled`), a click
 * saying why; "Change here" and "Stop waiting" not drawn; a conflict decided only by the research's link
 * (never through the showcase's bridge). Outside the showcase all as before. Invented data only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom } from './helpers/mini-dom.js';
import { setLanguage } from '../strings.js';
import { setInShowcaseLookup, showcaseWhy } from '../research-link.js';
import { hideShowcaseWhy, showcaseOffAttrs, showcaseOffEvent, SAMPLE_WHY_ID } from '../ui/sample-why.js';
import { personResearchMethods, showcaseNoteFirst } from '../ui/person-research-ui.js';
import type { ResearchHypothesis } from '../types.js';

let dom: ReturnType<typeof installMiniDom>;
let showcase = true;
let restoreRect: () => void;

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
    showcase = true;
    setInShowcaseLookup(() => showcase);
});

afterEach(() => {
    hideShowcaseWhy();
    restoreRect();
    dom.uninstall();
    setInShowcaseLookup(null);
    vi.useRealTimers();
});

function fakeEvent(type: string, target: unknown): Event & { prevented: boolean } {
    const e = {
        type, target, key: '', prevented: false,
        preventDefault() { e.prevented = true; },
        stopImmediatePropagation() {},
        stopPropagation() {},
    };
    return e as unknown as Event & { prevented: boolean };
}

/** A button carrying the attributes a template drew (`showcaseOffAttrs`). */
function buttonOf(attrs: string): HTMLElement {
    const btn = document.createElement('button');
    for (const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) btn.setAttribute(m[1], m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    document.body.appendChild(btn);
    return btn;
}

/** The tags of the buttons of an HTML string whose attributes include `needle`. */
function buttons(html: string, needle: string): string[] {
    return [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(t => t.includes(needle));
}

const hypothesis = (over: Partial<ResearchHypothesis> = {}): ResearchHypothesis => ({
    id: 'H0022', title: 'Who were the parents of Bohumil Berg?', status: 'open', pickable: true,
    variants: [
        { id: 'A', title: 'Josef Berg and Marie Králová', links: [] },
        { id: 'B', title: 'Jan Berg and Anna Dvořáková', links: [] },
    ],
    ...over,
} as unknown as ResearchHypothesis);

function fakeUi() {
    return {
        ...personResearchMethods,
        activeResearchId: () => null,
        researchLinkAvailable: () => true,
        viewLinkOffersFor: () => [],
        researchVariantSourcesHtml: () => null,
    };
}

describe('the attributes of a greyed main action drawn as HTML', () => {
    it('grey it with its mark from the one map, described by the bubble (and its own note after)', () => {
        const a = showcaseOffAttrs('conflict', 'Decide in the research', 'prc-note-X1-user');
        expect(a).toContain('data-showcase-off="terminal"');
        expect(a).toContain('aria-disabled="true"');
        expect(a).toContain(`aria-describedby="${SAMPLE_WHY_ID} prc-note-X1-user"`);
        expect(a).not.toMatch(/\sdisabled[=\s>]/);
        expect(showcaseOffAttrs('conflict-agent', 'Leave it to the agent')).toContain('data-showcase-off="agent"');
        // Not a main action (hidden), or outside the showcase: nothing.
        expect(showcaseOffAttrs('fact-confirm', 'Verified from the scan')).toBe('');
        showcase = false;
        expect(showcaseOffAttrs('conflict', 'Decide in the research')).toBe('');
    });

    it('a click on such a control runs nothing and says why, with the action and its mark', () => {
        const btn = buttonOf(showcaseOffAttrs('conflict-agent', 'Leave it to the agent'));
        const e = fakeEvent('click', btn);
        expect(showcaseOffEvent(e)).toBe(true);
        expect(e.prevented).toBe(true);
        expect(document.getElementById(SAMPLE_WHY_ID)!.querySelector('.what')!.textContent)
            .toBe('In full research: Leave it to the agent · AI + terminal');
    });

    it('a hypothesis asked without its control says its action too (the second guard)', () => {
        showcaseWhy(null, 'hypothesis');
        expect(document.getElementById(SAMPLE_WHY_ID)!.querySelector('.what')!.textContent)
            .toBe('In full research: Decide in the research · terminal');
    });
});

describe("the showcase's quiet row in What the research knows", () => {
    it('stands first in the body, once', () => {
        const body = document.createElement('div');
        const first = document.createElement('section');
        body.appendChild(first);
        showcaseNoteFirst(body as HTMLElement);
        showcaseNoteFirst(body as HTMLElement);
        expect(body.children.length).toBe(2);
        expect(body.children[0].className).toBe('sample-note');
        expect(body.children[0].querySelector('code')!.textContent).toBe('strom demo');
        expect(body.children[1]).toBe(first);
    });
});

describe("a hypothesis's card in the showcase", () => {
    it('Choose, No version holds, Leave open and its way into the research greyed, never disabled', () => {
        const html = personResearchMethods.researchHypothesisPickHtml.call(fakeUi() as never, 'p1' as never, hypothesis(), 'pick');
        const picks = buttons(html, 'data-hypo-pick=');
        expect(picks).toHaveLength(2);
        for (const b of picks) {
            expect(b).toContain('data-showcase-off="terminal"');
            expect(b).toContain('data-showcase-label="Choose"');
            expect(b).not.toMatch(/\sdisabled[\s>]/);
        }
        expect(buttons(html, 'data-hypo-act="abandon"')[0]).toContain('data-showcase-label="No version holds"');
        expect(buttons(html, 'data-hypo-act="keep-open"')[0]).toContain('data-showcase-off="terminal"');
        expect(buttons(html, 'data-hypo-do="decide"')[0]).toContain('data-showcase-off="terminal"');
    });

    it('decided: Reopen greyed, Change here not drawn', () => {
        const html = personResearchMethods.researchHypothesisPickHtml.call(fakeUi() as never, 'p1' as never,
            hypothesis({ status: 'decided', chosen: 'A' } as Partial<ResearchHypothesis>), 'pick');
        expect(buttons(html, 'data-hypo-act="reopen"')[0]).toContain('data-showcase-label="Reopen"');
        expect(buttons(html, 'data-hypo-act="change"')).toHaveLength(0);
    });

    it('outside the showcase as before: nothing greyed, Change here drawn', () => {
        showcase = false;
        const open = personResearchMethods.researchHypothesisPickHtml.call(fakeUi() as never, 'p1' as never, hypothesis(), 'pick');
        expect(open).not.toContain('data-showcase-off');
        const decided = personResearchMethods.researchHypothesisPickHtml.call(fakeUi() as never, 'p1' as never,
            hypothesis({ status: 'decided', chosen: 'A' } as Partial<ResearchHypothesis>), 'pick');
        expect(buttons(decided, 'data-hypo-act="change"')).toHaveLength(1);
    });

    it("today's card (an older research): its way into the research greyed", () => {
        const html = personResearchMethods.researchHypothesisTodayHtml.call(fakeUi() as never, hypothesis({ pickable: undefined } as unknown as Partial<ResearchHypothesis>), 'old');
        expect(buttons(html, 'data-hypo-do="decide"')[0]).toContain('data-showcase-off="terminal"');
    });
});

describe("a conflict in the showcase", () => {
    it('is decided only by the research link (drawn greyed), never through its bridge', async () => {
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js');
        const ui = {
            activeResearchId: () => 'r1',
            researchStatusOf: () => ({ features: ['conflict.decide'] }),
            researchLinkAvailable: () => true,
        };
        expect(researchSyncMethods.researchConflictDecideMode.call(ui as never)).toBe('link');
        showcase = false;
        expect(researchSyncMethods.researchConflictDecideMode.call(ui as never)).toBe('bridge');
    });
});

describe("a hypothesis in the showcase's What waits", () => {
    it('Choose, Accept the proposal and Leave open stay in sight greyed with their mark; a click says why', async () => {
        const { DataManager } = await import('../data.js');
        const { hypothesisWaitingMethods: m } = await import('../ui/hypothesis-waiting-ui.js');
        const h = hypothesis({ proposal: { variant: 'B', text: 'Two records agree.' } } as unknown as Partial<ResearchHypothesis>);
        const data = vi.spyOn(DataManager, 'getData').mockReturnValue({ persons: { p1: { id: 'p1', research: { hypotheses: [h] } } } } as never);
        let asked = 0;
        const ui = {
            ...m, activeResearchId: () => 'r1',
            researchHypothesisPickable: () => 'pick',
            askWaitingHypothesis: () => { asked++; },
            showPersonResearchDialog: () => {},
            closeResearchOverview: () => {},
        };
        try {
            const row = m.hypothesisWaitingRow.call(ui as never, { id: 'H0022', what: h.title, person: 'p1' } as never, 'panel' as never, null);
            const off = row.querySelectorAll('[data-showcase-off]');
            expect(off.length).toBeGreaterThan(0);
            for (const b of off) {
                expect(b.getAttribute('data-showcase-off')).toBe('terminal');
                expect(b.getAttribute('aria-disabled')).toBe('true');
            }
            const labels = [...off].map(b => b.getAttribute('data-showcase-label'));
            expect(labels).toContain('Leave open');
            expect(showcaseOffEvent(fakeEvent('click', off[0]))).toBe(true);
            expect(asked).toBe(0);
            showcase = false;
            const plain = m.hypothesisWaitingRow.call(ui as never, { id: 'H0022', what: h.title, person: 'p1' } as never, 'panel' as never, null);
            expect(plain.querySelectorAll('[data-showcase-off]')).toHaveLength(0);
        } finally {
            data.mockRestore();
        }
    });
});
