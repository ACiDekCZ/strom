/**
 * The story of a house as the research really sends it (spec 145 T4): the fixture holds the bodies of
 * `GET /houses/<ref>` the research's houseView gave on a made-up village (its task queued, a draft, approved, a new
 * version beside the approved one), the reply of `POST /houses/story` as its bridge builds it, and an item of What
 * waits — the app's parsers read each one whole.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/research-house-story.json';
import { houseStoryReply, sanitizeHouseResearch } from '../house-bridge.js';
import { sanitizeWaiting } from '../research-link.js';

const F = ['house', 'house.story'];
const TEXT = 'Chalupu č. 14 držel od roku 1830 Trnoslav Mechovec. V roce 1866 nejspíš vyhořela.\n\nDruhý odstavec.';

describe('GET /houses/<ref> of the research: its story', () => {
    it('its task queued, no story yet', () => {
        const h = sanitizeHouseResearch(fixture.getQueued);
        expect(h?.key).toBe('mechov|14');
        expect(h?.story).toEqual({ status: null, task: { id: 'T0003', state: 'open' } });
    });

    it('a draft: title, paragraphs, facts of the house and its people, sources, the day, its people, its task', () => {
        const h = sanitizeHouseResearch(fixture.getDraft);
        expect(h?.story).toEqual({
            status: 'draft', title: 'Chalupa u rybníka', text: TEXT, facts: ['h1', 'e1', 'E0001'],
            sources: [{ source: 'S0001' }], at: '2026-11-27', people: [{ id: 'P0002', died: true }],
            task: { id: 'T0003', state: 'open' },
        });
        // The rest of the house reads as before.
        expect(h?.holders.map(x => x.id)).toEqual(['h1']);
        expect(h?.rev).toBe('3f9c2a71b0d84e65');
    });

    it('approved; approved with a new version beside it (no title, no sources)', () => {
        expect(sanitizeHouseResearch(fixture.getFinal)?.story).toMatchObject({ status: 'final', text: TEXT });
        const both = sanitizeHouseResearch(fixture.getFinalDraft)?.story;
        expect(both).toMatchObject({ status: 'final', text: TEXT, task: { id: 'T0003', state: 'done' } });
        expect(both && both.status === 'final' ? both.draft : null).toEqual({
            text: `${TEXT}\n\nPak dům koupil Kvasimír Mechovec.`, facts: ['h1', 'e1', 'E0001', 'h2'], sources: [],
            at: '2026-11-27', people: [{ id: 'P0002', died: true }],
        });
    });
});

describe('POST /houses/story of the research', () => {
    it('made, and made already (moved on top): the task, the house as GET says it', () => {
        const made = houseStoryReply(200, fixture.postMade, F);
        expect(made).toMatchObject({ ok: true, task: 'T0003', made: true, head: fixture.postMade.head, parent: fixture.postMade.parent });
        expect(made.ok && made.house?.story).toEqual({ status: null, task: { id: 'T0003', state: 'open' } });
        expect(houseStoryReply(200, fixture.postAgain, F)).toMatchObject({ ok: true, task: 'T0003', made: false });
    });
});

describe('What waits of the research: a house\'s new version', () => {
    it('is a house\'s story by its key, no person', () => {
        const [w] = sanitizeWaiting(fixture.waitingBeside, true);
        expect(w).toMatchObject({ id: 'A0001', kind: 'houseStory', house: 'mechov|14', section: 'decide' });
        expect(w).not.toHaveProperty('person');
    });
});
