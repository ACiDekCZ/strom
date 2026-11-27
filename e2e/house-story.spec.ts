import { test, expect, Page, Route, BrowserContext } from '@playwright/test';
import { fakeBridge, links, openResearch, poll, BRIDGE } from './research-bridge.js';

/**
 * The story of a house (spec 145 T4): with `house.story` the house page shows the research's story above its
 * sections — a draft with Approve (the research's link), the approved text, a new version beside it with Compare; ⋯
 * "Write the story of the house" asks the agent through the bridge (POST /houses/story, the AI badge alone) and the
 * page shows the task's state; an older research without the feature offers and shows nothing. Under a person's
 * story the house's story is a link; the family book's Houses chapter has the approved story only, never a draft or
 * one naming a living person; What waits leads to the house's page at its story.
 * A fake bridge with invented data: the Fíšek family of Bělokamen čp. 16.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'story'];
const FEATURES = ['house', 'house.material', 'house.request', 'house.confirm', 'house.story'];
const KEY = 'belokamen|16';
const NOW = new Date('2027-03-20T10:30:00Z');

type Story = Record<string, unknown> | null;

const VERSION = {
    title: 'Grunt na návsi', text: 'Stavení postavil roku 1830 Josef Fíšek.\n\nRoku 1868 ho zasáhl požár obce.',
    facts: ['e1', 'e2', 'h1'], sources: ['S0001'], at: '2027-03-01T09:00:00Z', people: [{ id: 'P0001', died: true }],
};
const DRAFT: Story = { status: 'draft', ...VERSION, task: { id: 'T0042', state: 'done' } };
const FINAL: Story = { status: 'final', ...VERSION };
const BESIDE: Story = {
    status: 'final', ...VERSION,
    draft: { text: `${VERSION.text}\n\nNový krov dostal roku 1871.`, facts: ['e1', 'e2', 'e3', 'h1'], at: '2027-03-15T09:00:00Z', people: VERSION.people },
};

function row(): Record<string, unknown> {
    return {
        id: 'A0001', key: KEY, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16',
        persons: 2, years: { from: 1820, to: 1880 }, state: 'done', at: '2027-03-01T09:00:00Z',
        summary: { events: 3, holders: 1, residents: 1, unknown: 0, materials: 0, passed: 0 },
    };
}

function detail(story: Story): Record<string, unknown> {
    return {
        ...row(),
        numbers: [{ id: 'n1', number: '16', from: '1836', sources: [{ source: 'S0001' }] }],
        timeline: [
            { id: 'e1', kind: 'built', date: '1830', text: 'Stavení postaveno', sources: [{ source: 'S0001' }] },
            { id: 'e2', kind: 'fire', date: '1868', text: 'Požár obce', sources: [] },
            { id: 'e3', kind: 'other', date: '1871', text: 'Nový krov', sources: [] },
        ],
        holders: [{ id: 'h1', name: 'Josef Fíšek', person: 'P0001', from: '1845', to: '1880', how: 'inheritance', sources: [{ source: 'S0001' }] }],
        residents: [{ id: 'r1', name: 'Jan Fíšek', person: 'P0003', role: 'farmer', from: '1850', to: '1880', sources: [] }],
        unknown: [], passed: [], maps: [], manual: [], archiveOnly: [], sensitive: [], same: [], materials: [],
        ...(story ? { story } : {}),
    };
}

interface Fake {
    story: Story;
    asks: unknown[];
    /** `made` of the next POST /houses/story. */
    made: boolean;
}

async function setup(page: Page, opts: { story?: Story; features?: string[]; waiting?: unknown[]; recent?: boolean; realClock?: boolean } = {}): Promise<Fake> {
    if (!opts.realClock) await page.clock.setFixedTime(NOW);
    const fake: Fake = { story: opts.story ?? null, asks: [], made: true };
    await fakeBridge(page, {
        features: opts.features ?? FEATURES, links: LINKS, ...(opts.waiting ? { waiting: opts.waiting } : {}),
        statusExtra: { houses: { on: false, rev: 'r1', counts: { done: 1, running: 0, queued: 0, waiting: 0, held: 0 } } },
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: 'r1', houses: [row()] }) });
    });
    await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), async (route: Route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/houses\//, ''));
        if (route.request().method() === 'POST' && path === 'story') {
            fake.asks.push(JSON.parse(route.request().postData() ?? 'null'));
            // Its task on top of the queue: a story to come, or the one there stays with its new task.
            fake.story = fake.story ? { ...fake.story, task: { id: 'T0042', state: 'open' } } : { status: null, task: { id: 'T0042', state: 'open' } };
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ house: { ...detail(fake.story), rev: 'r2' }, task: 'T0042', made: fake.made, head: 'a1b2c3d4e5f6', parent: '9b8c7d6e5f40' }) });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...detail(fake.story), rev: 'r1' }) });
    });
    await openResearch(page);
    await placeFamily(page, opts.recent);
    await poll(page);
    return fake;
}

/** Josef (1820–1880) and his son Jan (1850), each with a story of his own, at čp. 16; with `recent` also Anna, born there in 1950. */
async function placeFamily(page: Page, recent = false): Promise<void> {
    await page.evaluate(recent => {
        const dm = window.Strom.DataManager;
        for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
            if (p.firstName === 'Josef') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
                    deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1880',
                    story: { status: 'final', text: 'Josef vyrostl na gruntu a hospodařil na něm do smrti.' } } as never);
            }
            if (p.firstName === 'Jan') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850', deathDate: '1912',
                    story: { status: 'final', text: 'Jan hospodařil po otci na gruntu.' } } as never);
            }
            if (recent && p.firstName === 'Anna') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1950' } as never);
            }
        }
    }, recent);
}

const pageWin = (page: Page) => page.locator('#house-page-modal');
const storySec = (page: Page) => pageWin(page).locator('#hp-sec-story');

async function openPage(page: Page): Promise<void> {
    await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
    await expect(pageWin(page).locator('#hp-title')).toHaveText('Bělokamen čp. 16');
    // The research's result arrives and the page draws it.
    await expect(pageWin(page).locator('#hp-sec-people')).toBeVisible();
}

/** The ids of the page's sections in order. */
const sectionOrder = (page: Page) => pageWin(page).locator('section[id^="hp-sec-"]').evaluateAll(els => els.map(e => e.id));

test.describe('The story of a house on its page', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a draft: marked as waiting, above the other sections; Approve hands over the research\'s link', async ({ page }) => {
        await setup(page, { story: DRAFT });
        await openPage(page);
        const sec = storySec(page);
        await expect(sec.locator('.hp-story-tag')).toHaveText('draft, waiting for approval');
        await expect(sec.locator('.hp-story-title')).toHaveText('Grunt na návsi');
        await expect(sec.locator('.hp-story-prose p')).toHaveText(['Stavení postavil roku 1830 Josef Fíšek.', 'Roku 1868 ho zasáhl požár obce.']);
        const order = await sectionOrder(page);
        expect(order.indexOf('hp-sec-story')).toBeLessThan(order.indexOf('hp-sec-numbers'));
        expect(order.indexOf('hp-sec-story')).toBeLessThan(order.indexOf('hp-sec-timeline'));
        await expect(sec.locator('.hp-story-nv')).toHaveCount(0);
        const approve = sec.locator('[data-hp-act="story-approve"]');
        await expect(approve).toContainText('Approve');
        await approve.click();
        await expect.poll(() => links(page)).toHaveLength(1);
        expect((await links(page))[0]).toMatch(/^strom-research[a-z0-9-]*:\/\/story\?tree=[^&]+&house=A0001&do=final$/);
    });

    test('approved: the text alone, no tag, no Approve', async ({ page }) => {
        await setup(page, { story: FINAL });
        await openPage(page);
        const sec = storySec(page);
        await expect(sec.locator('.hp-story-prose')).toContainText('Stavení postavil roku 1830 Josef Fíšek.');
        await expect(sec.locator('.hp-story-tag, .hp-story-nv, [data-hp-act="story-approve"]')).toHaveCount(0);
    });

    test('a new version beside the approved one: its notice and Compare, the approved text on the page', async ({ page }) => {
        await setup(page, { story: BESIDE });
        await openPage(page);
        const nv = storySec(page).locator('.hp-story-nv');
        await expect(nv).toContainText('A new version of the story (15 Mar 2027) waits for approval; the page shows the approved text.');
        await expect(storySec(page).locator('.hp-story-prose')).not.toContainText('Nový krov dostal');
        await nv.locator('[data-hp-act="story-compare"]').click();
        const cmp = page.locator('#story-compare-modal');
        await expect(cmp).toBeVisible();
        await expect(cmp).toContainText('Nový krov dostal roku 1871.');
    });

    test('⋯ "Write the story of the house": through the bridge with the AI badge alone; the task\'s state, made or moved', async ({ page }) => {
        const fake = await setup(page);
        await openPage(page);
        const win = pageWin(page);
        await expect(storySec(page)).toHaveCount(0);
        await win.locator('.pp-more').click();
        const item = win.locator('.pp-menu [data-hp-menu="story"]');
        await expect(item).toHaveText(/^Write the story of the house/);
        await expect(item.locator('.research-ai-badge')).toHaveCount(1);
        await expect(item.locator('.research-open-mark')).toHaveCount(0);
        await item.click();
        await expect.poll(() => fake.asks).toEqual([{ house: 'A0001' }]);
        await expect(page.locator('.toast', { hasText: 'The agent’s task to write the story is at the top of the research queue.' })).toBeVisible();
        await expect(storySec(page).locator('.hp-story-task')).toHaveText('The story of the house is in the research queue.');
        // No terminal: no research link handed over.
        expect(await links(page)).toEqual([]);

        // Asked again: the task was there already, moved on top.
        fake.made = false;
        await win.locator('.pp-more').click();
        await win.locator('.pp-menu [data-hp-menu="story"]').click();
        await expect.poll(() => fake.asks.length).toBe(2);
        await expect(page.locator('.toast', { hasText: 'The task already existed; it moved to the top of the research queue.' })).toBeVisible();
    });

    test('with a story: ⋯ offers a new version', async ({ page }) => {
        await setup(page, { story: FINAL });
        await openPage(page);
        const win = pageWin(page);
        await win.locator('.pp-more').click();
        await expect(win.locator('.pp-menu [data-hp-menu="story"]')).toHaveText(/^Write a new version of the story/);
    });

    test('an older research without house.story: nothing offered, nothing shown', async ({ page }) => {
        await setup(page, { features: FEATURES.filter(f => f !== 'house.story') });
        await openPage(page);
        const win = pageWin(page);
        await expect(storySec(page)).toHaveCount(0);
        await win.locator('.pp-more').click();
        await expect(win.locator('.pp-menu')).toBeVisible();
        await expect(win.locator('.pp-menu [data-hp-menu="story"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        // The Houses window's ⋯ neither.
        await page.evaluate(() => window.Strom.UI.closeHousePage());
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        const houseRow = page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);
        await expect(houseRow).toBeVisible();
        await houseRow.locator('.house-more-btn').click();
        const menu = page.locator('.houses-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-action="story"]')).toHaveCount(0);
    });
});

test.describe('The story of a house elsewhere', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    const janId = (page: Page) => page.evaluate(() =>
        (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);

    test('under the person\'s story: "House čp. 16 ›" to the house\'s story; none for a draft', async ({ page }) => {
        await setup(page, { story: FINAL });
        const jan = await janId(page);
        await page.evaluate(id => window.Strom.UI.showPersonPage(id as never), jan);
        const person = page.locator('#person-page-modal');
        const link = person.locator('#pp-sec-story .pp-story-houses [data-pp-house]');
        await expect(link).toHaveText('House čp. 16 ›');
        // The house's text is not repeated on the person's page.
        await expect(person).not.toContainText('Stavení postavil roku 1830');
        await link.click();
        await expect(pageWin(page).locator('#hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(storySec(page)).toBeInViewport();
    });

    test('a draft: no link under the person\'s story', async ({ page }) => {
        await setup(page, { story: DRAFT });
        const jan = await janId(page);
        await page.evaluate(id => window.Strom.UI.showPersonPage(id as never), jan);
        const person = page.locator('#person-page-modal');
        await expect(person.locator('#pp-sec-story')).toContainText('Jan hospodařil');
        // The detail read (the Houses row of Places has its link), still no story link.
        await expect(person.locator('.pp-houses [data-pp-house]')).toBeVisible();
        await expect(person.locator('.pp-story-houses')).toHaveCount(0);
    });

    test('What waits: the house\'s story, its row opens the house\'s page at the story', async ({ page }) => {
        const item = { id: 'A0001', kind: 'story', house: KEY, what: 'Nová verze vyprávění o domě Bělokamen 16 – schválené zůstává až do rozhodnutí',
            on: '', at: '2027-03-15T09:00:00Z', section: 'decide', phase: 'todo', actions: [] };
        await setup(page, { story: BESIDE, waiting: [item] });
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        const entry = ov.locator('li.research-overview__waiting-item', { hasText: 'The story of house čp. 16 waits for approval' });
        await expect(entry).toHaveCount(1);
        // Its row opens the detail; "House čp. 16 ›" there opens the house's page at the story.
        const wrow = entry.locator('.research-overview__waiting-row');
        if (await wrow.getAttribute('aria-expanded') !== 'true') await wrow.click();
        await expect(wrow).toHaveAttribute('aria-expanded', 'true');
        // The row's text once (1128): the detail holds only the way to the page.
        const detail = entry.locator('.research-overview__waiting-detail');
        await expect(detail).not.toContainText('waits for approval');
        await expect(detail.locator('.live-kind-story')).toHaveCount(0);
        const link = entry.locator('.research-overview__waiting-actions button', { hasText: 'House čp. 16 ›' });
        await expect(link).toBeVisible();
        await link.click();
        await expect(pageWin(page).locator('#hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(storySec(page)).toBeVisible();
        await expect(storySec(page)).toBeInViewport();
    });
});

async function openBook(page: Page, context: BrowserContext): Promise<Page> {
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    const part = dialog.locator('.book-part[data-part="houses"] input');
    if (!(await part.isChecked())) await part.check();
    const [book] = await Promise.all([context.waitForEvent('page'), dialog.locator('#book-open').click()]);
    await book.waitForLoadState('domcontentloaded');
    await book.locator('.book-toolbar').waitFor();
    return book;
}

test.describe('The story of a house in the family book', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('approved: before the house\'s sections, Josef\'s story links to it', async ({ page, context }) => {
        await setup(page, { story: BESIDE });
        const book = await openBook(page, context);
        const ch = book.locator('#book-houses .book-house-ch', { hasText: 'čp. 16' });
        const story = ch.locator('.book-house-story');
        await expect(story.locator('.book-house-story-title')).toHaveText('Grunt na návsi');
        await expect(story).toContainText('Stavení postavil roku 1830 Josef Fíšek.');
        // The approved text, never the new version beside it.
        await expect(story).not.toContainText('Nový krov dostal');
        // Under the story of Josef (the head of his family's chapter), the house in the chapter Houses.
        const link = book.locator('.book-story', { hasText: 'Josef vyrostl' }).locator('.book-story-houses a');
        await expect(link).toHaveText('House čp. 16 ›');
        await expect(link).toHaveAttribute('href', `#${await ch.getAttribute('id')}`);
    });

    test('a draft never', async ({ page, context }) => {
        await setup(page, { story: DRAFT });
        const book = await openBook(page, context);
        await expect(book.locator('#book-houses .book-house-ch', { hasText: 'čp. 16' })).toBeVisible();
        await expect(book.locator('.book-house-story')).toHaveCount(0);
        await expect(book.locator('.book-story-houses')).toHaveCount(0);
    });

    test('a story naming a living person: left out whole', async ({ page, context }) => {
        await setup(page, { story: { ...FINAL, people: [{ id: 'P0001', died: true }, { id: 'P0002', died: false }] }, recent: true });
        const book = await openBook(page, context);
        await expect(book.locator('#book-houses .book-house-ch', { hasText: 'čp. 16' })).toBeVisible();
        await expect(book.locator('.book-house-story')).toHaveCount(0);
        await expect(book.locator('.book-story-houses')).toHaveCount(0);
        await expect(book.locator('body')).not.toContainText('Stavení postavil roku 1830');
    });
});
