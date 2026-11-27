/**
 * What outputs show of a house's story (spec 145 T4), "now" fixed at 20 Nov 2026: the approved text only (a draft
 * never, an approved one with a new version beside it as approved), left out whole when it names a living person, one
 * of the last ~100 years or a person of the research the tree does not know whose death is not known, or rests on an
 * item the output leaves out. The house page: the story section in the app (draft, approved, new version, its task)
 * and in the file (approved only, the filter); without a story nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StromData } from '../types.js';
import type { HouseResearch, HouseStory } from '../house-bridge.js';
import { collectHouses, type TreeHouse } from '../houses.js';
import { houseOutputFilter, housePrivacyContext, houseStoryForOutput } from '../house-privacy.js';
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
    const house = houseOf(data, HOUSE_ID);
    const ctx = housePrivacyContext(data, HOUSE_NOW);
    const of = (story: HouseStory) => {
        const r = withStory(story);
        return houseStoryForOutput(r, houseOutputFilter(house, r, data, HOUSE_NOW, ctx), ctx);
    };

    it('the approved text only; with a new version beside it still the approved one; a draft never', () => {
        expect(of(final())).toEqual({ title: 'Grunt na návsi', text: TEXT, facts: ['e1', 'h1', 'h2'], sources: [{ source: 'S0001' }], at: '2026-11-20', people: OLD });
        const both = of(final({ draft: { text: 'Nová verze s Bohuslavou.', facts: [], sources: [], people: [{ id: 'P0005', died: false }] } }));
        expect(both?.text).toBe(TEXT);
        expect(both).not.toHaveProperty('draft');
        expect(of({ ...final(), status: 'draft' })).toBeNull();
        expect(of({ status: null, task: { id: 'T0001', state: 'open' } })).toBeNull();
        expect(houseStoryForOutput(null, houseOutputFilter(house, null, data, HOUSE_NOW, ctx), ctx)).toBeNull();
    });

    it('left out whole when it names the living, a person of the last ~100 years, or a stranger not known dead', () => {
        expect(of(final({ people: [...OLD, { id: 'P0005', died: false }] }))).toBeNull();
        expect(of(final({ people: [...OLD, { id: 'P0003', died: true }] }))).toBeNull();
        expect(of(final({ people: [{ id: 'P0777', died: false }] }))).toBeNull();
        expect(of(final({ people: [{ id: 'P0777', died: true }] }))?.text).toBe(TEXT);
    });

    it('left out when it rests on what the output hides: a sensitive event, a recent one, a holder without years', () => {
        expect(of(final({ facts: ['e1', 'e9'] }))).toBeNull();
        expect(of(final({ facts: ['e10'] }))).toBeNull();
        expect(of(final({ facts: ['h3'] }))).toBeNull();
        // A fact of a person, not an item of the house, is judged by its people.
        expect(of(final({ facts: ['e1', 'F0042'] }))?.text).toBe(TEXT);
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

    it('in the file: the approved story through the filter; a draft, a task or a protected person never', () => {
        const file = (story: HouseStory) => storySection(buildHousePage(data, house, withStory(story), 'file', opts));
        expect(file(final())).toContain('Svatobor Prouzal');
        expect(file({ ...final(), status: 'draft' })).toBe('');
        expect(file({ status: null, task: { id: 'T0001', state: 'doing' } })).toBe('');
        expect(file(final({ people: [...OLD, { id: 'P0005', died: false }] }))).toBe('');
        const both = file(final({ draft: { text: 'Nová verze.', facts: [], sources: [], people: [] } }));
        expect(both).not.toContain('Nová verze.');
        expect(both).not.toContain('hp-story-nv');
    });

    it('without a story: no section', () => {
        const html = buildHousePage(data, house, houseResearch(), 'app', opts);
        expect(html).not.toContain('hp-sec--story');
        expect(buildHousePage(data, house, houseResearch(), 'file', opts)).not.toContain('hp-sec--story');
    });
});
