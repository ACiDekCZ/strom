import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';
import { fakeBridge, fakeHistory, historyGed, openResearch, poll, HISTORY_FEATURES } from './research-bridge.js';

/**
 * The person page (spec 025): the window from the person menu's header and
 * the phone's sheet, its folds, switches and navigation, Escape, Edit only
 * where editing is possible, and "Save as HTML" — a file that opens offline,
 * readable without JavaScript, the privacy of the living applied.
 * Fictional family (Jan Fisek of Capkov).
 */

/** A 1×1 JPEG. */
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function seedFisek(page: Page): Promise<void> {
    const P = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra });
    const persons = {
        jan: P('jan', 'Jan', 'Fisek', 'male', {
            birthDate: '1860-03-12', birthPlace: 'Capkov', deathDate: '1910-11-02', deathPlace: 'Capkov',
            parentIds: ['otec', 'matka'], childIds: ['petr', 'rosa'], partnerships: ['u1'], birthSourceIds: ['s1'],
            notes: 'A farmer of house number 12.',
            events: [{ id: 'e1', type: 'baptism', date: '1860-03-13', place: 'Capkov', sourceIds: ['s1'] }],
        }),
        otec: P('otec', 'Vaclav', 'Fisek', 'male', { birthDate: '1830', deathDate: '1890', childIds: ['jan', 'karel'], partnerships: ['u0'] }),
        matka: P('matka', 'Anna', 'Nova', 'female', { birthDate: '1835', deathDate: '1895', childIds: ['jan', 'karel'], partnerships: ['u0'] }),
        karel: P('karel', 'Karel', 'Fisek', 'male', {
            birthDate: '1862', deathDate: '1930', parentIds: ['otec', 'matka'],
            story: { status: 'draft', title: 'The brother who stayed', text: 'Karel kept the farm in Capkov.' },
        }),
        marie: P('marie', 'Marie', 'Dvorakova', 'female', { birthDate: '1865', deathDate: '1930', partnerships: ['u1'], childIds: ['petr', 'rosa'] }),
        petr: P('petr', 'Petr', 'Fisek', 'male', { birthDate: '1890-01-01', deathDate: '1892-05-05', parentIds: ['jan', 'marie'] }),
        rosa: P('rosa', 'Rosa', 'Fiskova', 'female', {
            birthDate: '1893', deathDate: '1970', parentIds: ['jan', 'marie'], childIds: ['eva'], partnerships: ['u2'], deathSourceIds: ['s1'],
        }),
        tomas: P('tomas', 'Tomas', 'Maly', 'male', { birthDate: '1890', deathDate: '1960', partnerships: ['u2'], childIds: ['eva'] }),
        eva: P('eva', 'Evelina', 'Mala', 'female', { birthDate: '1955-04-04', birthPlace: 'Lhota', parentIds: ['tomas', 'rosa'] }),
    };
    const partnerships = {
        u0: { id: 'u0', person1Id: 'otec', person2Id: 'matka', childIds: ['jan', 'karel'], status: 'married' },
        u1: { id: 'u1', person1Id: 'jan', person2Id: 'marie', childIds: ['petr', 'rosa'], status: 'married', startDate: '1888-02-02', startPlace: 'Capkov' },
        u2: { id: 'u2', person1Id: 'tomas', person2Id: 'rosa', childIds: ['eva'], status: 'married', startDate: '1950' },
    };
    const sources = {
        s1: {
            id: 's1', title: 'Birth register Capkov 1850-1870', repository: 'Capkov archive',
            excerpts: [{ id: 'x1', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100 }],
        },
    };
    await page.evaluate(async ({ persons, partnerships, sources }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Fisek');
        await window.Strom.TreeRenderer.setFocus('jan' as never);
    }, { persons, partnerships, sources });
    await expect(card(page, 'Jan')).toBeVisible();
}

const win = (page: Page) => page.locator('#person-page-modal');

async function openPageFromMenu(page: Page, name = 'Jan'): Promise<void> {
    await card(page, name).click();
    await page.locator('.context-menu .context-menu-header--page').click();
    await expect(win(page)).toBeVisible();
}

test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('the menu header opens the window; folds and switches; Escape closes it, focus back on the card', { tag: '@smoke' }, async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await card(page, 'Jan').click();
        const header = page.locator('.context-menu .context-menu-header--page');
        await expect(header).toHaveAttribute('aria-label', 'Person page: Jan Fisek');
        await expect(header.locator('.cmh-page')).toHaveText('Person page ›');
        await header.click();

        const w = win(page);
        await expect(w.locator('h1')).toContainText('Jan Fisek');
        await expect(w.locator('.pp-sub')).toHaveText('Jan Fisek · 1860–1910');
        await expect(w.locator('.pp-body')).toBeFocused();
        // The family tree: the partner's card with the marriage year over the line; the rail is for phones.
        await expect(w.locator('.pp-ft [data-pp-person="marie"] .pp-ft-name')).toHaveText('Marie Dvorakova');
        await expect(w.locator('.pp-ft .pp-ft-lab').first()).toHaveText('⚭ 1888');
        await expect(w.locator('.pp-rail')).toBeHidden();
        // Four sections or more: the contents beside the page.
        await expect(w.locator('.pp-toc .pp-toc-link')).not.toHaveCount(0);

        // Sources: folded; the button opens and closes the region.
        const disc = w.locator('[data-pp-toggle="sources"]');
        const region = w.locator('#pp-sources-body');
        await expect(disc).toHaveAttribute('aria-expanded', 'false');
        await expect(region).toBeHidden();
        await disc.click();
        await expect(disc).toHaveAttribute('aria-expanded', 'true');
        await expect(region).toBeVisible();
        await disc.click();
        await expect(region).toBeHidden();

        // Children's events: on by default; off hides the children's rows.
        const sw = w.locator('[data-pp-switch="childEvents"]');
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(w.locator('article.pp')).toHaveClass(/pp-no-kids/);
        // No research: no History switch.
        await expect(w.locator('[data-pp-switch="history"]')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);
        await expect(card(page, 'Jan')).toBeFocused();
    });

    test('a relative opens in the same window; back restores scroll, folds and switches', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        const w = win(page);
        await w.locator('[data-pp-toggle="sources"]').click();
        await w.locator('[data-pp-switch="childEvents"]').click();
        const top = await w.locator('.pp-body').evaluate((el) => { el.scrollTop = 220; return el.scrollTop; });
        expect(top).toBeGreaterThan(0);
        // Clicked in place (a pointer click would scroll the link into view first).
        await w.locator('[data-pp-person="karel"]').first().evaluate((el) => (el as HTMLElement).click());
        await expect(w.locator('h1')).toContainText('Karel Fisek');
        const back = w.locator('.pp-back');
        await expect(back).toBeVisible();
        await expect(back).toHaveAttribute('aria-label', 'Back to Jan Fisek');
        await expect(w.locator('[data-pp-switch="childEvents"]')).toHaveCount(0);

        await back.click();
        await expect(w.locator('h1')).toContainText('Jan Fisek');
        await expect(back).toBeHidden();
        await expect(w.locator('[data-pp-toggle="sources"]')).toHaveAttribute('aria-expanded', 'true');
        await expect(w.locator('[data-pp-switch="childEvents"]')).toHaveAttribute('aria-checked', 'false');
        await expect(w.locator('article.pp')).toHaveClass(/pp-no-kids/);
        expect(await w.locator('.pp-body').evaluate((el) => el.scrollTop)).toBe(top);

        // Alt+← goes back too.
        await w.locator('[data-pp-person="karel"]').first().evaluate((el) => (el as HTMLElement).click());
        await expect(w.locator('h1')).toContainText('Karel Fisek');
        await page.keyboard.press('Alt+ArrowLeft');
        await expect(w.locator('h1')).toContainText('Jan Fisek');
    });

    test('⋯ offers Edit and Focus; a read-only view and a locked person have no Edit', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        const w = win(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Edit person', 'Focus in tree']);
        await w.locator('[data-pp-menu="edit"]').click();
        const editor = page.locator('#person-modal');
        await expect(editor).toBeVisible();
        await editor.locator('#input-notes').fill('Farmer and mayor.');
        await editor.locator('#btn-save').click();
        await expect(editor).toBeHidden();
        // The page redraws with the edit.
        await expect(w.locator('#pp-sec-notes')).toContainText('Farmer and mayor.');
        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);

        // A locked person.
        await page.evaluate(() => window.Strom.UI.runPersonMenuAction('jan' as never, 'toggle-lock'));
        await openPageFromMenu(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Focus in tree']);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.runPersonMenuAction('jan' as never, 'toggle-lock'));

        // A read-only view: the header is still offered, Edit is not.
        await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
        await openPageFromMenu(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Focus in tree']);
        // Focus in tree closes the window.
        await w.locator('[data-pp-menu="focus"]').click();
        await expect(w).toHaveCount(0);
    });

    test('Save as HTML: the dialog, a file that opens offline and reads without JavaScript', { tag: '@smoke' }, async ({ page, browser }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        await win(page).locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#ppx-file')).toHaveText('jan-fisek-1860-1910.html');
        // The groups the page has, with counts; the living granddaughter (in the family tree's
        // grandchildren row) makes the privacy choice appear.
        await expect(dlg.locator('[data-ppx-media="images"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-group="sources"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-group="history"]')).toHaveCount(0);
        await expect(dlg.locator('[data-ppx-privacy]')).toHaveCount(4);
        await expect(dlg.locator('.ppx-note', { hasText: 'Applies to living people only' })).toContainText('Evelina Mala');
        await expect(dlg.locator('#ppx-size-mb')).toContainText('MB');
        // Desktop: no Share.
        await expect(dlg.locator('[data-ppx="share"]')).toHaveCount(0);

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            dlg.locator('[data-ppx="save"]').click(),
        ]);
        expect(download.suggestedFilename()).toBe('jan-fisek-1860-1910.html');
        await expect(dlg).toHaveCount(0);
        await expect(page.locator('.toast')).toContainText('Saved: jan-fisek-1860-1910.html');
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).not.toMatch(/<link\b|<script\s+src|https?:\/\/[^"'\s]*\.(js|css|woff2?)/i);

        // Offline: every request is refused, and none is even attempted.
        const offline = await browser.newContext();
        const requests: string[] = [];
        await offline.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
        const filePage = await offline.newPage();
        filePage.on('request', (r) => { if (!r.url().startsWith('data:')) requests.push(r.url()); });
        await filePage.setContent(html, { waitUntil: 'load' });
        await expect(filePage.locator('h1')).toContainText('Jan Fisek');
        await expect(filePage.locator('#pp-sec-timeline')).toBeVisible();
        await expect(filePage).toHaveTitle('Jan Fisek (1860–1910)');
        expect(requests).toEqual([]);
        await offline.close();

        // Without JavaScript: readable, the folds are <details>.
        const noJs = await browser.newContext({ javaScriptEnabled: false });
        const plain = await noJs.newPage();
        await plain.setContent(html, { waitUntil: 'load' });
        await expect(plain.locator('h1')).toContainText('Jan Fisek');
        await expect(plain.locator('#pp-sec-timeline')).toBeVisible();
        expect(await plain.locator('details').count()).toBeGreaterThan(0);
        await expect(plain.locator('.pp-toggle')).toBeHidden();
        await noJs.close();

        // The choice is remembered for the tree: images off, saved, offered off again.
        await win(page).locator('.pp-save').click();
        await dlg.locator('[data-ppx-media="images"]').uncheck();
        const [second] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const noImages = readFileSync(await second.path(), 'utf-8');
        expect(noImages).not.toContain('data:image/jpeg');
        expect(noImages).not.toContain('id="obr-1"');
        await win(page).locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-media="images"]')).not.toBeChecked();
    });

    test('Save as HTML: the contents "On this page" in the file, first option and on; a column on a computer, a closed fold on a phone, anchors without JavaScript, none in print', async ({ page, browser }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        await win(page).locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        const first = dlg.locator('.ppx-checks').first().locator('.ppx-check').first();
        await expect(first).toContainText('Page contents (On this page)');
        await expect(first.locator('[data-ppx-toc]')).toBeChecked();
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');

        const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
        const file = await noJs.newPage();
        await file.setContent(html, { waitUntil: 'load' });
        const nav = file.locator('nav.pp-toc');
        await expect(nav).toBeVisible();
        await expect(file.locator('details.pp-toc-m')).toBeHidden();
        expect(await nav.evaluate(e => getComputedStyle(e).position)).toBe('sticky');
        await expect(nav.locator('a')).not.toHaveCount(0);
        expect(await nav.innerText()).not.toContain('Fisek');
        await nav.locator('a[href="#pp-sec-timeline"]').click();
        await expect(file.locator('#pp-sec-timeline')).toBeInViewport();
        // A phone: the fold under the header, closed; it opens and leads to the section.
        await file.setViewportSize({ width: 390, height: 800 });
        await expect(nav).toBeHidden();
        const fold = file.locator('details.pp-toc-m');
        await expect(fold).toBeVisible();
        expect(await fold.evaluate(e => (e as HTMLDetailsElement).open)).toBe(false);
        expect((await fold.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await fold.locator('summary').click();
        const link = fold.locator('a[href="#pp-sec-family"]');
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(36);
        await link.click();
        await expect(file.locator('#pp-sec-family')).toBeInViewport();
        // Print: none.
        await file.emulateMedia({ media: 'print' });
        await expect(fold).toBeHidden();
        await file.setViewportSize({ width: 1280, height: 800 });
        await expect(nav).toBeHidden();
        await noJs.close();

        // Off: the file has no contents, and the choice is remembered.
        await win(page).locator('.pp-save').click();
        await dlg.locator('[data-ppx-toc]').uncheck();
        const [second] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const off = readFileSync(await second.path(), 'utf-8');
        expect(off).not.toContain('<nav class="pp-toc"');
        expect(off).not.toContain('<details class="pp-toc-m">');
        await win(page).locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-toc]')).not.toBeChecked();
    });

    test('privacy: offered with a living relative only, initials by default; only the living lose name, dates and sources', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('rosa' as never));
        const w = win(page);
        await expect(w.locator('h1')).toContainText('Rosa Fiskova');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg.locator('[data-ppx-privacy]')).toHaveCount(4);
        // Nothing remembered yet: initials + birth year (K2.4).
        await expect(dlg.locator('[data-ppx-privacy="initials"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dlg.locator('.ppx-note', { hasText: 'Applies to living people only' })).toContainText('Evelina Mala');
        // Sources and excerpts stay on: only the living lose them, the note says so (K2.7).
        await expect(dlg.locator('#ppx-drops')).toBeVisible();
        await expect(dlg.locator('#ppx-drops')).toContainText('for living people only');
        await expect(dlg.locator('[data-ppx-group="sources"]')).toBeEnabled();
        await expect(dlg.locator('[data-ppx-media="images"]')).toBeChecked();
        await dlg.locator('[data-ppx-privacy="full"]').click();
        await expect(dlg.locator('#ppx-drops')).toBeHidden();
        await dlg.locator('[data-ppx-privacy="initials"]').click();
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toContain('Rosa');
        expect(html).not.toContain('Evelina');
        expect(html).not.toContain('Mala');
        expect(html).not.toContain('1955-04-04');
        expect(html).not.toContain('Lhota');
        // Rosa died: her death record and its excerpt stay in the file.
        expect(html).toContain('Birth register Capkov 1850-1870');
        expect(html).toContain('<figure class="pp-fig"');
        // The family tree is the one place a living person shows: initials and the birth year, dashed.
        expect(html).toContain('<span class="pp-ft-name" title="E. M.">E. M.</span><span class="pp-ft-years">* 1955</span>');
        expect(html).not.toMatch(/04\.? ?(April|dubna)|4 April 1955/);

        // A remembered choice wins over the default, full data too.
        await w.locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-privacy="initials"]')).toHaveAttribute('aria-checked', 'true');
        await dlg.locator('[data-ppx-privacy="full"]').click();
        await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        await w.locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-privacy="full"]')).toHaveAttribute('aria-checked', 'true');
    });

    test('a story in draft is on the page and in the file, marked as a draft', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('karel' as never));
        const story = win(page).locator('#pp-sec-story');
        await expect(story).toContainText('Karel kept the farm in Capkov.');
        await expect(story.locator('.pp-draft-tag')).toHaveText('Draft');
        await win(page).locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toContain('Karel kept the farm in Capkov.');
        expect(html).toContain('<span class="pp-draft-tag">Draft</span>');
    });

    test('a couple’s story is told on the person page and in the file, with its own heading', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => {
            window.Strom.DataManager.getPartnership('u1' as never)!.story = { status: 'draft', text: 'Jan and Marie ran the farm at number 12.' } as never;
        });
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        const couple = w.locator('#pp-sec-story .pp-couple-story');
        await expect(couple.locator('h3')).toHaveText('Jan Fisek and Marie Dvorakova Draft');
        await expect(couple).toContainText('Jan and Marie ran the farm at number 12.');
        // Jan has no story of his own: the couple's story alone makes the section and its item in the contents.
        await expect(w.locator('.pp-toc-link[data-pp-toc="pp-sec-story"]')).toHaveText('Story');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toContain('Jan and Marie ran the farm at number 12.');
        expect(html).toContain('<h3 class="pp-ch-title">Jan Fisek and Marie Dvorakova <span class="pp-draft-tag">Draft</span></h3>');
    });

    test('the contents list the story and mark the last section at the end; years end at one edge; folded sources keep their header', async ({ page, browser }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.DataManager.updatePerson('jan' as never, {
            story: { status: 'draft', title: 'The farmer', text: 'Jan farmed house number 12.' },
        } as never));
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        await expect(w.locator('#pp-sec-story')).toContainText('Jan farmed house number 12.');
        const links = w.locator('.pp-toc-link');
        await expect(w.locator('.pp-toc-link[data-pp-toc="pp-sec-story"]')).toHaveText('Story');
        // Scrolled to the end: the last section, however short; back at the top: the first.
        const body = w.locator('.pp-body');
        await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect(links.last()).toHaveAttribute('aria-current', 'true');
        await expect(w.locator('.pp-toc-link[aria-current="true"]')).toHaveCount(1);
        await body.evaluate((el) => { el.scrollTop = 0; });
        await expect(links.first()).toHaveAttribute('aria-current', 'true');

        // Every year of the timeline (own and the children's) ends at the same edge by the marker.
        const yearEdges = (root: Page | ReturnType<typeof win>) => root.locator('.pp-row .pp-y').evaluateAll((els) => els.map((el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return Math.round(r.getBoundingClientRect().right);
        }));
        const sw = w.locator('[data-pp-switch="childEvents"]');
        if (await sw.getAttribute('aria-checked') !== 'true') await sw.click();
        await expect(w.locator('.pp-row--kid').first()).toBeVisible();
        expect(new Set(await yearEdges(w)).size).toBe(1);

        // Folded sources: the heading on one row with its state, the peek below it in plain text.
        const foldedSources = async (root: Page | ReturnType<typeof win>) => {
            const h = (await root.locator('#pp-sec-sources .pp-fold-h').boundingBox())!;
            const state = (await root.locator('#pp-sec-sources .pp-fold-h .pp-fold-state').boundingBox())!;
            const peek = (await root.locator('#pp-sec-sources .pp-peek').boundingBox())!;
            expect(h.height).toBeLessThan(60);
            expect(state.y).toBeLessThan(h.y + h.height);
            expect(peek.y).toBeGreaterThanOrEqual(h.y + h.height - 1);
            expect(await root.locator('#pp-sec-sources .pp-peek').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('400');
        };
        await foldedSources(w);

        // The same in the saved file.
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const filePage = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
        await filePage.setContent(readFileSync(await download.path(), 'utf-8'), { waitUntil: 'load' });
        await expect(filePage.locator('.pp-row--kid').first()).toBeVisible();
        expect(new Set(await yearEdges(filePage)).size).toBe(1);
        await foldedSources(filePage);
        await filePage.context().close();
    });

    test('a page without living people keeps the remembered privacy for the next page', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        const dlg = page.locator('#person-page-export-modal');
        // Karel's page has nobody living: no choice, and saving it does not turn the default into full data.
        await page.evaluate(() => window.Strom.UI.showPersonPage('karel' as never));
        await expect(win(page).locator('h1')).toContainText('Karel Fisek');
        await win(page).locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-privacy]')).toHaveCount(0);
        await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        await page.evaluate(() => window.Strom.UI.showPersonPage('rosa' as never));
        await expect(win(page).locator('h1')).toContainText('Rosa Fiskova');
        await win(page).locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-privacy="initials"]')).toHaveAttribute('aria-checked', 'true');
    });

    test('person page 2: the summary, the open question, the people around, the gallery zooming in place', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => {
            const jan = window.Strom.DataManager.getPerson('jan' as never)!;
            jan.question = 'Where did his father come from?';
            jan.events = [{ id: 'e1', type: 'baptism', date: '1860-03-13', place: 'Capkov', sourceIds: ['s1'], participants: [
                { id: 'g1', role: 'godparent', name: 'Josef Kmotr' },
                { id: 'g2', role: 'godparent', name: 'Anna Kmotrova' },
            ] }] as never;
        });
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        // In brief: three cells in a row under the header.
        const cells = w.locator('.pp-sum .pp-sum-cell');
        await expect(cells).toHaveCount(3);
        await expect(cells.nth(0)).toHaveText('50 yearsage at death');
        await expect(w.locator('.pp-sum')).toContainText('2 children');
        const boxes = await cells.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
        expect(new Set(boxes).size).toBe(1);
        // The question after the story's place, before the timeline.
        await expect(w.locator('#pp-sec-question .pp-question-text')).toHaveText('Where did his father come from?');
        // People around: the two godparents, the role in the group's heading, the names apart by " · ".
        await expect(w.locator('#pp-sec-people dt')).toHaveText(['Godparents at baptism 1860']);
        await expect(w.locator('#pp-sec-people li')).toHaveCount(2);
        await expect(w.locator('#pp-sec-people dd')).toHaveText('Josef Kmotr · Anna Kmotrova');
        // The gallery: the excerpt, zoomed in the window's own layer.
        const gal = w.locator('#pp-sec-materials');
        await expect(gal.locator('.pp-gal-item')).toHaveCount(1);
        await gal.locator('.pp-gal-thumb').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await expect(w).toBeVisible();
    });

    test('Save as HTML: images and PDF checkboxes with the size; the file opens an image in its light box and closes it', async ({ page, browser }) => {
        await openApp(page);
        await seedFisek(page);
        const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\n%%EOF').toString('base64')}`;
        await page.evaluate((pdf) => {
            window.Strom.DataManager.getPerson('jan' as never)!.attachments = [{ id: 'a1', name: 'contract-1902.pdf', mimeType: 'application/pdf', dataUrl: pdf, sizeBytes: 60 }];
        }, pdf);
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        await expect(w.locator('#pp-sec-materials .pp-pdf-name')).toHaveText('contract-1902.pdf');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        // On by default (Milan, 30 Oct), with the size and the note on shrinking.
        await expect(dlg.locator('[data-ppx-media="images"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-media="pdf"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-row="images"]')).toContainText('Attach images (1)');
        await expect(dlg.locator('[data-ppx-row="pdf"]')).toContainText('Attach PDF documents (1)');
        await expect(dlg.locator('.ppx-shrink')).toBeVisible();
        await expect(dlg.locator('#ppx-size-mb')).toContainText('1 image');
        await expect(dlg.locator('#ppx-size-large')).toBeHidden();
        await dlg.locator('[data-ppx-media="images"]').uncheck();
        await expect(dlg.locator('#ppx-size-mb')).toContainText('0 images');
        await dlg.locator('[data-ppx-media="images"]').check();
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        // The image once, the PDF as a download.
        expect(html.split('data:image/jpeg').length - 1).toBe(1);
        expect(html).toContain('download="contract-1902.pdf"');

        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const filePage = await ctx.newPage();
        await filePage.setContent(html, { waitUntil: 'load' });
        const box = filePage.locator('#obr-1');
        await expect(box).toBeHidden();
        await filePage.locator('#pp-sec-materials .pp-gal-thumb').click();
        await expect(box).toBeVisible();
        await expect(box.locator('.pp-lb-count')).toHaveText('1 / 1');
        await filePage.keyboard.press('Escape');
        await expect(box).toBeHidden();
        await filePage.locator('#pp-sec-materials .pp-gal-thumb').click();
        await expect(box).toBeVisible();
        await box.locator('.pp-lb-close').click();
        await expect(box).toBeHidden();
        // The file's tree cards are plain text.
        await expect(filePage.locator('.pp-ft .pp-ft-card--partner')).toHaveText('Marie Dvorakova1865–1930');
        expect(await filePage.locator('.pp-ft button, .pp-ft a').count()).toBe(0);
        await ctx.close();
    });

    test('a protected file: the living child is "E. M. · * 1955" with a dashed border, the name nowhere', async ({ page, browser }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('rosa' as never));
        const w = win(page);
        // In the window the living child is named and opens her page.
        await expect(w.locator('.pp-ft [data-pp-person="eva"] .pp-ft-name')).toHaveText('Evelina Mala');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg.locator('[data-ppx-privacy="initials"]')).toHaveAttribute('aria-checked', 'true');
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        for (const word of ['Evelina', 'Mala', 'Lhota', '1955-04-04']) expect(html).not.toContain(word);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const filePage = await ctx.newPage();
        await filePage.setContent(html, { waitUntil: 'load' });
        const living = filePage.locator('.pp-ft .pp-ft-card--living');
        await expect(living).toHaveText('E. M.* 1955');
        expect(await living.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
        await ctx.close();
    });

    test('Print prints the page: the window shows in print with the person, the tree and its toolbar stay out', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        const w = win(page);
        await page.evaluate(() => { window.print = () => {}; });
        await w.locator('.pp-print').click();
        await page.emulateMedia({ media: 'print' });
        const shown = await w.evaluate((el) => ({
            display: getComputedStyle(el).display,
            height: el.getBoundingClientRect().height,
            text: (el as HTMLElement).innerText,
        }));
        expect(shown.display).not.toBe('none');
        expect(shown.height).toBeGreaterThan(0);
        expect(shown.text).toContain('Jan Fisek');
        await expect(page.locator('#tree-container')).toBeHidden();
        await expect(page.locator('.toolbar').first()).toBeHidden();
        await page.emulateMedia({ media: 'screen' });
    });
});

/**
 * Karl Hollerbach (1900–1975) of Capkov and Wien: his places with positions, a
 * partner born in Lhota, a son who died in Graz, a LIVING daughter who
 * emigrated to Toronto (far: the world inset).
 */
async function seedTraveller(page: Page): Promise<void> {
    const P = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra });
    const persons = {
        karl: P('karl', 'Karl', 'Hollerbach', 'male', {
            birthDate: '1900-03-03', birthPlace: 'Capkov', deathDate: '1975-08-08', deathPlace: 'Wien',
            partnerships: ['u1'], childIds: ['otto', 'lena'],
            events: [{ id: 'k1', type: 'military', date: '1918', place: 'Graz' }],
        }),
        berta: P('berta', 'Berta', 'Kral', 'female', { birthDate: '1902', birthPlace: 'Lhota', deathDate: '1980', partnerships: ['u1'], childIds: ['otto', 'lena'] }),
        otto: P('otto', 'Otto', 'Hollerbach', 'male', { birthDate: '1927', deathDate: '1990', deathPlace: 'Hollerau', parentIds: ['karl', 'berta'] }),
        lena: P('lena', 'Magdalena', 'Hollerbachova', 'female', {
            birthDate: '1950-06-06', birthPlace: 'Wien', parentIds: ['karl', 'berta'],
            events: [{ id: 'l1', type: 'emigration', date: '1975', place: 'Toronto' }],
        }),
    };
    const partnerships = {
        u1: { id: 'u1', person1Id: 'karl', person2Id: 'berta', childIds: ['otto', 'lena'], status: 'married', startDate: '1925-05-05', startPlace: 'Wien' },
    };
    const places = {
        capkov: { lat: 49.85, lon: 15.2 }, wien: { lat: 48.21, lon: 16.37 }, graz: { lat: 47.07, lon: 15.44 },
        lhota: { lat: 49.9, lon: 15.3 }, linz: { lat: 48.31, lon: 14.29 }, toronto: { lat: 43.65, lon: -79.38 },
    };
    await page.evaluate(async ({ persons, partnerships, places }) => {
        window.Strom.SettingsManager.setOnThisDay(false);
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, places } as never, 'Hollerbach');
        await window.Strom.TreeRenderer.setFocus('karl' as never);
    }, { persons, partnerships, places });
    await expect(card(page, 'Karl')).toBeVisible();
}

test.describe('person page 2: places of life and the life chart', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('three marriages: the upright tree on a desktop, a union a row, the children in three columns (round 2)', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => {
            const D = window.Strom.DataManager;
            const data = D.getData() as unknown as { persons: Record<string, Record<string, unknown>>; partnerships: Record<string, Record<string, unknown>> };
            const jan = data.persons['jan'] as { partnerships: string[] };
            for (const [k, name] of [['u3', 'Ludmila'], ['u4', 'Terezie']]) {
                data.persons[`w${k}`] = { id: `w${k}`, firstName: name, lastName: 'Fiskova', gender: 'female', isPlaceholder: false,
                    parentIds: [], childIds: [], partnerships: [k], birthDate: '1866', deathDate: '1931' };
                data.partnerships[k] = { id: k, person1Id: 'jan', person2Id: `w${k}`, childIds: [], status: 'married' };
                jan.partnerships.push(k);
            }
            for (const k of ['k3', 'k4', 'k5', 'k6']) {
                data.persons[k] = { id: k, firstName: `Kid${k}`, lastName: 'Fisek', gender: 'male', isPlaceholder: false,
                    parentIds: ['jan', 'marie'], childIds: [], partnerships: [], birthDate: '1895', deathDate: '1960' };
                (data.persons['jan'].childIds as string[]).push(k);
                (data.persons['marie'].childIds as string[]).push(k);
                (data.partnerships['u1'].childIds as string[]).push(k);
            }
        });
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        const rail = w.locator('.pp-rail--wide');
        await expect(rail).toBeVisible();
        await expect(w.locator('.pp-ft')).toHaveCount(0);
        await expect(rail.locator('.pp-rail-u')).toHaveCount(3);
        // The partner on the left, the union's children on the right, three in a row.
        const u1 = rail.locator('.pp-rail-u').first();
        const side = (await u1.locator('.pp-rail-side').boundingBox())!;
        const kids = (await u1.locator('.pp-rail-kids').boundingBox())!;
        expect(kids.x).toBeGreaterThan(side.x + side.width - 1);
        const tops = await u1.locator('.pp-rail-kidgrid > *').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
        expect(tops.filter(t => t === tops[0])).toHaveLength(3);
        const fits = await w.locator('.pp-body').evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
    });

    test('the map with its list, Children’s places and selection; a place in the header scrolls to it; the chart leads to the timeline', async ({ page }) => {
        await openApp(page);
        await seedTraveller(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('karl' as never));
        const w = win(page);
        const sec = w.locator('#pp-sec-places');
        await expect(sec.locator('.pp-map')).toBeVisible();
        await expect(sec.locator('.pp-map-row', { hasText: 'Capkov' })).toBeVisible();
        await expect(sec.locator('h2')).toHaveText('Places of life');
        // Children's places: on, the hollow points; off, gone (the page stays where it was).
        const kids = sec.locator('[data-pp-switch="kidPlaces"]');
        await expect(kids).toHaveAttribute('aria-checked', 'true');
        await expect(sec.locator('.pp-map-pt--rel')).not.toHaveCount(0);
        await expect(sec.locator('.pp-map-row--rel', { hasText: 'Toronto' })).toBeVisible();
        await kids.click();
        await expect(w.locator('[data-pp-switch="kidPlaces"]')).toHaveAttribute('aria-checked', 'false');
        await expect(w.locator('#pp-sec-places .pp-map-pt--rel')).toHaveCount(0);
        await w.locator('[data-pp-switch="kidPlaces"]').click();
        await expect(w.locator('#pp-sec-places .pp-map-pt--rel')).not.toHaveCount(0);

        // A point selects its row; the selected row clicked again leads to the place's first event.
        await sec.locator('.pp-map-pt[data-pp-map-place="wien"]').click();
        await expect(sec.locator('.pp-map-pt[data-pp-map-place="wien"]')).toHaveClass(/is-sel/);
        const row = sec.locator('.pp-map-row[data-pp-map-place="wien"]');
        await expect(row).toHaveClass(/is-sel/);
        const osa = await row.getAttribute('data-pp-osa');
        expect(osa).toMatch(/^osa-1925-/);
        await row.click();
        await expect(w.locator(`#${osa}`)).toHaveClass(/pp-osa-flash/);
        await expect(w.locator(`#${osa}`)).toBeInViewport();

        // A place in the header: the page scrolls to the map and selects it, the window stays (§1.6).
        await w.locator('.pp-body').evaluate((el) => { el.scrollTop = 0; });
        await w.locator('#pp-sec-facts [data-pp-place="Capkov"]').click();
        await expect(sec.locator('.pp-map-row[data-pp-map-place="capkov"]')).toHaveClass(/is-sel/);
        await expect(sec.locator('.pp-map')).toBeInViewport();
        await expect(w).toBeVisible();

        // The chart above the text timeline: a mark leads to its row.
        const chart = w.locator('#pp-sec-timeline .pp-chart');
        await expect(chart).toBeVisible();
        const mark = chart.locator('a.pp-ch-mk--event[data-pp-osa]').first();
        const target = await mark.getAttribute('data-pp-osa');
        expect(target).toMatch(/^osa-/);
        // A mark is a zero-width anchor (a 16 px ::before hit area): its label is clicked.
        await mark.locator('.pp-ch-ml').click();
        await expect(w.locator(`#${target}`)).toHaveClass(/pp-osa-flash/);
        await expect(w.locator(`#${target}`)).toBeInViewport();
        // The chart is drawn for the column it has (one set, the ResizeObserver's width).
        await expect(chart.locator('.pp-chart-set--one')).toHaveCount(1);
        // Children's events off hides the children's lines too.
        await expect(chart.locator('.pp-ch-kid').first()).toBeVisible();
        await w.locator('[data-pp-switch="childEvents"]').click();
        await expect(chart.locator('.pp-ch-kid').first()).toBeHidden();
    });

    test('Open in map closes the window at the place; the toast brings the page back', async ({ page }) => {
        await openApp(page);
        await seedTraveller(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('karl' as never));
        const w = win(page);
        await w.locator('#pp-sec-places .pp-map-pt[data-pp-map-place="wien"]').click();
        await w.locator('[data-pp-action="map:open"]').click();
        await expect(w).toHaveCount(0);
        const toast = page.locator('.toast[data-kind="person-page"]');
        await expect(toast).toContainText('Map: Wien');
        await toast.locator('.toast-action').click();
        await expect(win(page).locator('h1')).toContainText('Karl Hollerbach');
        await expect(win(page).locator('#pp-sec-places .pp-map-row[data-pp-map-place="wien"]')).toHaveClass(/is-sel/);
    });

    test('the saved file: the map and the chart, anchors without JavaScript, nothing of the living daughter', async ({ page, browser }) => {
        await openApp(page);
        await seedTraveller(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('karl' as never));
        const w = win(page);
        await expect(w.locator('#pp-sec-places .pp-map-row', { hasText: 'Toronto' })).toBeVisible();
        await expect(w.locator('.pp-chart')).toContainText('Magdalena');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg.locator('[data-ppx-privacy="initials"]')).toHaveAttribute('aria-checked', 'true');
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toContain('id="pp-sec-places"');
        expect(html).toContain('class="pp-chart"');
        for (const word of ['Magdalena', 'Toronto', '1950-06-06']) expect(html).not.toContain(word);
        expect(html).not.toMatch(/https?:\/\/[^"'\s]*(tile|openstreetmap)/i);

        const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
        const plain = await noJs.newPage();
        await plain.setContent(html, { waitUntil: 'load' });
        await expect(plain.locator('.pp-map')).toBeVisible();
        await expect(plain.locator('.pp-chart-set--wide')).toBeVisible();
        await expect(plain.locator('.pp-chart-set--narrow')).toBeHidden();
        // A chart mark is a plain fragment link to its timeline row.
        const href = await plain.locator('.pp-chart-set--wide a[href^="#osa-"]').first().getAttribute('href');
        expect(await plain.locator(href!).count()).toBe(1);
        // Places in the text lead to the map.
        await expect(plain.locator('#pp-sec-facts a.pp-place-link[href="#pp-sec-places"]').first()).toBeVisible();
        await noJs.close();

        // With JavaScript a point selects its row.
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const filePage = await ctx.newPage();
        await filePage.setContent(html, { waitUntil: 'load' });
        await filePage.locator('.pp-map-pt[data-pp-map-place="wien"]').click();
        await expect(filePage.locator('.pp-map-row[data-pp-map-place="wien"]')).toHaveClass(/is-sel/);
        await ctx.close();
    });
});

test.describe('person page 2: a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the life chart\'s shorter rows keep the ages off the periods and each mark off its year', async ({ page }) => {
        await openApp(page);
        await seedTraveller(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('karl' as never));
        const chart = win(page).locator('.pp-chart');
        await chart.scrollIntoViewIfNeeded();
        const gaps = await chart.evaluate((c) => {
            const bottom = (s: string) => Math.max(...[...c.querySelectorAll(s)].map(e => e.getBoundingClientRect().bottom));
            const top = (s: string) => Math.min(...[...c.querySelectorAll(s)].map(e => e.getBoundingClientRect().top));
            const marks = [...c.querySelectorAll('.pp-ch-mk')].filter(m => m.querySelector('.pp-ch-gl') && m.querySelector('.pp-ch-ml'))
                .map(m => m.querySelector('.pp-ch-ml')!.getBoundingClientRect().top - m.querySelector('.pp-ch-gl')!.getBoundingClientRect().bottom);
            return { ages: top('.pp-ch-pl') - bottom('.pp-ch-ages span'), marks };
        });
        expect(gaps.ages).toBeGreaterThanOrEqual(-0.5);
        expect(gaps.marks.length).toBeGreaterThan(0);
        for (const g of gaps.marks) expect(g).toBeGreaterThanOrEqual(-0.5);
    });
});

test.describe('person page 2: the saved file follows the window\'s switches', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Children\'s events and Children\'s places off in the window: the file starts with both off', async ({ page, browser }) => {
        await openApp(page);
        await seedTraveller(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('karl' as never));
        const w = win(page);
        await w.locator('[data-pp-switch="childEvents"]').click();
        await w.locator('[data-pp-switch="kidPlaces"]').click();
        await expect(w.locator('[data-pp-switch="childEvents"]')).toHaveAttribute('aria-checked', 'false');
        await expect(w.locator('[data-pp-switch="kidPlaces"]')).toHaveAttribute('aria-checked', 'false');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await dlg.locator('[data-ppx-privacy="full"]').click();
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toMatch(/<article class="pp pp-no-kids"/);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const filePage = await ctx.newPage();
        await filePage.setContent(html, { waitUntil: 'load' });
        const sw = filePage.locator('[data-pp-switch="childEvents"]');
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(filePage.locator('.pp-row--kid').first()).toBeHidden();
        await expect(filePage.locator('.pp-chart .pp-ch-kid').first()).toBeHidden();
        // The children's places are not on the map (Toronto is the living daughter's, Hollerau the son's).
        await expect(filePage.locator('.pp-map-pt--rel')).toHaveCount(0);
        await expect(filePage.locator('.pp-map-row', { hasText: 'Hollerau' })).toHaveCount(0);
        // The file's own switch brings the children's rows back.
        await sw.click();
        await expect(filePage.locator('.pp-row--kid').first()).toBeVisible();
        await ctx.close();
    });
});

test.describe('a research tree with history', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('history rows with the legend, the History switch hides them, the file keeps the safe source link', async ({ page, browser }) => {
        // The research's events of the time: E1 (1866) in Jan's Čapkov, E2 hidden there.
        const ged = historyGed();
        await fakeBridge(page, { features: HISTORY_FEATURES, history: fakeHistory(), treeGed: ged, links: ['send', 'open', 'live', 'app', 'setup', 'experiment'] });
        await openResearch(page, { ged });
        await poll(page);
        const jan = await page.evaluate(() =>
            (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.UI.showPersonPage(id as never), jan);
        const w = win(page);
        await expect(w.locator('h1')).toContainText('Jan');

        const rows = w.locator('#pp-sec-timeline .pp-row--hist');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Austro-Prussian War; fighting around Čapkov.');
        await expect(rows.first().locator('a[href="https://example.org/war-1866"]')).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(w.locator('#pp-sec-timeline')).not.toContainText('Vienna stock exchange crash');
        const legend = w.locator('#pp-sec-timeline .pp-legend:not(.pp-chart-legend)');
        await expect(legend).toBeVisible();
        await expect(legend.locator('.pp-hm')).toHaveCount(3);

        // The switch: on by default; off hides the rows and the legend, on brings them back.
        const sw = w.locator('[data-pp-switch="history"]');
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(rows.first()).toBeHidden();
        await expect(legend).toBeHidden();
        await sw.click();
        await expect(rows.first()).toBeVisible();

        // The file: the history group offered with its count, the row and its link kept.
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg.locator('[data-ppx-group="history"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-row="history"] .ppx-count')).toHaveText('1');
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toContain('Austro-Prussian War; fighting around Čapkov.');
        expect(html).toContain('href="https://example.org/war-1866" rel="noopener noreferrer" target="_blank"');
        expect(html).not.toContain('Vienna stock exchange crash');
        // No other external resource: http(s) only in links that open apart.
        expect(html).not.toMatch(/<link\b|<script\s+src|<iframe|\bsrc="https?:|url\(\s*['"]?https?:|@import/i);
        const urls = [...html.matchAll(/https?:\/\/[^"'\s<>)]+/g)].map(m => m[0]);
        const anchors = [...html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/g)];
        for (const a of anchors) expect(a[0]).toContain('rel="noopener noreferrer"');
        expect(new Set(urls)).toEqual(new Set(anchors.map(a => a[1])));

        // Offline it loads without a single request, the history row in place.
        const offline = await browser.newContext();
        const requests: string[] = [];
        await offline.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
        const filePage = await offline.newPage();
        await filePage.setContent(html, { waitUntil: 'load' });
        await expect(filePage.locator('.pp-row--hist')).toContainText('Austro-Prussian War');
        await filePage.locator('[data-pp-switch="history"]').click();
        await expect(filePage.locator('.pp-row--hist')).toBeHidden();
        expect(requests).toEqual([]);
        await offline.close();

        // History off in the window when saving: the file starts with it off too (its switch brings it back).
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await w.locator('.pp-save').click();
        const [offDownload] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const offCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const offPage = await offCtx.newPage();
        await offPage.setContent(readFileSync(await offDownload.path(), 'utf-8'), { waitUntil: 'load' });
        await expect(offPage.locator('[data-pp-switch="history"]')).toHaveAttribute('aria-checked', 'false');
        await expect(offPage.locator('.pp-row--hist')).toBeHidden();
        await offPage.locator('[data-pp-switch="history"]').click();
        await expect(offPage.locator('.pp-row--hist')).toContainText('Austro-Prussian War');
        await offCtx.close();
    });
});

test.describe('a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the sheet’s button opens the page on the whole screen, nothing wider than the screen', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await card(page, 'Jan').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        const btn = sheet.locator('.bs-page-btn');
        await expect(btn).toHaveText('Person page ›');
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await btn.click();
        await expect(sheet).toHaveCount(0);
        const w = win(page);
        await expect(w.locator('h1')).toContainText('Jan Fisek');
        const box = (await w.locator('.modal--page').boundingBox())!;
        expect(box.x).toBe(0);
        expect(box.y).toBe(0);
        expect(Math.round(box.width)).toBe(390);
        expect(Math.round(box.height)).toBe(844);
        await expect(w.locator('.pp-mname')).toHaveText('Jan Fisek');
        await expect(w.locator('.pp-save')).toBeHidden();
        await expect(w.locator('.pp-share')).toBeVisible();
        const fits = await w.locator('.pp-body').evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
        // Save and Print in ⋯ on a phone.
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Save as HTML', 'Print', 'Edit person', 'Focus in tree']);
    });

    test('the header follows the window\'s size: Save on a phone, Save as HTML once wider, Save again when narrow', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        const jan = await page.evaluate(() =>
            (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.UI.showPersonPage(id as never), jan);
        const w = win(page);
        await expect(w.locator('.pp-share')).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(w.locator('.pp-share')).toBeHidden();
        await expect(w.locator('.pp-save')).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(w.locator('.pp-share')).toBeVisible();
        await expect(w.locator('.pp-save')).toBeHidden();
    });

    test('the family is a rail on a phone: the union, the partner and the children, the tree hidden', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        const rail = w.locator('.pp-rail');
        await expect(rail).toBeVisible();
        await expect(w.locator('.pp-ft')).toBeHidden();
        await expect(rail.locator('.pp-rail-lab').first()).toHaveText('⚭ 2 February 1888, Capkov');
        await expect(rail.locator('[data-pp-person="marie"]')).toBeVisible();
        await expect(rail.locator('[data-pp-person="petr"]')).toBeVisible();
        // A card is a 44 px target that opens the relative's page.
        expect((await rail.locator('[data-pp-person="marie"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await rail.locator('[data-pp-person="marie"]').click();
        await expect(w.locator('h1')).toContainText('Marie Dvorakova');
        const fits = await w.locator('.pp-body').evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
    });

    test('Save as HTML is a bottom sheet: a handle, the file name under the title, the buttons full width', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        const w = win(page);
        await w.locator('.pp-more').click();
        await w.locator('[data-pp-menu="save"]').click();
        const sheet = page.locator('#person-page-export-modal .pp-export');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.ppx-grab')).toBeVisible();
        await expect(sheet.locator('#ppx-file-sub')).toHaveText('jan-fisek-1860-1910.html');
        await expect(sheet.locator('.ppx-sub--who')).toBeHidden();
        await expect(sheet.locator('.ppx-sec--file')).toBeHidden();
        await expect(sheet.locator('.modal-header .close-btn')).toBeHidden();
        const box = (await sheet.boundingBox())!;
        expect(Math.round(box.width)).toBe(390);
        expect(Math.round(box.y + box.height)).toBe(844);
        const save = (await sheet.locator('[data-ppx="save"]').boundingBox())!;
        expect(save.width).toBeGreaterThan(300);
        expect(save.height).toBeGreaterThanOrEqual(48);
        const fits = await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
        // A tap beside the sheet closes it.
        await page.mouse.click(195, 40);
        await expect(sheet).toHaveCount(0);
    });
});
