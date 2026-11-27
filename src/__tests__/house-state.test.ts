/**
 * The research's state of a house (spec 030 §2, K7.5): the badge of every state (none = only a house the research
 * lists; queued with work "takeover" = own research waiting to be taken over; waiting with its "Answer"), the
 * town's summary in Places, and the task kind `house` in the queue (`kind=house`, `known=house`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { houseStateHtml, houseTownStatesText } from '../ui/house-state-ui.js';
import { queuePageQuery } from '../research-queue-pages.js';
import { QUEUE_TASK_KINDS } from '../research-link.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import { HouseResearchCache, sanitizeHouseResearch, sanitizeHouseRow } from '../house-bridge.js';

afterEach(() => setLanguage('cs'));

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('houseStateHtml', () => {
    it('draws nothing for a house the research does not list', () => {
        setLanguage('cs');
        expect(houseStateHtml(null, { lang: 'cs' })).toBe('');
        expect(houseStateHtml(undefined, { lang: 'cs', answer: true })).toBe('');
    });

    it('none: "not researched" as a quiet text', () => {
        setLanguage('cs');
        const html = houseStateHtml({ state: 'none' }, { lang: 'cs' });
        expect(html).toContain('class="hs is-text"');
        expect(text(html)).toBe('nezkoumáno');
    });

    it('queued, running (with its dot), held', () => {
        setLanguage('cs');
        expect(text(houseStateHtml({ state: 'queued' }, { lang: 'cs' }))).toBe('ve frontě');
        const running = houseStateHtml({ state: 'running' }, { lang: 'cs' });
        expect(running).toContain('hs-pulse');
        expect(text(running)).toBe('zkoumá se');
        const held = houseStateHtml({ state: 'held' }, { lang: 'cs' });
        expect(held).toContain('is-text');
        expect(text(held)).toBe('odloženo');
    });

    it('a queued task of the house\'s look (spec 145 T1) says so; running and done as any other', () => {
        setLanguage('cs');
        expect(text(houseStateHtml({ state: 'queued', work: 'house', look: true }, { lang: 'cs' }))).toBe('ve frontě: podoba domu');
        expect(text(houseStateHtml({ state: 'running', work: 'house', look: true }, { lang: 'cs' }))).toBe('zkoumá se');
        setLanguage('de');
        expect(text(houseStateHtml({ state: 'queued', look: true }, { lang: 'de' }))).toBe('in der Warteschlange: Aussehen des Hauses');
    });

    it('done: a tag with ✓ (aria-hidden) and its date in the app\'s language; plain in a line of words', () => {
        setLanguage('cs');
        const cs = houseStateHtml({ state: 'done', at: '2027-03-12T10:20:00Z' }, { lang: 'cs' });
        expect(cs).toContain('class="hs is-done"');
        expect(cs).toContain('<span class="hs-ok" aria-hidden="true">✓</span>');
        expect(text(cs)).toBe('✓ hotovo 12. 3. 2027');
        setLanguage('en');
        expect(text(houseStateHtml({ state: 'done', at: '2027-03-12' }, { lang: 'en' }))).toBe('✓ done 12 Mar 2027');
        expect(text(houseStateHtml({ state: 'done' }, { lang: 'en' }))).toBe('✓ done');
        const plain = houseStateHtml({ state: 'done', at: '2027-03-12' }, { lang: 'en', plain: true });
        expect(plain).not.toContain('✓');
        expect(text(plain)).toBe('done 12 Mar 2027');
    });

    it('queued with work "takeover": waiting to be taken over, with its note', () => {
        setLanguage('cs');
        const html = houseStateHtml({ state: 'queued', work: 'takeover' }, { lang: 'cs' });
        expect(html).toContain('data-state="takeover"');
        expect(text(html)).toBe('rešerše čeká na převzetí převezme agent v příštím sezení');
        expect(text(houseStateHtml({ state: 'queued', work: 'house' }, { lang: 'cs' }))).toBe('ve frontě');
    });

    it('waiting: a warning tag; "Answer" (no mark) carries the question\'s task', () => {
        setLanguage('en');
        const row = { state: 'waiting' as const, question: { id: 'T0042', text: 'Which number?' } };
        const html = houseStateHtml(row, { lang: 'en', answer: true });
        expect(html).toContain('class="hs is-wait"');
        expect(html).toContain('data-question="T0042"');
        expect(text(html)).toBe('waiting for an answer Answer');
        expect(html).not.toMatch(/research-open-mark|ai-badge/);
        expect(houseStateHtml(row, { lang: 'en' })).not.toContain('house-answer');
        expect(houseStateHtml({ state: 'waiting' }, { lang: 'en', answer: true })).not.toContain('house-answer');
    });

    it('escapes the question\'s text', () => {
        setLanguage('en');
        const html = houseStateHtml({ state: 'waiting', question: { id: 'T1', text: '<b>"x"</b>' } }, { lang: 'en', answer: true });
        expect(html).not.toContain('<b>');
        expect(html).toContain('&lt;b&gt;&quot;x&quot;');
    });

    it('every language has every state', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const st = getStringsForLang(lang).houses.st;
            for (const v of [st.none, st.queued, st.running, st.done('x'), st.waiting, st.held, st.takeover]) expect(v.length).toBeGreaterThan(1);
            expect(getStringsForLang(lang).houses.answer.length).toBeGreaterThan(1);
        }
    });
});

describe('houseTownStatesText', () => {
    it('counts a town\'s houses per state, the states without a house left out', () => {
        setLanguage('cs');
        expect(houseTownStatesText([{ state: 'done' }, { state: 'running' }, { state: 'none' }, { state: 'none' }], 'cs')).toBe('1 hotovo, 1 zkoumá se');
        expect(houseTownStatesText([{ state: 'none' }], 'cs')).toBe('');
        expect(houseTownStatesText([], 'cs')).toBe('');
    });
});

describe('the task kind house', () => {
    const house = ['house'];
    const both = ['census', 'house'];

    it('is a kind of the queue with a label in every language', () => {
        expect(QUEUE_TASK_KINDS).toContain('house');
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) expect(getStringsForLang(lang).live.taskKinds.house).toBeTruthy();
        expect(getStringsForLang('cs').live.taskKinds.house).toBe('Domy');
    });

    it('kind=house goes only to a research with the feature', () => {
        expect(queuePageQuery({ kind: 'house' }, 0, 50, house).toString()).toBe('count=50&kind=house');
        expect(queuePageQuery({ kind: 'house' }, 0, 50, ['census']).has('kind')).toBe(false);
        expect(queuePageQuery({ kind: 'house' }, 0, 50).has('kind')).toBe(false);
    });

    it('kind=other leaves house tasks out with known=house (and census too)', () => {
        expect(queuePageQuery({ kind: 'other' }, 0, 50, house).toString()).toBe('count=50&kind=other&known=house');
        expect(queuePageQuery({ kind: 'other' }, 0, 50, both).toString()).toBe('count=50&kind=other&known=census%2Chouse');
    });
});

describe('a house the research knows by a material or a task only (no record yet)', () => {
    // GET /houses lists it without `id` (strom-research listRow): it still has a state ("not researched").
    const noRecord = {
        key: 'belokamen|16', place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16', persons: 2, state: 'none',
        summary: { events: 0, holders: 0, residents: 0, unknown: 0, materials: 1, passed: 0 },
    };

    it('its row is kept, without an id', () => {
        const row = sanitizeHouseRow(noRecord);
        expect(row).not.toBeNull();
        expect(row!.id).toBeUndefined();
        expect(row!.state).toBe('none');
        expect(row!.summary.materials).toBe(1);
    });

    it('its whole result is kept (its materials listed) and cached by key', () => {
        const h = sanitizeHouseResearch({ ...noRecord, persons: [], materials: [{ id: 'I0004', kind: 'memory', title: 'U Prouzalů', at: '2026-11-26' }] });
        expect(h).not.toBeNull();
        expect(h!.materials.map(m => m.id)).toEqual(['I0004']);
        const cache = new HouseResearchCache();
        cache.put(h!);
        cache.putList('r1', [sanitizeHouseRow(noRecord)!]);
        expect(cache.get('belokamen|16')?.materials).toHaveLength(1);
    });
});
