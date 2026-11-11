/**
 * The menu of a card's stack of marks (two or three signals): its choices
 * and their order (what waits with its line, the story, what the research
 * knows as one choice, the agent at work), the touch texts, no research
 * mark on any choice, no fact check and no other tree; its place at the
 * stack, fitted into the window; its name in four languages; a click with
 * one choice only goes straight to what the research knows, without a menu.
 * Invented people.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Person, PersonId, ResearchConflict, StromData } from '../types.js';
import { CardSignalContext, CardSignalInfo, cardSignalInfo } from '../card-signals.js';
import { placeStackMenu, stackMenuItemsHtml } from '../card-signal-marks.js';
import { CARD_SIGNAL_DEFAULTS, CardSignals } from '../settings.js';
import { createEmptyData } from '../data.js';
import { setLanguage, strings } from '../strings.js';
import { TreeRenderer } from '../renderer.js';
import { cardSignalsUiMethods } from '../ui/card-signals-ui.js';

afterEach(() => {
    setLanguage('en');
    vi.restoreAllMocks();
});

const conflict = (id: string): ResearchConflict => ({ id, fact: 'BIRT', status: 'open', values: [] }) as ResearchConflict;

function person(extra: Partial<Person> = {}): Person {
    return {
        id: 'p1' as PersonId, firstName: 'Ottilie', lastName: 'Brandauer', gender: 'female',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], refn: 'P0001', ...extra,
    } as Person;
}

function signalsOf(p: Person, opts: { waiting?: string; waitingStory?: boolean; agent?: string; settings?: Partial<CardSignals> } = {}): CardSignalInfo {
    const data: StromData = createEmptyData();
    data.persons[p.id] = p;
    const ctx: CardSignalContext = {
        data, unions: new Map(), treeHasSources: false,
        reliability: { researchTree: false, originFeature: false },
        settings: { ...CARD_SIGNAL_DEFAULTS, ...opts.settings },
        research: new Map([['P0001', { waiting: opts.waiting, waitingStory: opts.waitingStory, agent: opts.agent }]]),
    };
    return cardSignalInfo(p, ctx);
}

const WAITING = 'Confirm the marriage record of 1891 in Hollendorf';
const all = (extra: { waitingStory?: boolean; agent?: string } = {}): CardSignalInfo => signalsOf(person({
    question: 'Who was the godfather at the baptism?',
    research: { conflicts: [conflict('X0001'), conflict('X0002')], hypotheses: [{ title: 'The miller of Hollendorf was her father' }] },
} as Partial<Person>), { waiting: WAITING, ...extra });

/** The data-action of each choice, in order. */
const actionsOf = (html: string): string[] => [...html.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]);

describe('the stack menu’s choices', () => {
    it('in order: answer what waits, compare the story, what the research knows, follow the research', () => {
        const html = stackMenuItemsHtml(all({ waitingStory: true, agent: 'Reading the parish register' }),
            { touch: false, waitingCount: 3, itemClass: 'context-menu-item' });
        expect(actionsOf(html)).toEqual(['signal-waiting', 'signal-story-compare', 'signal-knows', 'signal-agent']);
        const c = strings.card;
        expect(html).toContain(c.menuAnswer(3));
        expect(html).toContain(strings.story.compare);
        expect(html).toContain(c.menuKnows(`${c.ttConflicts(2)}, ${c.ttHypotheses(1)}, ${c.menuQuestions(1)}`));
        expect(html).toContain(c.menuAgent);
        // Every choice is a menu item reached by the arrows.
        expect(html.match(/role="menuitem" tabindex="-1"/g)).toHaveLength(4);
    });

    it('under "Answer" a line with what waits first; no other choice has one', () => {
        const html = stackMenuItemsHtml(all(), { touch: false, waitingCount: 1, itemClass: 'context-menu-item' });
        expect(actionsOf(html)).toEqual(['signal-waiting', 'signal-knows']);
        expect(html.match(/menu-act-sub/g)).toHaveLength(1);
        expect(html).toContain(`<span class="menu-act-sub">${WAITING}</span>`);
        // The line sits inside the item's text: its name is the text and the line.
        expect(html).toMatch(/<span class="menu-act-text">[^<]+<span class="menu-act-sub">/);
    });

    it('by touch: "Waiting for you" (the panel at the person’s items) in place of the answer, as buttons in the sheet', () => {
        const html = stackMenuItemsHtml(all(), { touch: true, waitingCount: 2, itemClass: 'bottom-sheet-item' });
        expect(actionsOf(html)).toEqual(['signal-waiting-list', 'signal-knows']);
        expect(html).toContain(strings.card.menuWaiting(2));
        expect(html.match(/<button type="button" class="bottom-sheet-item menu-act/g)).toHaveLength(2);
    });

    it('no research mark on a choice (all stay in the app), no fact check, no other tree', () => {
        const html = stackMenuItemsHtml(all({ waitingStory: true, agent: 'Reading' }), { touch: false, waitingCount: 1, itemClass: 'context-menu-item' });
        expect(html).not.toMatch(/research-open-mark|research-ai-badge|research-open-sr|[◆↗]/);
        expect(html).not.toMatch(/signal-verify|cross-tree/);
    });

    it('a conflict and a question without what waits: one choice', () => {
        const s = signalsOf(person({ question: 'Q', research: { conflicts: [conflict('X0001')] } } as Partial<Person>));
        expect(actionsOf(stackMenuItemsHtml(s, { touch: false, waitingCount: 1, itemClass: 'context-menu-item' }))).toEqual(['signal-knows']);
    });

    it('the texts stay escaped', () => {
        const html = stackMenuItemsHtml(signalsOf(person({ question: 'Q' }), { waiting: 'A <b>"bold"</b> & task' }),
            { touch: false, waitingCount: 1, itemClass: 'context-menu-item' });
        expect(html).toContain('A &lt;b&gt;&quot;bold&quot;&lt;/b&gt; &amp; task');
    });
});

describe('the stack menu’s name', () => {
    it('the person and what waits, in en, cs, de and pl', () => {
        const expected: Record<string, string> = {
            en: 'Ottilie Brandauer: what waits',
            cs: 'Ottilie Brandauer: co čeká',
            de: 'Ottilie Brandauer: was wartet',
            pl: 'Ottilie Brandauer: co czeka',
        };
        for (const [lang, label] of Object.entries(expected)) {
            setLanguage(lang as 'en' | 'cs' | 'de' | 'pl');
            expect(strings.card.stackMenuLabel('Ottilie Brandauer')).toBe(label);
        }
    });
});

describe('the answer choice in German', () => {
    it('agrees with any count (no singular verb after a plural count)', () => {
        setLanguage('de');
        expect(strings.card.menuAnswer(1)).toBe('Antworten · 1 wartend');
        expect(strings.card.menuAnswer(2)).toBe('Antworten · 2 wartend');
    });
});

describe('the stack menu’s place', () => {
    const view = { width: 1440, height: 900 };
    const menu = { width: 280, height: 160 };
    const stack = (left: number, top: number) => ({ left, top, right: left + 32, bottom: top + 20 });

    it('under the stack, its left edge at the stack’s', () => {
        expect(placeStackMenu(stack(400, 300), menu, view)).toEqual({ left: 400, top: 326, maxHeight: null });
    });

    it('no room on the right: its right edge at the stack’s, kept in the window', () => {
        expect(placeStackMenu(stack(1300, 300), menu, view)).toEqual({ left: 1332 - 280, top: 326, maxHeight: null });
        expect(placeStackMenu(stack(1420, 300), menu, view).left).toBe(1440 - 280 - 8);
        expect(placeStackMenu(stack(2, 300), menu, view).left).toBe(8);
    });

    it('no room below: above the stack', () => {
        expect(placeStackMenu(stack(400, 800), menu, view)).toEqual({ left: 400, top: 800 - 6 - 160, maxHeight: null });
    });

    it('room neither below nor above (a phone held sideways): at the window’s top, as tall as the window allows', () => {
        expect(placeStackMenu(stack(400, 150), { width: 280, height: 330 }, { width: 844, height: 390 }))
            .toEqual({ left: 400, top: 8, maxHeight: 390 - 16 });
    });
});

describe('a click on the stack', () => {
    const fakeUi = () => ({
        openPersonResearchKnows: vi.fn(),
        hideContextMenu: vi.fn(),
        runPersonMenuAction: vi.fn(),
    });

    it('with one choice only (conflicts and a question): straight to what the research knows, no menu', () => {
        const s = signalsOf(person({ question: 'Q', research: { conflicts: [conflict('X0001')] } } as Partial<Person>));
        vi.spyOn(TreeRenderer, 'cardSignalsFor').mockReturnValue(s);
        const ui = fakeUi();
        cardSignalsUiMethods.openCardSignalsMenu.call(ui as never, 'p1' as PersonId, {} as HTMLElement, false);
        expect(ui.openPersonResearchKnows).toHaveBeenCalledWith('p1');
        expect(ui.hideContextMenu).not.toHaveBeenCalled();
    });

    it('with two choices: no straight jump (the menu opens)', () => {
        vi.spyOn(TreeRenderer, 'cardSignalsFor').mockReturnValue(all());
        const ui = fakeUi();
        // Without a page the menu cannot be built; what matters is that it did not jump.
        try { cardSignalsUiMethods.openCardSignalsMenu.call(ui as never, 'p1' as PersonId, {} as HTMLElement, false); } catch { /* no DOM */ }
        expect(ui.openPersonResearchKnows).not.toHaveBeenCalled();
        expect(ui.hideContextMenu).toHaveBeenCalled();
    });
});
