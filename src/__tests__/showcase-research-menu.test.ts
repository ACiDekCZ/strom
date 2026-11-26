/**
 * The showcase's research menu and a person's "Research ›" (spec 143 K4.1): "Send to research" and
 * "Ask the agent" in sight greyed with their group's mark (never run, a click says why); outside the
 * showcase the rows as before. Invented data only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom } from './helpers/mini-dom.js';
import { setLanguage } from '../strings.js';
import { setInShowcaseLookup } from '../research-link.js';
import { hideShowcaseWhy, showcaseOffEvent, SAMPLE_WHY_ID } from '../ui/sample-why.js';
import { researchActionsMethods, showcasePersonResearchActions } from '../ui/research-actions-ui.js';
import { contextMenuMethods } from '../ui/context-menu.js';

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

/** The opening tag of the element with this id (or class) in an HTML string. */
function tagOf(html: string, needle: string): string {
    return [...html.matchAll(/<(div|button)\b[^>]*>/g)].map(m => m[0]).find(t => t.includes(needle)) ?? '';
}

/** An element carrying a tag's attributes. */
function elementOf(tag: string): HTMLElement {
    const el = document.createElement('div');
    for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(m[1], m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    document.body.appendChild(el);
    return el;
}

const menuModel = () => ({
    foot: false, blocks: '', more: [], moreQuiet: [], moreAttention: '', note: 'opens in the research', waiting: 0, tools: [],
    first: [
        { id: 'research-item-send', label: 'Send to research', method: 'researchActionSend', ext: true },
        { id: 'research-item-chat', label: 'Continue with agent', method: 'researchActionChat', ext: true, ai: true },
        { id: 'research-item-knows', label: 'What the research knows', method: 'researchActionKnows' },
    ],
});

describe("the research menu in the showcase", () => {
    it('Send and Continue with agent greyed with their marks, never run; the other rows as they are', () => {
        const html = researchActionsMethods.researchMenuHtml.call({} as never, menuModel() as never);
        const send = tagOf(html, 'id="research-item-send"');
        expect(send).toContain('data-showcase-off="terminal"');
        expect(send).toContain('aria-disabled="true"');
        expect(send).not.toContain('onclick=');
        const chat = tagOf(html, 'id="research-item-chat"');
        expect(chat).toContain('data-showcase-off="agent"');
        expect(chat).toContain('data-showcase-label="Continue with agent"');
        expect(tagOf(html, 'id="research-item-knows"')).toContain('onclick=');
        const e = fakeEvent('click', elementOf(chat));
        expect(showcaseOffEvent(e)).toBe(true);
        expect(document.getElementById(SAMPLE_WHY_ID)!.querySelector('.what')!.textContent)
            .toBe('In full research: Continue with agent · AI + terminal');
    });

    it('outside the showcase as before', () => {
        showcase = false;
        const html = researchActionsMethods.researchMenuHtml.call({} as never, menuModel() as never);
        expect(html).not.toContain('data-showcase-off');
        expect(tagOf(html, 'id="research-item-send"')).toContain('onclick="window.Strom.UI.researchActionSend()"');
    });
});

describe("a person's Research › in the showcase", () => {
    it('Send to research and Ask the agent greyed with their marks; a click says why', () => {
        const items = showcasePersonResearchActions();
        expect(items.map(a => a.label)).toEqual(['Send to research', 'Ask the agent']);
        expect(items.every(a => a.disabled)).toBe(true);
        expect(items[1].badge).toBe('ai');
        const html = contextMenuMethods.contextMenuItemsHtml.call({ escapeHtml: (t: string) => t } as never, items);
        const ask = tagOf(html, 'data-showcase-label="Ask the agent"');
        expect(ask).toContain('data-showcase-off="agent"');
        expect(ask).not.toContain('data-action=');
        expect(tagOf(html, 'data-showcase-label="Send to research"')).toContain('data-showcase-off="terminal"');
        expect(showcaseOffEvent(fakeEvent('click', elementOf(ask)))).toBe(true);
        expect(document.getElementById(SAMPLE_WHY_ID)!.querySelector('.what')!.textContent)
            .toBe('In full research: Ask the agent · AI + terminal');
    });

    it("comes in place of the person's research actions only in the showcase", () => {
        const ui = { ...researchActionsMethods };
        expect(researchActionsMethods.personResearchActions.call(ui as never, 'p1' as never).map(a => a.action))
            .toEqual(['research-send', 'research-ask']);
        showcase = false;
        expect(showcasePersonResearchActions()).toEqual([]);
    });

    it('an ordinary greyed row keeps plain aria-disabled', () => {
        const html = contextMenuMethods.contextMenuItemsHtml.call({ escapeHtml: (t: string) => t } as never,
            [{ action: 'edit', label: 'Edit', disabled: true }]);
        expect(html).toContain('aria-disabled="true"');
        expect(html).not.toContain('data-showcase-off');
    });
});
