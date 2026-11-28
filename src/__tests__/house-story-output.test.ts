/**
 * What outputs show of a house's story (spec 145 T4, T8), "now" fixed at 20 Nov 2026: the approved text, or a draft
 * printed as the story (an approved one with a new version beside it as approved), whoever appears in it and whatever
 * it cites (T8 change, 28. 11.); left out only by a bulk output's option when a living person of the tree appears in
 * it. The house page: the story section in the app (draft tagged, approved, new version, its task) and in the file
 * (the story untagged, never Approve or Compare); without a story nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StromData } from '../types.js';
import type { HouseResearch, HouseStory } from '../house-bridge.js';
import { collectHouses, type TreeHouse } from '../houses.js';
import { housePrivacyContext, houseStoryForOutput, houseStoryNamesLiving } from '../house-privacy.js';
import { buildHousePage, housePageSections } from '../house-page.js';
import { HOUSE_ID, HOUSE_NOW, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const houseOf = (data: StromData, id: string): TreeHouse => collectHouses(data).find(h => h.id === id)!;
const TEXT = 'Grunt na návsi založil Svatobor Prouzal.\n\nPo něm hospodařil Hostivít.';
const OLD = [{ id: 'P0001', died: true }, { id: 'P0002', died: true }];

function withStory(story: HouseStory): HouseResearch {
    const r = houseResearch();
    r.id = 'A0001';
    r.story = story;
    return r;
}
type Told = Exclude<HouseStory, { status: null }>;
const final = (over: Partial<Told> = {}): Told =>
    ({ status: 'final', title: 'Grunt na návsi', text: TEXT, facts: ['e1', 'h1', 'h2'], sources: [{ source: 'S0001' }], at: '2026-11-20', people: OLD, ...over });

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUSE_NOW);
});
afterEach(() => vi.useRealTimers());

describe('houseStoryForOutput', () => {
    const data = houseTree();
    const ctx = housePrivacyContext(data, HOUSE_NOW);
    const of = (story: HouseStory, leaveOutLiving = false) => houseStoryForOutput(withStory(story), leaveOutLiving ? ctx : null);

    it('the approved text; with a new version beside it still the approved one; a draft as the story (T8)', () => {
        expect(of(final())).toEqual({ title: 'Grunt na návsi', text: TEXT, facts: ['e1', 'h1', 'h2'], sources: [{ source: 'S0001' }], at: '2026-11-20', people: OLD });
        const both = of(final({ draft: { text: 'Nová verze s Bohuslavou.', facts: [], sources: [], people: [{ id: 'P0005', died: false }] } }));
        expect(both?.text).toBe(TEXT);
        // A draft goes as the story, untagged (Milan 28. 11.).
        expect(of({ ...final(), status: 'draft' })).toEqual(of(final()));
        expect(of({ status: null, task: { id: 'T0001', state: 'open' } })).toBeNull();
        expect(houseStoryForOutput(null)).toBeNull();
    });

    // Changed 28. 11. (spec 145 T8 change): neither the people of the last ~100 years, nor a stranger, nor the facts
    // the output hides keep the story out; the living only by a bulk output's option.
    it('always, whoever appears in it and whatever it cites; the living left out only when the output asks', () => {
        const living = final({ people: [...OLD, { id: 'P0005', died: false }] });
        expect(of(living)?.text).toBe(TEXT);
        expect(of({ ...living, status: 'draft' })?.text).toBe(TEXT);
        expect(of(final({ people: [...OLD, { id: 'P0003', died: true }] }))?.text).toBe(TEXT);
        expect(of(final({ people: [{ id: 'P0777', died: false }] }))?.text).toBe(TEXT);
        expect(of(final({ facts: ['e1', 'e9'] }))?.text).toBe(TEXT);
        expect(of(final({ facts: ['e10'] }))?.text).toBe(TEXT);
        expect(of(final({ facts: ['h3'] }))?.text).toBe(TEXT);
        // The bulk outputs' option off: only a story with a living person of the tree is left out.
        expect(of(living, true)).toBeNull();
        expect(of({ ...living, status: 'draft' }, true)).toBeNull();
        expect(of(final({ people: [...OLD, { id: 'P0003', died: true }] }), true)?.text).toBe(TEXT);
        // A person of the research the tree does not know, not known dead, does not count as living.
        expect(of(final({ people: [{ id: 'P0777', died: false }] }), true)?.text).toBe(TEXT);
    });

    it('houseStoryNamesLiving: a living person of the tree in the story, a draft too; none without a story', () => {
        expect(houseStoryNamesLiving(withStory(final({ people: [...OLD, { id: 'P0005', died: false }] })), ctx)).toBe(true);
        expect(houseStoryNamesLiving(withStory({ ...final({ people: [{ id: 'P0005', died: false }] }), status: 'draft' }), ctx)).toBe(true);
        expect(houseStoryNamesLiving(withStory(final({ people: [...OLD, { id: 'P0003', died: true }, { id: 'P0777', died: false }] })), ctx)).toBe(false);
        expect(houseStoryNamesLiving(withStory({ status: null, task: { id: 'T0001', state: 'open' } }), ctx)).toBe(false);
        expect(houseStoryNamesLiving(null, ctx)).toBe(false);
    });
});

describe('the house page\'s story', () => {
    const data = houseTree();
    const house = houseOf(data, HOUSE_ID);
    const opts = { lang: 'en' as const, now: HOUSE_NOW };
    const app = (story: HouseStory, extra: Record<string, unknown> = {}) =>
        buildHousePage(data, house, withStory(story), 'app', { ...opts, research: true, app: { storyApproveHtml: '<button id="ap">A</button>', storyCompareHtml: '<button id="cmp">C</button>' }, ...extra });
    const storySection = (html: string) => {
        const at = html.indexOf('hp-sec--story');
        return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
    };

    it('in the app: an approved story with its title, its sources noted, before the other sections', () => {
        const html = app(final({ sources: [{ url: 'https://kronika.example.org/belokamen' }] }));
        const sec = storySection(html);
        expect(sec).toContain('Grunt na návsi');
        expect(sec).toContain('Svatobor Prouzal');
        expect(sec).not.toContain('hp-story--draft');
        expect(sec).not.toContain('id="ap"');
        expect(sec).toContain('hp-story-src');
        expect(sec).toContain('kronika.example.org');
        const keys = housePageSections(html, 'en').map(s => s.key);
        expect(keys.indexOf('story')).toBe(keys.indexOf('sum') + 1);
    });

    it('in the app: a draft marked, with Approve', () => {
        const sec = storySection(app({ ...final(), status: 'draft' }));
        expect(sec).toContain('hp-story--draft');
        expect(sec).toContain('hp-story-tag');
        expect(sec).toContain('id="ap"');
    });

    it('in the app: a new version beside the approved one — the approved text, the notice and Compare', () => {
        const sec = storySection(app(final({ draft: { text: 'Nová verze.', facts: [], sources: [], at: '2026-11-25', people: [] } })));
        expect(sec).toContain('hp-story-nv');
        expect(sec).toContain('id="cmp"');
        expect(sec).toContain('Svatobor Prouzal');
        expect(sec).not.toContain('Nová verze.');
    });

    it('in the app: the task\'s state while the story is written; a finished task with no text says nothing', () => {
        const sec = storySection(app({ status: null, task: { id: 'T0001', state: 'doing' } }));
        expect(sec).toContain('hp-story-task');
        expect(storySection(app({ status: null, task: { id: 'T0001', state: 'done' } }))).toBe('');
        // An approved story with its next version being written: the text and the task.
        expect(storySection(app(final({ task: { id: 'T0002', state: 'open' } })))).toContain('hp-story-task');
    });

    it('in the file: the story always, a draft as the story without its tag (T8); a task or a new version never', () => {
        const file = (story: HouseStory, extra: Record<string, unknown> = {}) =>
            storySection(buildHousePage(data, house, withStory(story), 'file', { ...opts, ...extra }));
        expect(file(final())).toContain('Svatobor Prouzal');
        expect(file(final())).not.toContain('hp-story-tag');
        const draft = file({ ...final(), status: 'draft' });
        expect(draft).toContain('Svatobor Prouzal');
        expect(draft).not.toContain('hp-story--draft');
        expect(draft).not.toContain('hp-story-tag');
        expect(draft).not.toContain('waiting for approval');
        expect(draft).not.toContain('<button');
        // Even with the window's buttons given, the file has none.
        const withActs = storySection(buildHousePage(data, house, withStory({ ...final(), status: 'draft' }), 'file',
            { ...opts, app: { storyApproveHtml: '<button id="ap">A</button>' } }));
        expect(withActs).not.toContain('id="ap"');
        // A living person in it: the saved page of the house shows it (spec 145 T8 change); a bulk output's option may not.
        const living = { ...final({ people: [...OLD, { id: 'P0005', died: false }] }), status: 'draft' as const };
        expect(file(living)).toContain('Svatobor Prouzal');
        expect(file(living, { storyLiving: false })).toBe('');
        expect(file(final(), { storyLiving: false })).toContain('Svatobor Prouzal');
        expect(file({ status: null, task: { id: 'T0001', state: 'doing' } })).toBe('');
        const both = file(final({ draft: { text: 'Nová verze.', facts: [], sources: [], people: [] } }));
        expect(both).not.toContain('Nová verze.');
        expect(both).not.toContain('hp-story-nv');
    });

    // Regression (Milan 28. 11.): a house whose story names a person who died in 1945 and cites a holder of 1939 —
    // the saved HTML had no story at all.
    it('in the file: a story of a person who died in 1945 citing a holder of 1939 is there', () => {
        const recent = houseTree();
        const lubor = Object.values(recent.persons).find(p => p.refn === 'P0003')!;
        lubor.deathDate = '1945';
        const r = withStory({ ...final({ facts: ['h1', 'h3'], people: [...OLD, { id: 'P0003', died: true }] }), status: 'draft' });
        r.holders = r.holders.map(h => h.id === 'h3' ? { ...h, from: '1912', to: '1939' } : h);
        const html = buildHousePage(recent, houseOf(recent, HOUSE_ID), r, 'file', opts);
        expect(storySection(html)).toContain('Svatobor Prouzal');
        expect(storySection(html)).toContain('Hostivít');
    });

    it('without a story: no section', () => {
        const html = buildHousePage(data, house, houseResearch(), 'app', opts);
        expect(html).not.toContain('hp-sec--story');
        expect(buildHousePage(data, house, houseResearch(), 'file', opts)).not.toContain('hp-sec--story');
    });
});
